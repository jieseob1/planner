package io.nowline.planner.service;

import io.nowline.planner.PlannerFixtures;
import io.nowline.planner.domain.PlannerSnapshot;
import org.junit.jupiter.api.Test;

import java.time.Duration;
import java.time.LocalDate;
import java.time.Instant;
import java.math.BigDecimal;
import java.util.ArrayList;
import java.util.List;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

class PlannerSnapshotValidatorTest {

    private final PlannerSnapshotValidator validator = new PlannerSnapshotValidator();

    @Test
    void canonicalizesOptionalBlockFields() {
        PlannerSnapshot result = validator.validateAndCanonicalize(PlannerFixtures.snapshot());

        assertThat(result.timeBlocks().getFirst().external()).isFalse();
        assertThat(result.timeBlocks().getFirst().weekOffset()).isZero();
        assertThat(result.timeBlocks().getFirst().date()).isEqualTo(LocalDate.parse("2026-09-01"));
    }

    @Test
    void rejectsOverlappingBlocksInSameWeekAndDay() {
        assertThatThrownBy(() -> validator.validateAndCanonicalize(
                PlannerFixtures.withOverlappingBlock(PlannerFixtures.snapshot())))
                .isInstanceOf(PlannerException.class)
                .hasMessageContaining("겹칩니다");
    }

    @Test
    void allowsSameTimeOnDifferentAbsoluteDate() {
        PlannerSnapshot source = PlannerFixtures.snapshot();
        ArrayList<PlannerSnapshot.TimeBlock> blocks = new ArrayList<>(source.timeBlocks());
        blocks.add(new PlannerSnapshot.TimeBlock(
                "block-next-week", null, "다음 주 글 초안", PlannerSnapshot.DayKey.TUE,
                1_170, 90, false, 1, LocalDate.parse("2026-09-08")));
        PlannerSnapshot candidate = new PlannerSnapshot(
                source.version(), source.plan(), source.plannerWeekOffset(), source.tasks(), blocks,
                source.timeEntries(), source.outcomes(), source.timer(), source.review());

        PlannerSnapshot result = validator.validateAndCanonicalize(candidate);
        assertThat(result.timeBlocks()).hasSize(3);
        assertThat(result.timeBlocks().getLast().date()).isEqualTo(LocalDate.parse("2026-09-08"));
    }

    @Test
    void rejectsSameDateOverlapEvenWhenRelativeWeekMetadataDiffers() {
        PlannerSnapshot source = PlannerFixtures.snapshot();
        ArrayList<PlannerSnapshot.TimeBlock> blocks = new ArrayList<>(source.timeBlocks());
        blocks.add(new PlannerSnapshot.TimeBlock(
                "block-same-date", null, "같은 날짜 겹침", PlannerSnapshot.DayKey.TUE,
                1_200, 30, false, 1, LocalDate.parse("2026-09-01")));
        PlannerSnapshot candidate = new PlannerSnapshot(
                source.version(), source.plan(), source.plannerWeekOffset(), source.tasks(), blocks,
                source.timeEntries(), source.outcomes(), source.timer(), source.review());

        assertThatThrownBy(() -> validator.validateAndCanonicalize(candidate))
                .isInstanceOf(PlannerException.class)
                .hasMessageContaining("겹칩니다");
    }

    @Test
    void rejectsDanglingTaskReference() {
        PlannerSnapshot source = PlannerFixtures.snapshot();
        PlannerSnapshot candidate = new PlannerSnapshot(
                source.version(), source.plan(), source.plannerWeekOffset(), source.tasks(),
                java.util.List.of(new PlannerSnapshot.TimeBlock(
                        "block-missing", "missing-task", "잘못된 블록", PlannerSnapshot.DayKey.MON,
                        60, 30, false, 0, LocalDate.parse("2026-08-31"))),
                source.timeEntries(), source.outcomes(), source.timer(), source.review());

        assertThatThrownBy(() -> validator.validateAndCanonicalize(candidate))
                .isInstanceOf(PlannerException.class)
                .hasMessageContaining("존재하지 않는 taskId");
    }

    @Test
    void preservesExistingMetricHistoryAsAnImmutablePrefix() {
        PlannerSnapshot previous = validator.validateAndCanonicalize(PlannerFixtures.snapshot());
        PlannerSnapshot.Outcome before = previous.outcomes().getFirst();
        Instant observedAt = Instant.now().minusSeconds(1);
        PlannerSnapshot.MetricHistoryEntry appended = new PlannerSnapshot.MetricHistoryEntry(
                "metric-writing-3", new BigDecimal("3"), observedAt, "게시 URL 3건 확인");
        PlannerSnapshot.Outcome updated = copyOutcome(
                before,
                new BigDecimal("3"),
                appended.observedAt(),
                List.of(before.metricHistoryOrEmpty().getFirst(), appended),
                appended.evidence());
        PlannerSnapshot next = withOutcomes(previous, List.of(updated));

        validator.ensureMetricHistoryAppendOnly(previous, validator.validateAndCanonicalize(next));

        PlannerSnapshot.MetricHistoryEntry tamperedEntry = new PlannerSnapshot.MetricHistoryEntry(
                before.metricHistoryOrEmpty().getFirst().id(),
                before.current(),
                before.metricUpdatedAt(),
                "과거 근거 위조");
        PlannerSnapshot.Outcome tampered = copyOutcome(
                before,
                before.current(),
                before.metricUpdatedAt(),
                List.of(tamperedEntry),
                tamperedEntry.evidence());

        assertThatThrownBy(() -> validator.ensureMetricHistoryAppendOnly(
                previous,
                validator.validateAndCanonicalize(withOutcomes(previous, List.of(tampered)))))
                .isInstanceOf(PlannerException.class)
                .hasMessageContaining("수정하거나 재정렬");
    }

    @Test
    void acceptsAnOfflineObservationWhenItStillFollowsThePreservedPrefix() {
        PlannerSnapshot previous = validator.validateAndCanonicalize(PlannerFixtures.snapshot());
        PlannerSnapshot.Outcome before = previous.outcomes().getFirst();
        PlannerSnapshot.MetricHistoryEntry offline = new PlannerSnapshot.MetricHistoryEntry(
                "metric-writing-offline",
                new BigDecimal("3"),
                Instant.now().minus(Duration.ofHours(24)),
                "오프라인에서 확인한 게시 URL 3건");
        ArrayList<PlannerSnapshot.MetricHistoryEntry> history = new ArrayList<>(before.metricHistoryOrEmpty());
        history.add(offline);
        PlannerSnapshot.Outcome updated = copyOutcome(
                before, offline.value(), offline.observedAt(), history, offline.evidence());
        PlannerSnapshot next = validator.validateAndCanonicalize(withOutcomes(previous, List.of(updated)));

        validator.ensureMetricHistoryAppendOnly(previous, next);
        assertThat(next.outcomes().getFirst().metricHistoryOrEmpty().getLast()).isEqualTo(offline);
    }

    @Test
    void rejectsMetricChangesWithoutAHistoryAppend() {
        PlannerSnapshot previous = validator.validateAndCanonicalize(PlannerFixtures.snapshot());
        PlannerSnapshot.Outcome before = previous.outcomes().getFirst();
        PlannerSnapshot.Outcome changedWithoutHistory = copyOutcome(
                before,
                new BigDecimal("4"),
                before.metricUpdatedAt(),
                before.metricHistoryOrEmpty(),
                before.evidenceLabel());

        assertThatThrownBy(() -> validator.ensureMetricHistoryAppendOnly(
                previous,
                withOutcomes(previous, List.of(changedWithoutHistory))))
                .isInstanceOf(PlannerException.class)
                .hasMessageContaining("지표 변경에는");
    }

    @Test
    void allowsAnUnrelatedUpdateForLegacyMetricsAndStartsHistoryAtTheFirstRealChange() {
        PlannerSnapshot source = PlannerFixtures.snapshot();
        PlannerSnapshot.Outcome before = source.outcomes().getFirst();
        PlannerSnapshot.Outcome legacy = copyOutcome(
                before, before.current(), null, List.of(), before.evidenceLabel());
        PlannerSnapshot previous = validator.validateAndCanonicalize(withOutcomes(source, List.of(legacy)));
        PlannerSnapshot unrelated = validator.validateAndCanonicalize(
                PlannerFixtures.withDirection(previous, "이력과 무관한 연간 방향 수정"));

        validator.ensureMetricHistoryAppendOnly(previous, unrelated);
        assertThat(unrelated.outcomes().getFirst().metricHistoryOrEmpty()).isEmpty();
        assertThat(unrelated.outcomes().getFirst().metricUpdatedAt()).isNull();

        Instant observedAt = Instant.now().minusSeconds(1);
        PlannerSnapshot.MetricHistoryEntry firstObservation = new PlannerSnapshot.MetricHistoryEntry(
                "metric-writing-first-real", new BigDecimal("3"), observedAt, "게시 URL 3건 확인");
        PlannerSnapshot.Outcome measured = copyOutcome(
                legacy,
                firstObservation.value(),
                firstObservation.observedAt(),
                List.of(firstObservation),
                firstObservation.evidence());
        PlannerSnapshot firstMetricUpdate = validator.validateAndCanonicalize(
                withOutcomes(unrelated, List.of(measured)));

        validator.ensureMetricHistoryAppendOnly(unrelated, firstMetricUpdate);
        assertThat(firstMetricUpdate.outcomes().getFirst().metricHistoryOrEmpty())
                .containsExactly(firstObservation);
    }

    @Test
    void rejectsInitialValuesWithoutAnObservationAndExcessiveFutureClockSkew() {
        PlannerSnapshot source = PlannerFixtures.snapshot();
        PlannerSnapshot.Outcome before = source.outcomes().getFirst();
        PlannerSnapshot.Outcome missingInitialHistory = copyOutcome(
                before, before.current(), null, List.of(), before.evidenceLabel());

        assertThatThrownBy(() -> validator.ensureInitialMetricHistory(
                withOutcomes(source, List.of(missingInitialHistory))))
                .isInstanceOf(PlannerException.class)
                .hasMessageContaining("최초 지표값");

        Instant tooFarInFuture = Instant.now().plusSeconds(360);
        PlannerSnapshot.MetricHistoryEntry future = new PlannerSnapshot.MetricHistoryEntry(
                "future-observation", new BigDecimal("3"), tooFarInFuture, "미래 근거");
        PlannerSnapshot.Outcome futureOutcome = copyOutcome(
                before, future.value(), future.observedAt(), List.of(future), future.evidence());

        assertThatThrownBy(() -> validator.validateAndCanonicalize(
                withOutcomes(source, List.of(futureOutcome))))
                .isInstanceOf(PlannerException.class)
                .hasMessageContaining("너무 미래");
    }

    private PlannerSnapshot withOutcomes(PlannerSnapshot source, List<PlannerSnapshot.Outcome> outcomes) {
        return new PlannerSnapshot(
                source.version(), source.plan(), source.plannerWeekOffset(), source.tasks(), source.timeBlocks(),
                source.timeEntries(), outcomes, source.timer(), source.review());
    }

    private PlannerSnapshot.Outcome copyOutcome(
            PlannerSnapshot.Outcome source,
            BigDecimal current,
            Instant metricUpdatedAt,
            List<PlannerSnapshot.MetricHistoryEntry> history,
            String evidence
    ) {
        return new PlannerSnapshot.Outcome(
                source.id(), source.title(), source.parentTitle(), current, source.target(), source.unit(),
                source.confidence(), source.lastUpdatedDays(), metricUpdatedAt, source.nextCheckDate(), history,
                source.actualHours(), source.neededHours(), source.availableHours(), evidence,
                source.changeLabel(), source.attention(), source.decision());
    }
}
