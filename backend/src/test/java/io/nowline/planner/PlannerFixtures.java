package io.nowline.planner;

import io.nowline.planner.domain.PlannerSnapshot;

import java.math.BigDecimal;
import java.time.Instant;
import java.time.LocalDate;
import java.util.ArrayList;
import java.util.List;

public final class PlannerFixtures {

    private PlannerFixtures() {
    }

    public static PlannerSnapshot snapshot() {
        PlannerSnapshot.Outcome outcome = new PlannerSnapshot.Outcome(
                "outcome-writing",
                "기술 글 6개 발행",
                "백엔드 포트폴리오 완성",
                new BigDecimal("2"),
                new BigDecimal("6"),
                "편",
                PlannerSnapshot.Confidence.MEDIUM,
                3,
                new BigDecimal("18"),
                new BigDecimal("6"),
                new BigDecimal("12"),
                "3일 전 갱신",
                "지난 갱신 대비 변화 없음",
                PlannerSnapshot.Attention.STALLED,
                null
        );
        PlannerSnapshot.Task task = new PlannerSnapshot.Task(
                "task-draft",
                "기술 글 3편 초안",
                outcome.id(),
                40,
                PlannerSnapshot.TaskStatus.IN_PROGRESS,
                true,
                0,
                "완료 기준을 먼저 쓴다"
        );
        PlannerSnapshot.Task secondTask = new PlannerSnapshot.Task(
                "task-invoice",
                "세금계산서 발행",
                null,
                15,
                PlannerSnapshot.TaskStatus.TODO,
                false,
                1,
                null
        );
        return new PlannerSnapshot(
                1,
                new PlannerSnapshot.PlanContext(
                        2026,
                        "시장에 증명할 백엔드 역량과 수익 기반 만들기",
                        3,
                        "포트폴리오 공개 · 첫 유료 검증",
                        LocalDate.parse("2026-09-30")),
                0,
                List.of(task, secondTask),
                List.of(
                        new PlannerSnapshot.TimeBlock(
                                "block-draft", task.id(), "글 초안", PlannerSnapshot.DayKey.TUE,
                                1_170, 90, null, null),
                        new PlannerSnapshot.TimeBlock(
                                "block-standup", null, "팀 스탠드업", PlannerSnapshot.DayKey.MON,
                                600, 60, true, 0)),
                List.of(new PlannerSnapshot.TimeEntry(
                        "entry-1", task.id(), 1_200, PlannerSnapshot.TimeSource.TIMER,
                        Instant.parse("2026-08-31T05:00:00Z"), "초안 링크")),
                List.of(outcome),
                new PlannerSnapshot.TimerSession(task.id(), null, 300, true),
                new PlannerSnapshot.ReviewState(
                        null, List.of(task.id(), secondTask.id()), "2", null)
        );
    }

    public static PlannerSnapshot withDirection(PlannerSnapshot source, String direction) {
        return new PlannerSnapshot(
                source.version(),
                new PlannerSnapshot.PlanContext(
                        source.plan().year(), direction, source.plan().quarter(),
                        source.plan().quarterFocus(), source.plan().quarterEndDate()),
                source.plannerWeekOffset(), source.tasks(), source.timeBlocks(), source.timeEntries(),
                source.outcomes(), source.timer(), source.review());
    }

    public static PlannerSnapshot withOverlappingBlock(PlannerSnapshot source) {
        ArrayList<PlannerSnapshot.TimeBlock> blocks = new ArrayList<>(source.timeBlocks());
        blocks.add(new PlannerSnapshot.TimeBlock(
                "block-overlap", null, "겹치는 일정", PlannerSnapshot.DayKey.TUE,
                1_200, 30, false, 0));
        return new PlannerSnapshot(
                source.version(), source.plan(), source.plannerWeekOffset(), source.tasks(), blocks,
                source.timeEntries(), source.outcomes(), source.timer(), source.review());
    }

    public static PlannerSnapshot withInvalidTarget(PlannerSnapshot source) {
        PlannerSnapshot.Outcome original = source.outcomes().getFirst();
        PlannerSnapshot.Outcome invalid = new PlannerSnapshot.Outcome(
                original.id(), original.title(), original.parentTitle(), original.current(), BigDecimal.ZERO,
                original.unit(), original.confidence(), original.lastUpdatedDays(), original.actualHours(),
                original.neededHours(), original.availableHours(), original.evidenceLabel(), original.changeLabel(),
                original.attention(), original.decision());
        return new PlannerSnapshot(
                source.version(), source.plan(), source.plannerWeekOffset(), source.tasks(), source.timeBlocks(),
                source.timeEntries(), List.of(invalid), source.timer(), source.review());
    }
}
