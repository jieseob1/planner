package io.nowline.planner.service;

public record PlannerPrecondition(Mode mode, Long expectedRevision, String canonicalValue) {

    public enum Mode {
        CREATE,
        UPDATE
    }

    public static PlannerPrecondition create() {
        return new PlannerPrecondition(Mode.CREATE, null, "If-None-Match:*");
    }

    public static PlannerPrecondition update(long revision) {
        return new PlannerPrecondition(Mode.UPDATE, revision, "If-Match:" + revision);
    }
}
