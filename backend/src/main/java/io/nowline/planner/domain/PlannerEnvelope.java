package io.nowline.planner.domain;

public record PlannerEnvelope(long revision, PlannerSnapshot snapshot) {
}
