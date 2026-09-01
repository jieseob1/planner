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

    public static PlannerException planNotFound() {
        return new PlannerException(HttpStatus.NOT_FOUND, "plan-not-found",
                "요청한 계획을 찾을 수 없습니다.", Map.of());
    }

    public static PlannerException planConflict() {
        return new PlannerException(HttpStatus.CONFLICT, "plan-id-conflict",
                "같은 계획 ID가 다른 내용으로 이미 사용되었습니다.", Map.of());
    }

    public static PlannerException invalidPlanState(String message) {
        return new PlannerException(HttpStatus.CONFLICT, "invalid-plan-state", message, Map.of());
    }

    public static PlannerException validation(String field, String message) {
        return new PlannerException(HttpStatus.BAD_REQUEST, "invalid-planner-snapshot", message,
                Map.of("errors", java.util.List.of(Map.of("field", field, "message", message))));
    }

    public static PlannerException reauthenticationRequired() {
        return new PlannerException(HttpStatus.UNAUTHORIZED, "reauthentication-required",
                "계정 삭제 전 15분 이내에 다시 로그인해 주세요.", Map.of());
    }

    public static PlannerException consentRequired() {
        return new PlannerException(HttpStatus.FORBIDDEN, "policy-consent-required",
                "서비스 이용 전 이용약관과 개인정보 처리방침 동의가 필요합니다.", Map.of());
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
