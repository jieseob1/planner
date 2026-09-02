package io.nowline.planner.service;

import io.nowline.planner.domain.PlannerSnapshot;
import io.nowline.planner.domain.PlannerSnapshot.TimeBlock;
import org.springframework.stereotype.Component;

import java.util.ArrayList;
import java.util.Comparator;
import java.time.Duration;
import java.time.Instant;
import java.util.HashSet;
import java.util.List;
import java.util.Map;
import java.util.Objects;
import java.util.Set;
import java.util.stream.Collectors;

@Component
public class PlannerSnapshotValidator {

    private static final Duration MAX_CLIENT_CLOCK_SKEW = Duration.ofMinutes(5);

    public PlannerSnapshot validateAndCanonicalize(PlannerSnapshot snapshot) {
        ensureUnique("outcomes[].id", snapshot.outcomes().stream().map(PlannerSnapshot.Outcome::id).toList());
        snapshot.outcomes().forEach(outcome -> ensureUnique(
                "outcomes[].metricHistory[].id",
                outcome.metricHistoryOrEmpty().stream().map(PlannerSnapshot.MetricHistoryEntry::id).toList()));
        ensureUnique("tasks[].id", snapshot.tasks().stream().map(PlannerSnapshot.Task::id).toList());
        ensureUnique("timeBlocks[].id", snapshot.timeBlocks().stream().map(TimeBlock::id).toList());
        ensureUnique("timeEntries[].id", snapshot.timeEntries().stream().map(PlannerSnapshot.TimeEntry::id).toList());
        ensureUnique("review.selectedTopTaskIds", snapshot.review().selectedTopTaskIds());

        Set<String> outcomeIds = snapshot.outcomes().stream()
                .map(PlannerSnapshot.Outcome::id)
                .collect(Collectors.toUnmodifiableSet());
        Set<String> taskIds = snapshot.tasks().stream()
                .map(PlannerSnapshot.Task::id)
                .collect(Collectors.toUnmodifiableSet());

        snapshot.tasks().forEach(task -> {
            if (task.outcomeId() != null && !outcomeIds.contains(task.outcomeId())) {
                throw PlannerException.validation("tasks[].outcomeId",
                        "할 일이 존재하지 않는 outcomeId를 참조합니다: " + task.outcomeId());
            }
        });
        snapshot.timeBlocks().forEach(block -> requireTask(taskIds, block.taskId(), "timeBlocks[].taskId", true));
        snapshot.timeEntries().forEach(entry -> requireTask(taskIds, entry.taskId(), "timeEntries[].taskId", false));
        snapshot.review().selectedTopTaskIds()
                .forEach(taskId -> requireTask(taskIds, taskId, "review.selectedTopTaskIds", false));
        if (snapshot.timer() != null) {
            requireTask(taskIds, snapshot.timer().taskId(), "timer.taskId", false);
            if (snapshot.timer().paused() && snapshot.timer().startedAt() != null) {
                throw PlannerException.validation("timer.startedAt", "일시 정지된 타이머의 startedAt은 null이어야 합니다.");
            }
            if (!snapshot.timer().paused() && snapshot.timer().startedAt() == null) {
                throw PlannerException.validation("timer.startedAt", "실행 중인 타이머에는 startedAt이 필요합니다.");
            }
        }

        List<TimeBlock> canonicalBlocks = snapshot.timeBlocks().stream()
                .map(block -> new TimeBlock(
                        block.id(), block.taskId(), block.title(), block.day(), block.startMinutes(),
                        block.durationMinutes(), block.externalOrFalse(), block.weekOffsetOrZero(), block.date()))
                .toList();
        validateTimeBlocks(canonicalBlocks);
        List<PlannerSnapshot.Outcome> canonicalOutcomes = snapshot.outcomes().stream()
                .map(this::canonicalOutcome)
                .toList();

        return new PlannerSnapshot(
                snapshot.version(),
                snapshot.plan(),
                snapshot.plannerWeekOffset(),
                List.copyOf(snapshot.tasks()),
                canonicalBlocks,
                List.copyOf(snapshot.timeEntries()),
                canonicalOutcomes,
                snapshot.timer(),
                new PlannerSnapshot.ReviewState(
                        snapshot.review().blocker(),
                        List.copyOf(snapshot.review().selectedTopTaskIds()),
                        snapshot.review().metricDraft(),
                        snapshot.review().completedAt())
        );
    }

    public void ensureMetricHistoryAppendOnly(PlannerSnapshot previous, PlannerSnapshot next) {
        Set<String> previousIds = previous.outcomes().stream()
                .map(PlannerSnapshot.Outcome::id)
                .collect(Collectors.toUnmodifiableSet());
        next.outcomes().stream()
                .filter(outcome -> !previousIds.contains(outcome.id()))
                .forEach(this::requireInitialMetricHistory);
        Map<String, PlannerSnapshot.Outcome> nextById = next.outcomes().stream()
                .collect(Collectors.toUnmodifiableMap(PlannerSnapshot.Outcome::id, outcome -> outcome));
        previous.outcomes().forEach(before -> {
            PlannerSnapshot.Outcome after = nextById.get(before.id());
            if (after == null) return; // Explicit outcome deletion is handled by the lifecycle API contract.
            List<PlannerSnapshot.MetricHistoryEntry> oldHistory = before.metricHistoryOrEmpty();
            List<PlannerSnapshot.MetricHistoryEntry> newHistory = after.metricHistoryOrEmpty();
            if (newHistory.size() < oldHistory.size()) {
                throw PlannerException.validation("outcomes[].metricHistory", "기존 지표 이력은 삭제할 수 없습니다.");
            }
            int appended = newHistory.size() - oldHistory.size();
            boolean prefixPreserved = java.util.stream.IntStream.range(0, oldHistory.size())
                    .allMatch(index -> sameHistoryEntry(oldHistory.get(index), newHistory.get(index)));
            if (!prefixPreserved) {
                throw PlannerException.validation("outcomes[].metricHistory", "기존 지표 이력은 수정하거나 재정렬할 수 없습니다.");
            }
            boolean metricChanged = !sameDecimal(before.current(), after.current())
                    || !Objects.equals(before.evidenceLabel(), after.evidenceLabel())
                    || !Objects.equals(before.metricUpdatedAt(), after.metricUpdatedAt());
            if (metricChanged && appended == 0) {
                throw PlannerException.validation("outcomes[].metricHistory", "지표 변경에는 값, 시각, 근거 이력이 필요합니다.");
            }
        });
    }

    public void ensureInitialMetricHistory(PlannerSnapshot snapshot) {
        snapshot.outcomes().forEach(this::requireInitialMetricHistory);
    }

    private PlannerSnapshot.Outcome canonicalOutcome(PlannerSnapshot.Outcome outcome) {
        List<PlannerSnapshot.MetricHistoryEntry> history = List.copyOf(outcome.metricHistoryOrEmpty());
        Instant latestAllowed = Instant.now().plus(MAX_CLIENT_CLOCK_SKEW);
        history.forEach(entry -> {
            if (entry.observedAt().isAfter(latestAllowed)) {
                throw PlannerException.validation("outcomes[].metricHistory[].observedAt",
                        "지표 관측 시각이 서버 현재 시각보다 너무 미래입니다.");
            }
        });
        for (int index = 1; index < history.size(); index++) {
            if (!history.get(index - 1).observedAt().isBefore(history.get(index).observedAt())) {
                throw PlannerException.validation("outcomes[].metricHistory", "지표 이력 시각은 단조 증가해야 합니다.");
            }
        }
        if (history.isEmpty()) {
            if (outcome.metricUpdatedAt() != null) {
                throw PlannerException.validation("outcomes[].metricUpdatedAt", "갱신 시각에는 지표 이력이 필요합니다.");
            }
        } else {
            PlannerSnapshot.MetricHistoryEntry latest = history.getLast();
            if (!latest.observedAt().equals(outcome.metricUpdatedAt())
                    || !sameDecimal(latest.value(), outcome.current())
                    || !latest.evidence().equals(outcome.evidenceLabel())) {
                throw PlannerException.validation("outcomes[].metricHistory", "현재 지표는 가장 최근 이력과 같아야 합니다.");
            }
        }
        return new PlannerSnapshot.Outcome(
                outcome.id(), outcome.title(), outcome.parentTitle(), outcome.current(), outcome.target(),
                outcome.unit(), outcome.confidence(), outcome.lastUpdatedDays(), outcome.metricUpdatedAt(),
                outcome.nextCheckDate(), history, outcome.actualHours(), outcome.neededHours(),
                outcome.availableHours(), outcome.evidenceLabel(), outcome.changeLabel(),
                outcome.attention(), outcome.decision());
    }

    private void requireInitialMetricHistory(PlannerSnapshot.Outcome outcome) {
        if (outcome.current() != null && outcome.metricHistoryOrEmpty().isEmpty()) {
            throw PlannerException.validation("outcomes[].metricHistory", "최초 지표값에는 값, 시각, 근거 이력이 필요합니다.");
        }
    }

    private boolean sameHistoryEntry(
            PlannerSnapshot.MetricHistoryEntry left,
            PlannerSnapshot.MetricHistoryEntry right
    ) {
        return left.id().equals(right.id())
                && sameDecimal(left.value(), right.value())
                && left.observedAt().equals(right.observedAt())
                && left.evidence().equals(right.evidence());
    }

    private boolean sameDecimal(java.math.BigDecimal left, java.math.BigDecimal right) {
        if (left == null || right == null) return left == right;
        return left.compareTo(right) == 0;
    }

    private void validateTimeBlocks(List<TimeBlock> blocks) {
        for (TimeBlock block : blocks) {
            long end = (long) block.startMinutes() + block.durationMinutes();
            if (end > 1_440) {
                throw PlannerException.validation("timeBlocks[].durationMinutes",
                        "시간 블록은 하루 24시를 넘을 수 없습니다: " + block.id());
            }
        }

        Map<SlotKey, List<TimeBlock>> grouped = blocks.stream()
                .collect(Collectors.groupingBy(SlotKey::from));
        grouped.values().forEach(group -> {
            ArrayList<TimeBlock> ordered = new ArrayList<>(group);
            ordered.sort(Comparator.comparingInt(TimeBlock::startMinutes));
            ArrayList<TimeBlock> active = new ArrayList<>();
            for (TimeBlock current : ordered) {
                active.removeIf(previous -> previous.startMinutes() + previous.durationMinutes() <= current.startMinutes());
                for (TimeBlock previous : active) {
                    if (!previous.externalOrFalse() && !current.externalOrFalse()) {
                        throw PlannerException.validation("timeBlocks",
                                "같은 날짜의 시간 블록이 겹칩니다: " + previous.id() + ", " + current.id());
                    }
                }
                active.add(current);
            }
        });
    }

    private void ensureUnique(String field, List<String> ids) {
        Set<String> seen = new HashSet<>();
        ids.forEach(id -> {
            if (!seen.add(id)) {
                throw PlannerException.validation(field, "중복 ID를 사용할 수 없습니다: " + id);
            }
        });
    }

    private void requireTask(Set<String> taskIds, String taskId, String field, boolean nullable) {
        if (taskId == null && nullable) {
            return;
        }
        if (taskId == null || !taskIds.contains(taskId)) {
            throw PlannerException.validation(field, "존재하지 않는 taskId를 참조합니다: " + taskId);
        }
    }

    /**
     * Absolute dates are authoritative. Undated records retain the legacy week/day bucket so
     * pre-V9 snapshots remain valid without pretending that their original calendar date is known.
     */
    private record SlotKey(
            java.time.LocalDate date,
            Integer legacyWeekOffset,
            PlannerSnapshot.DayKey legacyDay
    ) {
        private static SlotKey from(TimeBlock block) {
            if (block.date() != null) {
                return new SlotKey(block.date(), null, null);
            }
            return new SlotKey(null, block.weekOffsetOrZero(), block.day());
        }
    }
}
