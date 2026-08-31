package io.nowline.planner.service;

import org.springframework.http.HttpStatus;

import java.util.LinkedHashMap;
import java.util.Map;

public final class PlannerException extends RuntimeException {

    private final HttpStatus status;
    private final String code;
    private final Map<String, Object> properties;

    private PlannerException(HttpStatus status, String code, String message, Map<String, Object> properties) {
        super(message);
        this.status = status;
        this.code = code;
        this.properties = Map.copyOf(properties);
    }

    public static PlannerException notFound() {
        return new PlannerException(HttpStatus.NOT_FOUND, "planner-not-found",
                "저장된 플래너가 없습니다.", Map.of());
    }

    public static PlannerException preconditionRequired() {
        return new PlannerException(HttpStatus.PRECONDITION_REQUIRED, "precondition-required",
                "생성에는 If-None-Match: *, 수정에는 현재 ETag의 If-Match가 필요합니다.", Map.of());
    }

    public static PlannerException invalidPrecondition(String message) {
        return new PlannerException(HttpStatus.BAD_REQUEST, "invalid-precondition", message, Map.of());
    }

    public static PlannerException preconditionFailed(Long currentRevision) {
        Map<String, Object> values = new LinkedHashMap<>();
        if (currentRevision != null) {
            values.put("currentRevision", currentRevision);
        }
        return new PlannerException(HttpStatus.PRECONDITION_FAILED, "revision-conflict",
                "다른 기기에서 플래너가 먼저 변경되었습니다. 최신 내용을 다시 불러와 주세요.", values);
    }

    public static PlannerException idempotencyConflict() {
        return new PlannerException(HttpStatus.CONFLICT, "idempotency-key-reused",
                "같은 Idempotency-Key가 다른 요청에 이미 사용되었습니다.", Map.of());
    }

    public static PlannerException validation(String field, String message) {
        return new PlannerException(HttpStatus.BAD_REQUEST, "invalid-planner-snapshot", message,
                Map.of("errors", java.util.List.of(Map.of("field", field, "message", message))));
    }

    public HttpStatus status() {
        return status;
    }

    public String code() {
        return code;
    }

    public Map<String, Object> properties() {
        return properties;
    }
}
