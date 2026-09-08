package io.nowline.planner.ai;

import io.nowline.planner.account.UserPreferenceService;
import io.nowline.planner.domain.PeriodDocument;
import io.nowline.planner.domain.PlannerSnapshot;
import io.nowline.planner.persistence.PlannerRepository;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import tools.jackson.databind.ObjectMapper;
import java.time.*;
import java.util.*;

@Service
public class AiEvidenceService {
    private final PlannerRepository planner;
    private final JdbcTemplate jdbc;
    private final ObjectMapper json;
    private final UserPreferenceService preferences;
    public AiEvidenceService(PlannerRepository planner, JdbcTemplate jdbc, ObjectMapper json, UserPreferenceService preferences) {
        this.planner = planner; this.jdbc = jdbc; this.json = json; this.preferences = preferences;
    }
    @Transactional
    public Snapshot capture(UUID user, String period, LocalDate start, boolean reflections) {
        ZoneId zone = ZoneId.of(preferences.get(user).timezone());
        Instant now = Instant.now();
        LocalDate end = end(period, start);
        if (!end.isBefore(now.atZone(zone).toLocalDate())) throw new AiReviewException(422, "ai-period-open", "아직 끝나지 않은 기간은 직접 회고를 작성해 주세요.");
        Long historyBytes = jdbc.queryForObject("SELECT COALESCE(SUM(OCTET_LENGTH(snapshot)),0) FROM planner_plan WHERE user_id=? AND status IN ('CLOSED','ARCHIVED')",Long.class,user.toString());
        Long documentBytes = jdbc.queryForObject("SELECT COALESCE(SUM(OCTET_LENGTH(body)),0) FROM period_document WHERE user_id=? AND deleted=FALSE",Long.class,user.toString());
        if (historyBytes + documentBytes > 2_097_152L)
            throw new AiReviewException(422,"ai-input-too-large","보관 기록이 많아 분석을 중단했어요. 데이터 일부만 분석한 결과를 제공하지 않습니다.");
        List<PlannerSnapshot> sources = new ArrayList<>();
        planner.find(user).ifPresent(value -> sources.add(value.snapshot()));
        sources.addAll(jdbc.query("SELECT snapshot FROM planner_plan WHERE user_id=? AND status IN ('CLOSED','ARCHIVED') AND snapshot IS NOT NULL ORDER BY updated_at DESC, plan_id",
                (rs, row) -> json.readValue(rs.getString(1), PlannerSnapshot.class), user.toString()));
        var documents = jdbc.query("SELECT body FROM period_document WHERE user_id=? AND deleted=FALSE ORDER BY document_id",
                (rs, row) -> json.readValue(rs.getString(1), PeriodDocument.class), user.toString());
        return aggregate(period, start, end, zone, now, sources, documents, reflections);
    }
    static LocalDate end(String period, LocalDate start) {
        if (start == null || start.getYear() < 1900 || start.getYear() > 9998
                || !("week".equals(period) || "month".equals(period))
                || ("week".equals(period) && start.getDayOfWeek() != DayOfWeek.MONDAY)
                || ("month".equals(period) && start.getDayOfMonth() != 1))
            throw new AiReviewException(422, "ai-invalid-period", "월요일 또는 월 첫날부터 시작하는 주/월을 선택해 주세요.");
        return "week".equals(period) ? start.plusDays(6) : start.plusMonths(1).minusDays(1);
    }
    static Snapshot aggregate(String period, LocalDate start, LocalDate end, ZoneId zone, Instant now,
            List<PlannerSnapshot> sources, List<PeriodDocument> documents, boolean reflections) {
        Map<String, PlannerSnapshot.Task> tasks = new LinkedHashMap<>();
        Map<String, PlannerSnapshot.TimeBlock> blocks = new LinkedHashMap<>();
        Map<String, PlannerSnapshot.TimeEntry> entries = new LinkedHashMap<>();
        for (var source : sources) {
            source.tasks().forEach(t -> tasks.putIfAbsent(t.id(), t));
            source.timeBlocks().forEach(b -> blocks.putIfAbsent(b.id(), b));
            source.timeEntries().forEach(e -> entries.putIfAbsent(e.id(), e));
        }
        List<Evidence> evidence = new ArrayList<>();
        long completed = 0, recorded = 0;
        Map<LocalDate, List<int[]>> ranges = new TreeMap<>();
        for (var task : tasks.values()) if (task.status() == PlannerSnapshot.TaskStatus.DONE && task.completedAt() != null) {
            var date = task.completedAt().atZone(zone).toLocalDate();
            if (inside(date, start, end)) {
                completed++;
                evidence.add(new Evidence("task:" + task.id(), "completed-task", date.toString(), task.title(), Map.of("completedAt", task.completedAt().toString())));
            }
        }
        for (var block : blocks.values()) if (!block.externalOrFalse() && inside(block.date(), start, end)) {
            ranges.computeIfAbsent(block.date(), ignored -> new ArrayList<>()).add(new int[]{block.startMinutes(), Math.min(1440, block.startMinutes() + block.durationMinutes())});
            evidence.add(new Evidence("block:" + block.id(), "planned-block", block.date().toString(), block.title(),
                    Map.of("startMinutes", block.startMinutes(), "durationMinutes", block.durationMinutes(), "meaning", "plan-not-actual-execution")));
        }
        for (var entry : entries.values()) {
            var date = entry.observedAt().atZone(zone).toLocalDate();
            if (inside(date, start, end)) {
                recorded = Math.addExact(recorded, entry.durationSeconds());
                var task = tasks.get(entry.taskId());
                evidence.add(new Evidence("entry:" + entry.id(), "recorded-time", date.toString(), task == null ? "기록된 실행" : task.title(),
                        Map.of("durationSeconds", entry.durationSeconds(), "observedAt", entry.observedAt().toString(), "meaning", "observedAt-date-not-reconstructed-interval")));
            }
        }
        for (var document : documents) if (!document.deleted()) {
            var goal = document.goal();
            if (goal != null && !goal.endDate().isBefore(start) && !goal.startDate().isAfter(end)) {
                Map<String,Object> details = new LinkedHashMap<>();
                details.put("current", goal.current()); details.put("target", goal.target()); details.put("unit", goal.unit());
                details.put("measurement", goal.measurement().name()); details.put("done", goal.done()); details.put("baseline", goal.baseline());
                details.put("updatedAt", document.updatedAt().toString()); details.put("meaning", "current-value-at-capture-not-period-end");
                evidence.add(new Evidence("goal:" + goal.id(), "current-goal", null, goal.title(), details));
            }
            var review = document.review();
            if (reflections && review != null && !review.startDate().isBefore(start) && !review.endDate().isAfter(end)
                    && !(review.well() + review.blocked() + review.change() + review.note()).isBlank()) {
                evidence.add(new Evidence("review:" + review.id(), "reflection", review.startDate().toString(), "사용자 회고",
                        Map.of("well", review.well(), "blocked", review.blocked(), "change", review.change(), "note", review.note())));
            }
        }
        long planned = 0;
        for (var day : ranges.values()) {
            day.sort(Comparator.comparingInt(value -> value[0]));
            int previousEnd = 0;
            for (var range : day) { planned += Math.max(0, range[1] - Math.max(previousEnd, range[0])); previousEnd = Math.max(previousEnd, range[1]); }
        }
        evidence.sort(Comparator.comparing(Evidence::id));
        return new Snapshot(period, start, end, zone.getId(), now, new Metrics(completed, planned, recorded), List.copyOf(evidence));
    }
    private static boolean inside(LocalDate date, LocalDate start, LocalDate end) { return date != null && !date.isBefore(start) && !date.isAfter(end); }
    public record Metrics(long completedTasks, long plannedMinutes, long recordedSeconds) {}
    public record Evidence(String id, String kind, String date, String title, Map<String,Object> details) {}
    public record Snapshot(String period, LocalDate startDate, LocalDate endDate, String timezone, Instant capturedAt, Metrics metrics, List<Evidence> evidence) {}
}
