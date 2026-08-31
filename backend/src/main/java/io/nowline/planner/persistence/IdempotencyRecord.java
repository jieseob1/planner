package io.nowline.planner.persistence;

public record IdempotencyRecord(
        String requestHash,
        int responseStatus,
        Long resultRevision,
        String responseBody
) {
}
