package io.nowline.planner.domain;

import jakarta.validation.Valid;
import jakarta.validation.constraints.*;
import java.math.BigDecimal;
import java.time.Instant;
import java.time.LocalDate;
import java.util.List;

/** One independently versioned goal or review, never an active-plan replacement. */
public record PeriodDocument(long revision, Goal goal, Review review, boolean deleted, Instant updatedAt, List<Goal> goalCheckpoints) {
    public String id() { return goal != null ? goal.id() : review.id(); }
    public record Write(
            @Min(0) long expectedRevision,
            @NotBlank @Size(max = 128) String mutationId,
            @Valid Goal goal, @Valid Review review, boolean deleted) {}

    public enum Period { day, week, month, quarter, year }
    public enum Measurement { completion, number }
    public record Goal(
            @NotBlank @Pattern(regexp = "goal-[a-zA-Z0-9-]{1,70}") String id,
            @NotBlank @Size(max = 500) String title,
            @NotNull Period period, @NotNull LocalDate startDate, @NotNull LocalDate endDate,
            @Size(max = 80) String parentId,
            @NotNull Measurement measurement,
            @NotNull @DecimalMin("-1000000000") @DecimalMax("1000000000") BigDecimal baseline,
            @DecimalMin("-1000000000") @DecimalMax("1000000000") BigDecimal current,
            @NotNull @DecimalMin("-1000000000") @DecimalMax("1000000000") BigDecimal target,
            @NotNull @Size(max = 40) String unit, boolean done,
            @NotNull @Size(max = 4000) String note,
            @NotNull @Size(max = 200) List<@NotBlank @Size(max = 160) String> taskIds) {}

    public record Review(
            @NotBlank @Size(max = 80) String id,
            @NotNull Period period, @NotNull LocalDate startDate, @NotNull LocalDate endDate,
            @NotNull @Size(max = 4000) String well,
            @NotNull @Size(max = 4000) String blocked,
            @NotNull @Size(max = 4000) String change,
            @NotNull @Size(max = 4000) String note,
            boolean completed) {}
}
