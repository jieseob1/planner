package io.nowline.planner.domain;

import com.fasterxml.jackson.annotation.JsonCreator;
import com.fasterxml.jackson.annotation.JsonInclude;
import com.fasterxml.jackson.annotation.JsonValue;
import jakarta.validation.Valid;
import jakarta.validation.constraints.DecimalMax;
import jakarta.validation.constraints.DecimalMin;
import jakarta.validation.constraints.Digits;
import jakarta.validation.constraints.Max;
import jakarta.validation.constraints.Min;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Positive;
import jakarta.validation.constraints.Size;

import java.math.BigDecimal;
import java.time.Instant;
import java.time.LocalDate;
import java.util.List;

public record PlannerSnapshot(
        @Min(1) @Max(1) int version,
        @NotNull @Valid PlanContext plan,
        @Min(-520) @Max(520) int plannerWeekOffset,
        @NotNull @Size(max = 5_000) List<@Valid @NotNull Task> tasks,
        @NotNull @Size(max = 10_000) List<@Valid @NotNull TimeBlock> timeBlocks,
        @NotNull @Size(max = 50_000) List<@Valid @NotNull TimeEntry> timeEntries,
        @NotNull @Size(max = 1_000) List<@Valid @NotNull Outcome> outcomes,
        @Valid TimerSession timer,
        @NotNull @Valid ReviewState review
) {

    public record PlanContext(
            @Min(1900) @Max(9999) int year,
            @NotBlank @Size(max = 2_000) String annualDirection,
            @Min(1) @Max(4) int quarter,
            @NotBlank @Size(max = 2_000) String quarterFocus,
            @NotNull LocalDate quarterEndDate
    ) {
    }

    public record Task(
            @NotBlank @Size(max = 160) String id,
            @NotBlank @Size(max = 500) String title,
            @Size(max = 160) String outcomeId,
            @Positive @Max(10_080) int estimateMinutes,
            @NotNull TaskStatus status,
            boolean pinned,
            @Min(0) @Max(10_000) int carryCount,
            @JsonInclude(JsonInclude.Include.NON_NULL) @Size(max = 4_000) String note
    ) {
    }

    public record TimeBlock(
            @NotBlank @Size(max = 160) String id,
            @Size(max = 160) String taskId,
            @NotBlank @Size(max = 500) String title,
            @NotNull DayKey day,
            @Min(0) @Max(1_439) int startMinutes,
            @Positive @Max(1_440) int durationMinutes,
            Boolean external,
            @Min(-520) @Max(520) Integer weekOffset,
            @JsonInclude(JsonInclude.Include.NON_NULL) LocalDate date
    ) {
        /** Legacy constructor for snapshots persisted before absolute block dates were introduced. */
        public TimeBlock(
                String id,
                String taskId,
                String title,
                DayKey day,
                int startMinutes,
                int durationMinutes,
                Boolean external,
                Integer weekOffset
        ) {
            this(id, taskId, title, day, startMinutes, durationMinutes, external, weekOffset, null);
        }

        public boolean externalOrFalse() {
            return Boolean.TRUE.equals(external);
        }

        public int weekOffsetOrZero() {
            return weekOffset == null ? 0 : weekOffset;
        }
    }

    public record TimeEntry(
            @NotBlank @Size(max = 160) String id,
            @NotBlank @Size(max = 160) String taskId,
            @Positive long durationSeconds,
            @NotNull TimeSource source,
            @NotNull Instant observedAt,
            @JsonInclude(JsonInclude.Include.NON_NULL) @Size(max = 4_000) String evidence
    ) {
    }

    public record Outcome(
            @NotBlank @Size(max = 160) String id,
            @NotBlank @Size(max = 500) String title,
            @NotBlank @Size(max = 500) String parentTitle,
            @DecimalMin("0") @DecimalMax("1000000000") @Digits(integer = 14, fraction = 6) BigDecimal current,
            @NotNull @DecimalMin(value = "0", inclusive = false) @DecimalMax("1000000000")
            @Digits(integer = 14, fraction = 6) BigDecimal target,
            @NotBlank @Size(max = 40) String unit,
            @NotNull Confidence confidence,
            @Min(0) @Max(100_000) Integer lastUpdatedDays,
            @JsonInclude(JsonInclude.Include.NON_NULL) Instant metricUpdatedAt,
            @JsonInclude(JsonInclude.Include.NON_NULL) LocalDate nextCheckDate,
            @Size(max = 10_000) List<@Valid @NotNull MetricHistoryEntry> metricHistory,
            @NotNull @DecimalMin("0") @DecimalMax("1000000") @Digits(integer = 14, fraction = 6) BigDecimal actualHours,
            @NotNull @DecimalMin("0") @DecimalMax("1000000") @Digits(integer = 14, fraction = 6) BigDecimal neededHours,
            @NotNull @DecimalMin("0") @DecimalMax("1000000") @Digits(integer = 14, fraction = 6) BigDecimal availableHours,
            @NotBlank @Size(max = 500) String evidenceLabel,
            @NotBlank @Size(max = 500) String changeLabel,
            @NotNull Attention attention,
            @JsonInclude(JsonInclude.Include.NON_NULL) Decision decision
    ) {
        /** Source-compatible constructor for snapshots created before metric history was introduced. */
        public Outcome(
                String id,
                String title,
                String parentTitle,
                BigDecimal current,
                BigDecimal target,
                String unit,
                Confidence confidence,
                Integer lastUpdatedDays,
                BigDecimal actualHours,
                BigDecimal neededHours,
                BigDecimal availableHours,
                String evidenceLabel,
                String changeLabel,
                Attention attention,
                Decision decision
        ) {
            this(id, title, parentTitle, current, target, unit, confidence, lastUpdatedDays,
                    null, null, List.of(), actualHours, neededHours, availableHours,
                    evidenceLabel, changeLabel, attention, decision);
        }

        public List<MetricHistoryEntry> metricHistoryOrEmpty() {
            return metricHistory == null ? List.of() : metricHistory;
        }
    }

    public record MetricHistoryEntry(
            @NotBlank @Size(max = 160) String id,
            @DecimalMin("0") @DecimalMax("1000000000") @Digits(integer = 14, fraction = 6) BigDecimal value,
            @NotNull Instant observedAt,
            @NotBlank @Size(max = 500) String evidence
    ) {
    }

    public record TimerSession(
            @NotBlank @Size(max = 160) String taskId,
            @Min(0) Long startedAt,
            @Min(0) long accumulatedSeconds,
            boolean paused
    ) {
    }

    public record ReviewState(
            @Size(max = 2_000) String blocker,
            @NotNull @Size(max = 3) List<@NotBlank @Size(max = 160) String> selectedTopTaskIds,
            @NotNull @Size(max = 200) String metricDraft,
            Instant completedAt
    ) {
    }

    public enum TaskStatus implements WireValue {
        TODO("todo"), IN_PROGRESS("in-progress"), DONE("done"), CANCELLED("cancelled");

        private final String value;

        TaskStatus(String value) {
            this.value = value;
        }

        @Override
        @JsonValue
        public String value() {
            return value;
        }

        @JsonCreator
        public static TaskStatus from(String value) {
            return WireValue.parse(TaskStatus.class, value);
        }
    }

    public enum DayKey implements WireValue {
        MON("mon"), TUE("tue"), WED("wed"), THU("thu"), FRI("fri"), SAT("sat"), SUN("sun");

        private final String value;

        DayKey(String value) {
            this.value = value;
        }

        @Override
        @JsonValue
        public String value() {
            return value;
        }

        @JsonCreator
        public static DayKey from(String value) {
            return WireValue.parse(DayKey.class, value);
        }
    }

    public enum TimeSource implements WireValue {
        TIMER("timer"), MANUAL("manual");

        private final String value;

        TimeSource(String value) {
            this.value = value;
        }

        @Override
        @JsonValue
        public String value() {
            return value;
        }

        @JsonCreator
        public static TimeSource from(String value) {
            return WireValue.parse(TimeSource.class, value);
        }
    }

    public enum Confidence implements WireValue {
        HIGH("high"), MEDIUM("medium"), LOW("low"), UNKNOWN("unknown");

        private final String value;

        Confidence(String value) {
            this.value = value;
        }

        @Override
        @JsonValue
        public String value() {
            return value;
        }

        @JsonCreator
        public static Confidence from(String value) {
            return WireValue.parse(Confidence.class, value);
        }
    }

    public enum Attention implements WireValue {
        NONE("none"), STALE("stale"), TIME_SHORTAGE("time-shortage"), STALLED("stalled"), NO_EVIDENCE("no-evidence");

        private final String value;

        Attention(String value) {
            this.value = value;
        }

        @Override
        @JsonValue
        public String value() {
            return value;
        }

        @JsonCreator
        public static Attention from(String value) {
            return WireValue.parse(Attention.class, value);
        }
    }

    public enum Decision implements WireValue {
        KEEP("keep"), REDUCE("reduce"), EXTEND("extend"), STOP("stop");

        private final String value;

        Decision(String value) {
            this.value = value;
        }

        @Override
        @JsonValue
        public String value() {
            return value;
        }

        @JsonCreator
        public static Decision from(String value) {
            return WireValue.parse(Decision.class, value);
        }
    }

    private interface WireValue {
        String value();

        static <E extends Enum<E> & WireValue> E parse(Class<E> type, String value) {
            if (value != null) {
                for (E candidate : type.getEnumConstants()) {
                    if (candidate.value().equals(value)) {
                        return candidate;
                    }
                }
            }
            throw new IllegalArgumentException("Unsupported " + type.getSimpleName() + " value: " + value);
        }
    }
}
