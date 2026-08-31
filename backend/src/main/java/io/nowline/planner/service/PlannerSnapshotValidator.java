package io.nowline.planner.service;

import io.nowline.planner.domain.PlannerSnapshot;
import io.nowline.planner.domain.PlannerSnapshot.TimeBlock;
import org.springframework.stereotype.Component;

import java.util.ArrayList;
import java.util.Comparator;
import java.util.HashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.stream.Collectors;

@Component
public class PlannerSnapshotValidator {

    public PlannerSnapshot validateAndCanonicalize(PlannerSnapshot snapshot) {
        ensureUnique("outcomes[].id", snapshot.outcomes().stream().map(PlannerSnapshot.Outcome::id).toList());
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
                        block.durationMinutes(), block.externalOrFalse(), block.weekOffsetOrZero()))
                .toList();
        validateTimeBlocks(canonicalBlocks);

        return new PlannerSnapshot(
                snapshot.version(),
                snapshot.plan(),
                snapshot.plannerWeekOffset(),
                List.copyOf(snapshot.tasks()),
                canonicalBlocks,
                List.copyOf(snapshot.timeEntries()),
                List.copyOf(snapshot.outcomes()),
                snapshot.timer(),
                new PlannerSnapshot.ReviewState(
                        snapshot.review().blocker(),
                        List.copyOf(snapshot.review().selectedTopTaskIds()),
                        snapshot.review().metricDraft(),
                        snapshot.review().completedAt())
        );
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
                .collect(Collectors.groupingBy(block -> new SlotKey(block.weekOffsetOrZero(), block.day())));
        grouped.values().forEach(group -> {
            ArrayList<TimeBlock> ordered = new ArrayList<>(group);
            ordered.sort(Comparator.comparingInt(TimeBlock::startMinutes));
            for (int index = 1; index < ordered.size(); index++) {
                TimeBlock previous = ordered.get(index - 1);
                TimeBlock current = ordered.get(index);
                if (previous.startMinutes() + previous.durationMinutes() > current.startMinutes()) {
                    throw PlannerException.validation("timeBlocks",
                            "같은 주와 요일의 시간 블록이 겹칩니다: " + previous.id() + ", " + current.id());
                }
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

    private record SlotKey(int weekOffset, PlannerSnapshot.DayKey day) {
    }
}
