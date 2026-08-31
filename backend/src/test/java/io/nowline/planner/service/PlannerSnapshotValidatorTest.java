package io.nowline.planner.service;

import io.nowline.planner.PlannerFixtures;
import io.nowline.planner.domain.PlannerSnapshot;
import org.junit.jupiter.api.Test;

import java.util.ArrayList;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

class PlannerSnapshotValidatorTest {

    private final PlannerSnapshotValidator validator = new PlannerSnapshotValidator();

    @Test
    void canonicalizesOptionalBlockFields() {
        PlannerSnapshot result = validator.validateAndCanonicalize(PlannerFixtures.snapshot());

        assertThat(result.timeBlocks().getFirst().external()).isFalse();
        assertThat(result.timeBlocks().getFirst().weekOffset()).isZero();
    }

    @Test
    void rejectsOverlappingBlocksInSameWeekAndDay() {
        assertThatThrownBy(() -> validator.validateAndCanonicalize(
                PlannerFixtures.withOverlappingBlock(PlannerFixtures.snapshot())))
                .isInstanceOf(PlannerException.class)
                .hasMessageContaining("겹칩니다");
    }

    @Test
    void allowsSameTimeOnDifferentWeek() {
        PlannerSnapshot source = PlannerFixtures.snapshot();
        ArrayList<PlannerSnapshot.TimeBlock> blocks = new ArrayList<>(source.timeBlocks());
        blocks.add(new PlannerSnapshot.TimeBlock(
                "block-next-week", null, "다음 주 글 초안", PlannerSnapshot.DayKey.TUE,
                1_170, 90, false, 1));
        PlannerSnapshot candidate = new PlannerSnapshot(
                source.version(), source.plan(), source.plannerWeekOffset(), source.tasks(), blocks,
                source.timeEntries(), source.outcomes(), source.timer(), source.review());

        assertThat(validator.validateAndCanonicalize(candidate).timeBlocks()).hasSize(3);
    }

    @Test
    void rejectsDanglingTaskReference() {
        PlannerSnapshot source = PlannerFixtures.snapshot();
        PlannerSnapshot candidate = new PlannerSnapshot(
                source.version(), source.plan(), source.plannerWeekOffset(), source.tasks(),
                java.util.List.of(new PlannerSnapshot.TimeBlock(
                        "block-missing", "missing-task", "잘못된 블록", PlannerSnapshot.DayKey.MON,
                        60, 30, false, 0)),
                source.timeEntries(), source.outcomes(), source.timer(), source.review());

        assertThatThrownBy(() -> validator.validateAndCanonicalize(candidate))
                .isInstanceOf(PlannerException.class)
                .hasMessageContaining("존재하지 않는 taskId");
    }
}
