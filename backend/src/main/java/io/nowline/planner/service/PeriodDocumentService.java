package io.nowline.planner.service;

import io.nowline.planner.config.DatabaseWriteExecutor;
import io.nowline.planner.domain.PeriodDocument;
import io.nowline.planner.domain.PeriodDocument.*;
import io.nowline.planner.domain.PlannerSnapshot;
import io.nowline.planner.persistence.PlannerRepository;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import tools.jackson.databind.ObjectMapper;

import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.time.DayOfWeek;
import java.time.Instant;
import java.time.LocalDate;
import java.time.temporal.TemporalAdjusters;
import java.util.*;
import static io.nowline.planner.persistence.JdbcValues.id;

@Service
public class PeriodDocumentService {
    private final JdbcTemplate jdbc;
    private final PlannerRepository planner;
    private final DatabaseWriteExecutor writes;
    private final ObjectMapper json;
    public PeriodDocumentService(JdbcTemplate jdbc, PlannerRepository planner, DatabaseWriteExecutor writes, ObjectMapper json) {
        this.jdbc = jdbc; this.planner = planner; this.writes = writes; this.json = json;
    }

    @Transactional(readOnly = true)
    public List<PeriodDocument> list(UUID userId) {
        return jdbc.query("SELECT body FROM period_document WHERE user_id = ? ORDER BY updated_at DESC, document_id",
                (rs, row) -> json.readValue(rs.getString(1), PeriodDocument.class), id(userId));
    }

    public PeriodDocument save(UUID userId, Write request) {
        return writes.execute(() -> {
            planner.lockUser(userId);
            validate(request);
            String hash = hash(json.writeValueAsString(request));
            var replay = jdbc.query("SELECT request_hash, body FROM period_document_history WHERE user_id = ? AND mutation_id = ?",
                    (rs, row) -> Map.entry(rs.getString(1), rs.getString(2)), id(userId), request.mutationId());
            if (!replay.isEmpty()) {
                if (!replay.getFirst().getKey().equals(hash)) throw PlannerException.idempotencyConflict();
                return json.readValue(replay.getFirst().getValue(), PeriodDocument.class);
            }
            String key = request.goal() != null ? request.goal().id() : request.review().id();
            var documents = list(userId);
            var current = documents.stream().filter(d -> d.id().equals(key)).findFirst().orElse(null);
            long revision = current == null ? 0 : current.revision();
            if (revision != request.expectedRevision()) throw PlannerException.preconditionFailed(revision);
            if (current == null && request.deleted()) throw PlannerException.planNotFound();
            if (current == null && documents.size() >= 20000) throw PlannerException.validation("documents", "보관 가능한 기록 수를 초과했습니다.");
            if (request.goal() != null) validateGoalLinks(userId, request.goal(), documents, current, request.deleted());
            if (request.deleted() && request.goal() != null && documents.stream().anyMatch(d -> !d.deleted() && d.goal() != null && key.equals(d.goal().parentId()))) {
                throw PlannerException.validation("parentId", "하위 목표의 상위 연결을 먼저 해제해 주세요. 할 일은 삭제되지 않습니다.");
            }
            // A later text edit must not replace the goal measurements captured in an older review.
            List<Goal> checkpoints = request.review() == null ? List.of() : current != null
                    ? current.goalCheckpoints()
                    : documents.stream().filter(d -> !d.deleted() && d.goal() != null
                        && !d.goal().startDate().isAfter(request.review().endDate())
                        && !d.goal().endDate().isBefore(request.review().startDate())).map(PeriodDocument::goal).toList();
            var result = new PeriodDocument(revision + 1, request.goal(), request.review(), request.deleted(), Instant.now(), checkpoints);
            String body = json.writeValueAsString(result);
            jdbc.update("""
                    INSERT INTO period_document (user_id, document_id, revision, body, deleted)
                    VALUES (?, ?, ?, ?, ?) ON DUPLICATE KEY UPDATE revision = ?, body = ?, deleted = ?, updated_at = CURRENT_TIMESTAMP(6)
                    """, id(userId), key, result.revision(), body, result.deleted(), result.revision(), body, result.deleted());
            jdbc.update("INSERT INTO period_document_history (user_id, document_id, revision, body, mutation_id, request_hash) VALUES (?, ?, ?, ?, ?, ?)",
                    id(userId), key, result.revision(), body, request.mutationId(), hash);
            return result;
        });
    }

    public static void validate(Write request) {
        if ((request.goal() == null) == (request.review() == null)) throw PlannerException.validation("document", "목표 또는 회고 하나만 저장할 수 있습니다.");
        var goal = request.goal();
        var review = request.review();
        Period period = goal != null ? goal.period() : review.period();
        LocalDate start = goal != null ? goal.startDate() : review.startDate();
        LocalDate end = goal != null ? goal.endDate() : review.endDate();
        // Reject unsupported years before doing calendar arithmetic that could overflow.
        if (start.getYear() < 1900 || start.getYear() > 9999 || end.getYear() < 1900 || end.getYear() > 9999) {
            throw PlannerException.validation("period", "1900년부터 9999년까지의 기간을 선택해 주세요.");
        }
        LocalDate canonical = switch (period) {
            case day -> start;
            case week -> start.with(TemporalAdjusters.previousOrSame(DayOfWeek.MONDAY));
            case month -> start.withDayOfMonth(1);
            case quarter -> LocalDate.of(start.getYear(), ((start.getMonthValue() - 1) / 3) * 3 + 1, 1);
            case year -> start.withDayOfYear(1);
        };
        LocalDate expectedEnd = switch (period) {
            case day -> canonical;
            case week -> canonical.plusDays(6);
            case month -> canonical.plusMonths(1).minusDays(1);
            case quarter -> canonical.plusMonths(3).minusDays(1);
            case year -> canonical.plusYears(1).minusDays(1);
        };
        if (!start.equals(canonical) || !end.equals(expectedEnd)) {
            throw PlannerException.validation("period", "선택한 기간의 시작일과 종료일을 확인해 주세요.");
        }
        if (review != null && !review.id().equals("review-" + period + "-" + start)) throw PlannerException.validation("id", "회고 날짜가 일치하지 않습니다.");
        if (goal != null && goal.measurement() == Measurement.number && goal.target().compareTo(goal.baseline()) == 0) {
            throw PlannerException.validation("target", "수치 목표는 기준값과 목표값이 달라야 합니다.");
        }
        if (goal != null && new HashSet<>(goal.taskIds()).size() != goal.taskIds().size()) throw PlannerException.validation("taskIds", "같은 할 일을 중복 연결할 수 없습니다.");
    }

    private void validateGoalLinks(UUID userId, Goal goal, List<PeriodDocument> documents, PeriodDocument current, boolean deleted) {
        if (deleted) return;
        Map<String, Goal> goals = new HashMap<>();
        documents.stream().filter(d -> !d.deleted() && d.goal() != null).forEach(d -> goals.put(d.id(), d.goal()));
        goals.put(goal.id(), goal);
        Set<String> visited = new HashSet<>();
        Goal node = goal;
        while (node != null) {
            if (!visited.add(node.id())) throw PlannerException.validation("parentId", "상위 목표 연결이 순환할 수 없습니다.");
            if (node.parentId() != null && !goals.containsKey(node.parentId())) throw PlannerException.validation("parentId", "이 계정의 사용 가능한 상위 목표를 선택해 주세요.");
            node = node.parentId() == null ? null : goals.get(node.parentId());
        }
        Set<String> allowed = new HashSet<>();
        if (current != null && current.goal() != null) allowed.addAll(current.goal().taskIds());
        planner.find(userId).ifPresent(p -> p.snapshot().tasks().forEach(t -> allowed.add(t.id())));
        if (!allowed.containsAll(goal.taskIds())) throw PlannerException.validation("taskIds", "할 일이 서버에 저장된 뒤 연결해 주세요.");
    }

    /** Closed plans remain readable; drafts never count as executed work. */
    @Transactional(readOnly = true)
    public List<PlannerSnapshot> archivedExecution(UUID userId) {
        return jdbc.query("SELECT snapshot FROM planner_plan WHERE user_id = ? AND status IN ('CLOSED','ARCHIVED') AND snapshot IS NOT NULL",
                (rs, row) -> json.readValue(rs.getString(1), PlannerSnapshot.class), id(userId));
    }

    private static String hash(String value) {
        try { return HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256").digest(value.getBytes(StandardCharsets.UTF_8))); }
        catch (NoSuchAlgorithmException e) { throw new IllegalStateException(e); }
    }
}
