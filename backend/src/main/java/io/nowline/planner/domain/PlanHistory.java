package io.nowline.planner.domain;

import java.time.Instant;
import java.util.List;
import java.util.Map;
import java.util.UUID;

public final class PlanHistory {

    private PlanHistory() {
    }

    public enum Status {
        DRAFT,
        ACTIVE,
        CLOSED,
        ARCHIVED
    }

    public record Summary(
            UUID id,
            String title,
            int year,
            int quarter,
            Status status,
            Long sourceRevision,
            Instant createdAt,
            Instant updatedAt,
            Instant activatedAt,
            Instant closedAt,
            Instant archivedAt
    ) {
    }

    public record Detail(Summary plan, PlannerSnapshot snapshot) {
    }

    public record AuditEvent(
            UUID id,
            UUID planId,
            String action,
            Long revision,
            Map<String, Object> details,
            Instant occurredAt
    ) {
    }

    public record ListResponse(List<Summary> plans) {
    }
}
