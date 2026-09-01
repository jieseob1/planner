package io.nowline.planner.persistence;

import io.nowline.planner.domain.PlanHistory;
import io.nowline.planner.domain.PlannerSnapshot;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Repository;
import tools.jackson.core.JacksonException;
import tools.jackson.core.type.TypeReference;
import tools.jackson.databind.ObjectMapper;

import java.sql.Timestamp;
import java.time.Instant;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.UUID;

@Repository
public class PlanHistoryRepository {

    private final JdbcTemplate jdbc;
    private final ObjectMapper objectMapper;

    public PlanHistoryRepository(JdbcTemplate jdbc, ObjectMapper objectMapper) {
        this.jdbc = jdbc;
        this.objectMapper = objectMapper;
    }

    public UUID ensureActive(UUID userId, PlannerSnapshot snapshot, long revision) {
        Optional<UUID> current = activePlanId(userId);
        if (current.isPresent()) {
            UUID planId = current.get();
            updateSnapshot(userId, planId, snapshot, revision);
            return planId;
        }
        UUID planId = UUID.randomUUID();
        jdbc.update("""
                        INSERT INTO planner_plan (
                            plan_id, user_id, title, plan_year, plan_quarter, status,
                            snapshot, source_revision, activated_at
                        ) VALUES (?, ?, ?, ?, ?, 'ACTIVE', CAST(? AS jsonb), ?, now())
                        """,
                planId,
                userId,
                defaultTitle(snapshot),
                snapshot.plan().year(),
                snapshot.plan().quarter(),
                json(snapshot),
                revision);
        audit(userId, planId, "PLAN_CREATED_AND_ACTIVATED", revision, Map.of());
        return planId;
    }

    public Optional<UUID> activePlanId(UUID userId) {
        List<UUID> rows = jdbc.query(
                "SELECT plan_id FROM planner_plan WHERE user_id = ? AND status = 'ACTIVE'",
                (resultSet, rowNumber) -> resultSet.getObject(1, UUID.class),
                userId);
        return rows.stream().findFirst();
    }

    public void updateSnapshot(UUID userId, UUID planId, PlannerSnapshot snapshot, long revision) {
        int updated = jdbc.update("""
                        UPDATE planner_plan
                        SET plan_year = ?, plan_quarter = ?, snapshot = CAST(? AS jsonb),
                            source_revision = ?, updated_at = now()
                        WHERE plan_id = ? AND user_id = ? AND status = 'ACTIVE'
                        """,
                snapshot.plan().year(),
                snapshot.plan().quarter(),
                json(snapshot),
                revision,
                planId,
                userId);
        if (updated != 1) throw new IllegalStateException("Active plan snapshot could not be updated");
    }

    public void auditSnapshotUpdated(UUID userId, UUID planId, long revision) {
        audit(userId, planId, "PLAN_SNAPSHOT_UPDATED", revision, Map.of());
    }

    public void archiveActiveAfterDelete(UUID userId, long revision) {
        activePlanId(userId).ifPresent(planId -> {
            jdbc.update("""
                            UPDATE planner_plan
                            SET status = 'ARCHIVED', archived_at = now(), updated_at = now(), source_revision = ?
                            WHERE user_id = ? AND plan_id = ? AND status = 'ACTIVE'
                            """, revision, userId, planId);
            audit(userId, planId, "ACTIVE_PLAN_DELETED", revision, Map.of());
        });
    }

    public boolean create(UUID userId, UUID planId, String title, PlannerSnapshot snapshot) {
        int inserted = jdbc.update("""
                        INSERT INTO planner_plan (
                            plan_id, user_id, title, plan_year, plan_quarter, status, snapshot
                        ) VALUES (?, ?, ?, ?, ?, 'DRAFT', CAST(? AS jsonb))
                        ON CONFLICT (plan_id) DO NOTHING
                        """,
                planId,
                userId,
                title.trim(),
                snapshot.plan().year(),
                snapshot.plan().quarter(),
                json(snapshot));
        if (inserted == 1) audit(userId, planId, "PLAN_CREATED", null, Map.of("title", title.trim()));
        return inserted == 1;
    }

    public List<PlanHistory.Summary> list(UUID userId) {
        return jdbc.query("""
                        SELECT plan_id, title, plan_year, plan_quarter, status, source_revision,
                               created_at, updated_at, activated_at, closed_at, archived_at
                        FROM planner_plan
                        WHERE user_id = ?
                        ORDER BY CASE status WHEN 'ACTIVE' THEN 0 WHEN 'DRAFT' THEN 1 WHEN 'CLOSED' THEN 2 ELSE 3 END,
                                 updated_at DESC
                        """, (rs, row) -> summary(rs), userId);
    }

    public Optional<PlanHistory.Detail> find(UUID userId, UUID planId) {
        return jdbc.query("""
                        SELECT plan_id, title, plan_year, plan_quarter, status, source_revision,
                               snapshot::text, created_at, updated_at, activated_at, closed_at, archived_at
                        FROM planner_plan WHERE user_id = ? AND plan_id = ?
                        """, rs -> {
            if (!rs.next()) return Optional.empty();
            String snapshotJson = rs.getString("snapshot");
            PlannerSnapshot snapshot = snapshotJson == null ? null : read(snapshotJson, PlannerSnapshot.class);
            return Optional.of(new PlanHistory.Detail(summary(rs), snapshot));
        }, userId, planId);
    }

    public Optional<PlanHistory.Summary> transition(
            UUID userId,
            UUID planId,
            PlanHistory.Status expected,
            PlanHistory.Status target
    ) {
        String timestampColumn = switch (target) {
            case ACTIVE -> "activated_at";
            case CLOSED -> "closed_at";
            case ARCHIVED -> "archived_at";
            case DRAFT -> null;
        };
        String timestampChange = timestampColumn == null ? "" : ", " + timestampColumn + " = now()";
        int updated = jdbc.update("""
                        UPDATE planner_plan SET status = ?, updated_at = now()%s
                        WHERE user_id = ? AND plan_id = ? AND status = ?
                        """.formatted(timestampChange), target.name(), userId, planId, expected.name());
        if (updated != 1) return Optional.empty();
        audit(userId, planId, "PLAN_" + target.name(), null, Map.of("from", expected.name()));
        return find(userId, planId).map(PlanHistory.Detail::plan);
    }

    public int closeOtherActive(UUID userId, UUID exceptPlanId) {
        List<UUID> closing = jdbc.query("""
                        SELECT plan_id FROM planner_plan
                        WHERE user_id = ? AND status = 'ACTIVE' AND plan_id <> ?
                        """, (rs, row) -> rs.getObject(1, UUID.class), userId, exceptPlanId);
        int updated = jdbc.update("""
                        UPDATE planner_plan SET status = 'CLOSED', closed_at = now(), updated_at = now()
                        WHERE user_id = ? AND status = 'ACTIVE' AND plan_id <> ?
                        """, userId, exceptPlanId);
        closing.forEach(planId -> audit(userId, planId, "PLAN_CLOSED", null, Map.of("reason", "another-plan-activated")));
        return updated;
    }

    public List<PlanHistory.AuditEvent> auditEvents(UUID userId, UUID planId) {
        return jdbc.query("""
                        SELECT event_id, plan_id, action, revision, details::text, occurred_at
                        FROM planner_audit_event
                        WHERE user_id = ? AND plan_id = ?
                        ORDER BY occurred_at DESC, event_id DESC
                        LIMIT 500
                        """, (rs, row) -> new PlanHistory.AuditEvent(
                rs.getObject("event_id", UUID.class),
                rs.getObject("plan_id", UUID.class),
                rs.getString("action"),
                rs.getObject("revision", Long.class),
                read(rs.getString("details"), new TypeReference<>() {}),
                rs.getTimestamp("occurred_at").toInstant()), userId, planId);
    }

    public void audit(UUID userId, UUID planId, String action, Long revision, Map<String, Object> details) {
        jdbc.update("""
                        INSERT INTO planner_audit_event (
                            event_id, user_id, plan_id, action, revision, details
                        ) VALUES (?, ?, ?, ?, ?, CAST(? AS jsonb))
                        """, UUID.randomUUID(), userId, planId, action, revision, json(details));
    }

    private PlanHistory.Summary summary(java.sql.ResultSet rs) throws java.sql.SQLException {
        return new PlanHistory.Summary(
                rs.getObject("plan_id", UUID.class),
                rs.getString("title"),
                rs.getInt("plan_year"),
                rs.getInt("plan_quarter"),
                PlanHistory.Status.valueOf(rs.getString("status")),
                rs.getObject("source_revision", Long.class),
                instant(rs.getTimestamp("created_at")),
                instant(rs.getTimestamp("updated_at")),
                instant(rs.getTimestamp("activated_at")),
                instant(rs.getTimestamp("closed_at")),
                instant(rs.getTimestamp("archived_at")));
    }

    private String defaultTitle(PlannerSnapshot snapshot) {
        return snapshot.plan().year() + "년 " + snapshot.plan().quarter() + "분기";
    }

    private Instant instant(Timestamp value) {
        return value == null ? null : value.toInstant();
    }

    private String json(Object value) {
        try {
            return objectMapper.writeValueAsString(value);
        } catch (JacksonException exception) {
            throw new IllegalStateException("Could not serialize plan history", exception);
        }
    }

    private <T> T read(String value, Class<T> type) {
        try {
            return objectMapper.readValue(value, type);
        } catch (JacksonException exception) {
            throw new IllegalStateException("Could not read plan history", exception);
        }
    }

    private <T> T read(String value, TypeReference<T> type) {
        try {
            return objectMapper.readValue(value, type);
        } catch (JacksonException exception) {
            throw new IllegalStateException("Could not read plan history details", exception);
        }
    }
}
