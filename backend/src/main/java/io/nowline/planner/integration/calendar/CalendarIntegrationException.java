package io.nowline.planner.integration.calendar;

import org.springframework.http.HttpStatus;

public final class CalendarIntegrationException extends RuntimeException {

    private final HttpStatus status;
    private final String code;

    private CalendarIntegrationException(HttpStatus status, String code, String message, Throwable cause) {
        super(message, cause);
        this.status = status;
        this.code = code;
    }

    public static CalendarIntegrationException notConfigured() {
        return new CalendarIntegrationException(HttpStatus.SERVICE_UNAVAILABLE, "google-calendar-not-configured",
                "Google Calendar 운영 자격증명이 아직 설정되지 않았습니다.", null);
    }

    public static CalendarIntegrationException invalidState() {
        return new CalendarIntegrationException(HttpStatus.BAD_REQUEST, "invalid-google-oauth-state",
                "Google Calendar 연결 요청이 만료되었거나 이미 사용되었습니다.", null);
    }

    public static CalendarIntegrationException authorizationFailed(String message, Throwable cause) {
        return new CalendarIntegrationException(HttpStatus.BAD_GATEWAY, "google-calendar-authorization-failed", message, cause);
    }

    public static CalendarIntegrationException notConnected() {
        return new CalendarIntegrationException(HttpStatus.CONFLICT, "google-calendar-not-connected",
                "먼저 Google Calendar를 연결해 주세요.", null);
    }

    public static CalendarIntegrationException reauthorize() {
        return new CalendarIntegrationException(HttpStatus.CONFLICT, "google-calendar-reauthorization-required",
                "Google Calendar 권한이 만료되었습니다. 다시 연결해 주세요.", null);
    }

    public static CalendarIntegrationException invalidSettings(String message) {
        return new CalendarIntegrationException(HttpStatus.BAD_REQUEST, "invalid-google-calendar-settings", message, null);
    }

    public static CalendarIntegrationException syncConflict() {
        return new CalendarIntegrationException(HttpStatus.CONFLICT, "google-calendar-etag-conflict",
                "Google Calendar에서 일정이 먼저 변경되었습니다. 최신 상태를 다시 동기화합니다.", null);
    }

    public static CalendarIntegrationException upstream(String message, Throwable cause) {
        return new CalendarIntegrationException(HttpStatus.BAD_GATEWAY, "google-calendar-upstream-failure", message, cause);
    }

    public HttpStatus status() {
        return status;
    }

    public String code() {
        return code;
    }
}
