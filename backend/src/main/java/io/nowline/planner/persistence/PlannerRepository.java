package io.nowline.planner.persistence;

import io.nowline.planner.domain.PlannerEnvelope;
import io.nowline.planner.domain.PlannerSnapshot;
import io.nowline.planner.service.PlannerException;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Repository;

import java.math.BigDecimal;
import java.sql.PreparedStatement;
import java.sql.SQLException;
import java.sql.Timestamp;
import java.sql.Types;
import java.time.Instant;
import java.time.LocalDate;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.UUID;

import static io.nowline.planner.persistence.JdbcValues.id;

@Repository
public class PlannerRepository {

    private static final int BATCH_SIZE = 500;

    private final JdbcTemplate jdbc;

    public PlannerRepository(JdbcTemplate jdbc) {
        this.jdbc = jdbc;
    }

    public void lockUser(UUID userId) {
        List<String> locked = jdbc.query(
                "SELECT user_id FROM app_user WHERE user_id = ? FOR UPDATE",
                (resultSet, rowNumber) -> resultSet.getString(1),
                id(userId));
        if (locked.size() != 1) {
            throw PlannerException.deletedAccountSession();
        }
    }

    public Optional<Long> findRevision(UUID userId) {
        List<Long> rows = jdbc.query("SELECT revision FROM planner_aggregate WHERE user_id = ?",
                (resultSet, rowNumber) -> resultSet.getLong(1), id(userId));
        return rows.stream().findFirst();
    }

    public long nextRevision(UUID userId) {
        jdbc.update("""
                        INSERT INTO planner_revision_clock (user_id, last_revision)
                        VALUES (?, 1)
                        ON DUPLICATE KEY UPDATE
                            last_revision = planner_revision_clock.last_revision + 1,
                            updated_at = CURRENT_TIMESTAMP(6)
                        """, id(userId));
        Long revision = jdbc.queryForObject(
                "SELECT last_revision FROM planner_revision_clock WHERE user_id = ?",
                Long.class,
                id(userId));
        if (revision == null) {
            throw new IllegalStateException("Revision clock returned no value");
        }
        return revision;
    }

    public Optional<PlannerEnvelope> find(UUID userId) {
        AggregateRow aggregate = findAggregate(userId);
        if (aggregate == null) {
            return Optional.empty();
        }

        Map<String, List<PlannerSnapshot.MetricHistoryEntry>> metricHistory = new LinkedHashMap<>();
        List<OutcomeMetricRow> metricRows = jdbc.query("""
                        SELECT outcome_id, history_id, metric_value, observed_at, evidence
                        FROM planner_outcome_metric_history
                        WHERE user_id = ?
                        ORDER BY outcome_id, sort_order
                        """, (rs, row) -> new OutcomeMetricRow(
                                rs.getString("outcome_id"),
                                rs.getString("history_id"),
                                rs.getBigDecimal("metric_value"),
                                rs.getTimestamp("observed_at").toInstant(),
                                rs.getString("evidence")), id(userId));
        metricRows.forEach(value -> metricHistory
                .computeIfAbsent(value.outcomeId(), ignored -> new ArrayList<>())
                .add(new PlannerSnapshot.MetricHistoryEntry(
                        value.historyId(), value.value(), value.observedAt(), value.evidence())));

        List<PlannerSnapshot.Outcome> outcomes = jdbc.query("""
                        SELECT outcome_id, title, parent_title, current_value, target_value, unit,
                               confidence, last_updated_days, metric_updated_at, next_check_date,
                               actual_hours, needed_hours, available_hours,
                               evidence_label, change_label, attention, decision
                        FROM planner_outcome WHERE user_id = ? ORDER BY sort_order
                        """,
                (rs, row) -> new PlannerSnapshot.Outcome(
                        rs.getString("outcome_id"),
                        rs.getString("title"),
                        rs.getString("parent_title"),
                        rs.getBigDecimal("current_value"),
                        rs.getBigDecimal("target_value"),
                        rs.getString("unit"),
                        PlannerSnapshot.Confidence.from(rs.getString("confidence")),
                        rs.getObject("last_updated_days", Integer.class),
                        instant(rs.getTimestamp("metric_updated_at")),
                        rs.getObject("next_check_date", LocalDate.class),
                        List.copyOf(metricHistory.getOrDefault(rs.getString("outcome_id"), List.of())),
                        rs.getBigDecimal("actual_hours"),
                        rs.getBigDecimal("needed_hours"),
                        rs.getBigDecimal("available_hours"),
                        rs.getString("evidence_label"),
                        rs.getString("change_label"),
                        PlannerSnapshot.Attention.from(rs.getString("attention")),
                        rs.getString("decision") == null ? null : PlannerSnapshot.Decision.from(rs.getString("decision"))
                ), id(userId));

        List<PlannerSnapshot.Task> tasks = jdbc.query("""
                        SELECT task_id, title, outcome_id, estimate_minutes, status, pinned, carry_count, note
                        FROM planner_task WHERE user_id = ? ORDER BY sort_order
                        """,
                (rs, row) -> new PlannerSnapshot.Task(
                        rs.getString("task_id"),
                        rs.getString("title"),
                        rs.getString("outcome_id"),
                        rs.getInt("estimate_minutes"),
                        PlannerSnapshot.TaskStatus.from(rs.getString("status")),
                        rs.getBoolean("pinned"),
                        rs.getInt("carry_count"),
                        rs.getString("note")
                ), id(userId));

        List<PlannerSnapshot.TimeBlock> blocks = jdbc.query("""
                        SELECT block_id, task_id, title, day_key, start_minutes, duration_minutes,
                               external, week_offset, block_date
                        FROM planner_time_block WHERE user_id = ? ORDER BY sort_order
                        """,
                (rs, row) -> new PlannerSnapshot.TimeBlock(
                        rs.getString("block_id"),
                        rs.getString("task_id"),
                        rs.getString("title"),
                        PlannerSnapshot.DayKey.from(rs.getString("day_key")),
                        rs.getInt("start_minutes"),
                        rs.getInt("duration_minutes"),
                        rs.getBoolean("external"),
                        rs.getInt("week_offset"),
                        rs.getObject("block_date", LocalDate.class)
                ), id(userId));

        List<PlannerSnapshot.TimeEntry> entries = jdbc.query("""
                        SELECT entry_id, task_id, duration_seconds, source, observed_at, evidence
                        FROM planner_time_entry WHERE user_id = ? ORDER BY sort_order
                        """,
                (rs, row) -> new PlannerSnapshot.TimeEntry(
                        rs.getString("entry_id"),
                        rs.getString("task_id"),
                        rs.getLong("duration_seconds"),
                        PlannerSnapshot.TimeSource.from(rs.getString("source")),
                        rs.getTimestamp("observed_at").toInstant(),
                        rs.getString("evidence")
                ), id(userId));

        PlannerSnapshot.TimerSession timer = jdbc.query("""
                        SELECT task_id, started_at, accumulated_seconds, paused
                        FROM planner_timer WHERE user_id = ?
                        """, rs -> rs.next() ? new PlannerSnapshot.TimerSession(
                        rs.getString("task_id"),
                        rs.getObject("started_at", Long.class),
                        rs.getLong("accumulated_seconds"),
                        rs.getBoolean("paused")) : null, id(userId));

        List<String> topTasks = jdbc.query("""
                        SELECT task_id FROM planner_review_top_task WHERE user_id = ? ORDER BY position
                        """, (rs, row) -> rs.getString("task_id"), id(userId));

        PlannerSnapshot snapshot = new PlannerSnapshot(
                aggregate.version(),
                new PlannerSnapshot.PlanContext(
                        aggregate.year(), aggregate.annualDirection(), aggregate.quarter(),
                        aggregate.quarterFocus(), aggregate.quarterEndDate()),
                aggregate.plannerWeekOffset(),
                tasks,
                blocks,
                entries,
                outcomes,
                timer,
                new PlannerSnapshot.ReviewState(
                        aggregate.reviewBlocker(), topTasks, aggregate.reviewMetricDraft(), aggregate.reviewCompletedAt())
        );
        return Optional.of(new PlannerEnvelope(aggregate.revision(), snapshot));
    }

    public void insert(UUID userId, UUID planId, long revision, PlannerSnapshot snapshot) {
        int inserted = jdbc.update("""
                        INSERT INTO planner_aggregate (
                            user_id, plan_id, revision, snapshot_version, planner_week_offset, plan_year,
                            annual_direction, plan_quarter, quarter_focus, quarter_end_date,
                            review_blocker, review_metric_draft, review_completed_at
                        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                        """,
                id(userId), id(planId), revision, snapshot.version(), snapshot.plannerWeekOffset(), snapshot.plan().year(),
                snapshot.plan().annualDirection(), snapshot.plan().quarter(), snapshot.plan().quarterFocus(),
                snapshot.plan().quarterEndDate(), snapshot.review().blocker(), snapshot.review().metricDraft(),
                timestamp(snapshot.review().completedAt()));
        requireOneRow(inserted);
        insertChildren(userId, snapshot);
    }

    public boolean replace(
            UUID userId,
            UUID planId,
            long expectedRevision,
            long nextRevision,
            PlannerSnapshot snapshot
    ) {
        int updated = jdbc.update("""
                        UPDATE planner_aggregate
                        SET plan_id = ?, revision = ?,
                            snapshot_version = ?, planner_week_offset = ?, plan_year = ?, annual_direction = ?,
                            plan_quarter = ?, quarter_focus = ?, quarter_end_date = ?, review_blocker = ?,
                            review_metric_draft = ?, review_completed_at = ?, updated_at = CURRENT_TIMESTAMP(6)
                        WHERE user_id = ? AND revision = ?
                        """,
                id(planId), nextRevision, snapshot.version(), snapshot.plannerWeekOffset(), snapshot.plan().year(),
                snapshot.plan().annualDirection(), snapshot.plan().quarter(), snapshot.plan().quarterFocus(),
                snapshot.plan().quarterEndDate(), snapshot.review().blocker(), snapshot.review().metricDraft(),
                timestamp(snapshot.review().completedAt()), id(userId), expectedRevision);
        if (updated != 1) {
            return false;
        }
        deleteChildren(userId);
        insertChildren(userId, snapshot);
        return true;
    }

    public boolean delete(UUID userId, long expectedRevision) {
        return jdbc.update("DELETE FROM planner_aggregate WHERE user_id = ? AND revision = ?", id(userId), expectedRevision) == 1;
    }

    public Optional<IdempotencyRecord> findIdempotency(UUID userId, String operation, String key) {
        return jdbc.query("""
                        SELECT request_hash, response_status, result_revision, response_body
                        FROM planner_idempotency
                        WHERE user_id = ? AND operation = ? AND idempotency_key = ?
                        """, rs -> rs.next() ? Optional.of(new IdempotencyRecord(
                        rs.getString("request_hash"),
                        rs.getInt("response_status"),
                        rs.getObject("result_revision", Long.class),
                        rs.getString("response_body"))) : Optional.empty(), id(userId), operation, key);
    }

    public void saveIdempotency(
            UUID userId,
            String operation,
            String key,
            String requestHash,
            int responseStatus,
            Long resultRevision,
            String responseBody
    ) {
        jdbc.update("""
                        INSERT INTO planner_idempotency (
                            user_id, operation, idempotency_key, request_hash,
                            response_status, result_revision, response_body
                        ) VALUES (?, ?, ?, ?, ?, ?, ?)
                        """, id(userId), operation, key, requestHash, responseStatus, resultRevision, responseBody);
    }

    private AggregateRow findAggregate(UUID userId) {
        return jdbc.query("""
                        SELECT revision, snapshot_version, planner_week_offset, plan_year, annual_direction,
                               plan_quarter, quarter_focus, quarter_end_date, review_blocker,
                               review_metric_draft, review_completed_at
                        FROM planner_aggregate WHERE user_id = ?
                        """, rs -> rs.next() ? new AggregateRow(
                        rs.getLong("revision"),
                        rs.getInt("snapshot_version"),
                        rs.getInt("planner_week_offset"),
                        rs.getInt("plan_year"),
                        rs.getString("annual_direction"),
                        rs.getInt("plan_quarter"),
                        rs.getString("quarter_focus"),
                        rs.getObject("quarter_end_date", LocalDate.class),
                        rs.getString("review_blocker"),
                        rs.getString("review_metric_draft"),
                        instant(rs.getTimestamp("review_completed_at"))) : null, id(userId));
    }

    private void deleteChildren(UUID userId) {
        jdbc.update("DELETE FROM planner_review_top_task WHERE user_id = ?", id(userId));
        jdbc.update("DELETE FROM planner_timer WHERE user_id = ?", id(userId));
        jdbc.update("DELETE FROM planner_time_entry WHERE user_id = ?", id(userId));
        jdbc.update("DELETE FROM planner_time_block WHERE user_id = ?", id(userId));
        jdbc.update("DELETE FROM planner_task WHERE user_id = ?", id(userId));
        jdbc.update("DELETE FROM planner_outcome_metric_history WHERE user_id = ?", id(userId));
        jdbc.update("DELETE FROM planner_outcome WHERE user_id = ?", id(userId));
    }

    private void insertChildren(UUID userId, PlannerSnapshot snapshot) {
        insertOutcomes(userId, snapshot.outcomes());
        insertOutcomeMetricHistory(userId, snapshot.outcomes());
        insertTasks(userId, snapshot.tasks());
        insertTimeBlocks(userId, snapshot.timeBlocks());
        insertTimeEntries(userId, snapshot.timeEntries());
        insertTimer(userId, snapshot.timer());
        insertReviewTopTasks(userId, snapshot.review().selectedTopTaskIds());
    }

    private void insertOutcomes(UUID userId, List<PlannerSnapshot.Outcome> outcomes) {
        batch("""
                        INSERT INTO planner_outcome (
                            user_id, outcome_id, sort_order, title, parent_title, current_value, target_value,
                            unit, confidence, last_updated_days, metric_updated_at, next_check_date,
                            actual_hours, needed_hours, available_hours,
                            evidence_label, change_label, attention, decision
                        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                        """, outcomes, (statement, item) -> {
            PlannerSnapshot.Outcome value = item.value();
            statement.setString(1, id(userId));
            statement.setString(2, value.id());
            statement.setInt(3, item.index());
            statement.setString(4, value.title());
            statement.setString(5, value.parentTitle());
            setBigDecimal(statement, 6, value.current());
            statement.setBigDecimal(7, value.target());
            statement.setString(8, value.unit());
            statement.setString(9, value.confidence().value());
            setInteger(statement, 10, value.lastUpdatedDays());
            statement.setTimestamp(11, timestamp(value.metricUpdatedAt()));
            setLocalDate(statement, 12, value.nextCheckDate());
            statement.setBigDecimal(13, value.actualHours());
            statement.setBigDecimal(14, value.neededHours());
            statement.setBigDecimal(15, value.availableHours());
            statement.setString(16, value.evidenceLabel());
            statement.setString(17, value.changeLabel());
            statement.setString(18, value.attention().value());
            statement.setString(19, value.decision() == null ? null : value.decision().value());
        });
    }

    private void insertOutcomeMetricHistory(UUID userId, List<PlannerSnapshot.Outcome> outcomes) {
        List<OutcomeMetricValue> values = new ArrayList<>();
        for (PlannerSnapshot.Outcome outcome : outcomes) {
            List<PlannerSnapshot.MetricHistoryEntry> history = outcome.metricHistoryOrEmpty();
            for (int index = 0; index < history.size(); index++) {
                values.add(new OutcomeMetricValue(outcome.id(), index, history.get(index)));
            }
        }
        batch("""
                        INSERT INTO planner_outcome_metric_history (
                            user_id, outcome_id, history_id, sort_order, metric_value, observed_at, evidence
                        ) VALUES (?, ?, ?, ?, ?, ?, ?)
                        """, values, (statement, item) -> {
            OutcomeMetricValue value = item.value();
            statement.setString(1, id(userId));
            statement.setString(2, value.outcomeId());
            statement.setString(3, value.entry().id());
            statement.setInt(4, value.sortOrder());
            setBigDecimal(statement, 5, value.entry().value());
            statement.setTimestamp(6, Timestamp.from(value.entry().observedAt()));
            statement.setString(7, value.entry().evidence());
        });
    }

    private void insertTasks(UUID userId, List<PlannerSnapshot.Task> tasks) {
        batch("""
                        INSERT INTO planner_task (
                            user_id, task_id, sort_order, title, outcome_id, estimate_minutes,
                            status, pinned, carry_count, note
                        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                        """, tasks, (statement, item) -> {
            PlannerSnapshot.Task value = item.value();
            statement.setString(1, id(userId));
            statement.setString(2, value.id());
            statement.setInt(3, item.index());
            statement.setString(4, value.title());
            statement.setString(5, value.outcomeId());
            statement.setInt(6, value.estimateMinutes());
            statement.setString(7, value.status().value());
            statement.setBoolean(8, value.pinned());
            statement.setInt(9, value.carryCount());
            statement.setString(10, value.note());
        });
    }

    private void insertTimeBlocks(UUID userId, List<PlannerSnapshot.TimeBlock> blocks) {
        batch("""
                        INSERT INTO planner_time_block (
                            user_id, block_id, sort_order, task_id, title, day_key,
                            start_minutes, duration_minutes, external, week_offset, block_date
                        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                        """, blocks, (statement, item) -> {
            PlannerSnapshot.TimeBlock value = item.value();
            statement.setString(1, id(userId));
            statement.setString(2, value.id());
            statement.setInt(3, item.index());
            statement.setString(4, value.taskId());
            statement.setString(5, value.title());
            statement.setString(6, value.day().value());
            statement.setInt(7, value.startMinutes());
            statement.setInt(8, value.durationMinutes());
            statement.setBoolean(9, value.externalOrFalse());
            statement.setInt(10, value.weekOffsetOrZero());
            setLocalDate(statement, 11, value.date());
        });
    }

    private void insertTimeEntries(UUID userId, List<PlannerSnapshot.TimeEntry> entries) {
        batch("""
                        INSERT INTO planner_time_entry (
                            user_id, entry_id, sort_order, task_id, duration_seconds, source, observed_at, evidence
                        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
                        """, entries, (statement, item) -> {
            PlannerSnapshot.TimeEntry value = item.value();
            statement.setString(1, id(userId));
            statement.setString(2, value.id());
            statement.setInt(3, item.index());
            statement.setString(4, value.taskId());
            statement.setLong(5, value.durationSeconds());
            statement.setString(6, value.source().value());
            statement.setTimestamp(7, Timestamp.from(value.observedAt()));
            statement.setString(8, value.evidence());
        });
    }

    private void insertTimer(UUID userId, PlannerSnapshot.TimerSession timer) {
        if (timer == null) {
            return;
        }
        jdbc.update("""
                        INSERT INTO planner_timer (user_id, task_id, started_at, accumulated_seconds, paused)
                        VALUES (?, ?, ?, ?, ?)
                """, id(userId), timer.taskId(), timer.startedAt(), timer.accumulatedSeconds(), timer.paused());
    }

    private void insertReviewTopTasks(UUID userId, List<String> taskIds) {
        batch("""
                        INSERT INTO planner_review_top_task (user_id, position, task_id) VALUES (?, ?, ?)
                        """, taskIds, (statement, item) -> {
            statement.setString(1, id(userId));
            statement.setInt(2, item.index());
            statement.setString(3, item.value());
        });
    }

    private <T> void batch(String sql, List<T> values, IndexedSetter<T> setter) {
        if (values.isEmpty()) {
            return;
        }
        List<Indexed<T>> indexed = new ArrayList<>(values.size());
        for (int index = 0; index < values.size(); index++) {
            indexed.add(new Indexed<>(index, values.get(index)));
        }
        jdbc.batchUpdate(sql, indexed, BATCH_SIZE, (statement, item) -> setter.set(statement, item));
    }

    private static void setBigDecimal(PreparedStatement statement, int index, BigDecimal value) throws SQLException {
        if (value == null) {
            statement.setNull(index, Types.NUMERIC);
        } else {
            statement.setBigDecimal(index, value);
        }
    }

    private static void setInteger(PreparedStatement statement, int index, Integer value) throws SQLException {
        if (value == null) {
            statement.setNull(index, Types.INTEGER);
        } else {
            statement.setInt(index, value);
        }
    }

    private static void setLocalDate(PreparedStatement statement, int index, LocalDate value) throws SQLException {
        if (value == null) {
            statement.setNull(index, Types.DATE);
        } else {
            statement.setDate(index, java.sql.Date.valueOf(value));
        }
    }

    private static Timestamp timestamp(Instant instant) {
        return instant == null ? null : Timestamp.from(instant);
    }

    private static Instant instant(Timestamp timestamp) {
        return timestamp == null ? null : timestamp.toInstant();
    }

    private static void requireOneRow(int count) {
        if (count != 1) {
            throw new IllegalStateException("Expected exactly one aggregate row but changed " + count);
        }
    }

    private record AggregateRow(
            long revision,
            int version,
            int plannerWeekOffset,
            int year,
            String annualDirection,
            int quarter,
            String quarterFocus,
            LocalDate quarterEndDate,
            String reviewBlocker,
            String reviewMetricDraft,
            Instant reviewCompletedAt
    ) {
    }

    private record Indexed<T>(int index, T value) {
    }

    private record OutcomeMetricValue(
            String outcomeId,
            int sortOrder,
            PlannerSnapshot.MetricHistoryEntry entry
    ) {
    }

    private record OutcomeMetricRow(
            String outcomeId,
            String historyId,
            BigDecimal value,
            Instant observedAt,
            String evidence
    ) {
    }

    @FunctionalInterface
    private interface IndexedSetter<T> {
        void set(PreparedStatement statement, Indexed<T> item) throws SQLException;
    }
}
