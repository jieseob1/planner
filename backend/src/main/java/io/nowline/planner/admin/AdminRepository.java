package io.nowline.planner.admin;

import org.springframework.http.HttpStatus;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Repository;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.server.ResponseStatusException;

import java.sql.ResultSet;
import java.sql.SQLException;
import java.time.Instant;
import java.util.List;

@Repository
@Transactional(readOnly = true)
public class AdminRepository {
    public static final int MAX_PAGE = 200;
    public static final int MAX_SIZE = 50;
    private final JdbcTemplate jdbc;

    public AdminRepository(JdbcTemplate jdbc) { this.jdbc = jdbc; }

    public Overview overview() {
        return jdbc.queryForObject("""
                SELECT
                  (SELECT COUNT(*) FROM app_user WHERE deleted_at IS NULL) AS accounts,
                  (SELECT COUNT(*) FROM app_user WHERE deleted_at IS NULL
                    AND last_seen_at >= DATE_SUB(UTC_TIMESTAMP(), INTERVAL 7 DAY)) AS recent_accounts,
                  (SELECT COUNT(*) FROM planner_plan p JOIN app_user u ON u.user_id=p.user_id
                    WHERE u.deleted_at IS NULL AND p.status='ACTIVE') AS active_plans,
                  (SELECT COUNT(*) FROM google_calendar_connection c JOIN app_user u ON u.user_id=c.user_id
                    WHERE u.deleted_at IS NULL) AS connections,
                  (SELECT COUNT(*) FROM google_calendar_connection c JOIN app_user u ON u.user_id=c.user_id
                    WHERE u.deleted_at IS NULL AND c.sync_status IN ('ERROR','REAUTHORIZE')) AS sync_failures,
                  (SELECT COUNT(*) FROM integration_job WHERE status='PENDING') AS queued_jobs,
                  (SELECT COUNT(*) FROM integration_job WHERE status='RUNNING') AS running_jobs,
                  (SELECT COUNT(*) FROM integration_job WHERE status='DEAD') AS dead_jobs,
                  (SELECT COUNT(*) FROM integration_job WHERE status='PENDING' AND attempts>0) AS retrying_jobs,
                  (SELECT COUNT(*) FROM notification_delivery WHERE status='FAILED') AS failed_notifications,
                  (SELECT COUNT(*) FROM planner_audit_event
                    WHERE occurred_at >= DATE_SUB(UTC_TIMESTAMP(), INTERVAL 1 DAY)) AS recent_audit_events
                """, (rs, row) -> new Overview(Instant.now(), rs.getLong("accounts"),
                rs.getLong("recent_accounts"), rs.getLong("active_plans"), rs.getLong("connections"),
                rs.getLong("sync_failures"), rs.getLong("queued_jobs"), rs.getLong("running_jobs"),
                rs.getLong("dead_jobs"), rs.getLong("retrying_jobs"), rs.getLong("failed_notifications"),
                rs.getLong("recent_audit_events")));
    }

    public Page<Account> users(int page, int size) {
        int offset = offset(page, size);
        List<Account> rows = jdbc.query("""
                SELECT u.user_id, u.email, u.created_at, u.last_seen_at, u.deletion_requested_at,
                       e.plan_code, e.status_code, c.sync_status
                FROM app_user u
                LEFT JOIN account_entitlement e ON e.user_id=u.user_id
                LEFT JOIN google_calendar_connection c ON c.user_id=u.user_id
                WHERE u.deleted_at IS NULL
                ORDER BY u.last_seen_at DESC, u.user_id ASC LIMIT ? OFFSET ?
                """, (rs, row) -> new Account(rs.getString("user_id"), maskEmail(rs.getString("email")),
                instant(rs, "created_at"), instant(rs, "last_seen_at"),
                rs.getTimestamp("deletion_requested_at") != null,
                safeCode(rs.getString("plan_code")), safeCode(rs.getString("status_code")),
                safeCode(rs.getString("sync_status"))), size + 1, offset);
        return page(rows, page, size);
    }

    public Page<SyncFailure> syncFailures(int page, int size) {
        int offset = offset(page, size);
        List<SyncFailure> rows = jdbc.query("""
                SELECT c.user_id, c.sync_status, c.last_error_code, c.last_sync_completed_at, c.updated_at
                FROM google_calendar_connection c JOIN app_user u ON u.user_id=c.user_id
                WHERE u.deleted_at IS NULL AND c.sync_status IN ('ERROR','REAUTHORIZE')
                ORDER BY c.updated_at DESC, c.user_id ASC LIMIT ? OFFSET ?
                """, (rs, row) -> new SyncFailure(rs.getString("user_id"), safeCode(rs.getString("sync_status")),
                errorCode(rs.getString("last_error_code")), instant(rs, "last_sync_completed_at"),
                instant(rs, "updated_at")), size + 1, offset);
        return page(rows, page, size);
    }

    public Page<JobFailure> jobFailures(int page, int size) {
        int offset = offset(page, size);
        List<JobFailure> rows = jdbc.query("""
                SELECT job_id, user_id, job_type, status, attempts, available_at, updated_at
                FROM integration_job WHERE status='DEAD' OR (status='PENDING' AND attempts>0)
                ORDER BY updated_at DESC, job_id ASC LIMIT ? OFFSET ?
                """, (rs, row) -> new JobFailure(rs.getString("job_id"), rs.getString("user_id"),
                safeCode(rs.getString("job_type")), safeCode(rs.getString("status")), rs.getInt("attempts"),
                instant(rs, "available_at"), instant(rs, "updated_at")), size + 1, offset);
        return page(rows, page, size);
    }

    public Page<AuditEvent> audit(int page, int size) {
        int offset = offset(page, size);
        List<AuditEvent> rows = jdbc.query("""
                SELECT a.event_id, a.user_id, a.action, a.revision, a.occurred_at
                FROM planner_audit_event a JOIN app_user u ON u.user_id=a.user_id
                WHERE u.deleted_at IS NULL
                ORDER BY a.occurred_at DESC, a.event_id ASC LIMIT ? OFFSET ?
                """, (rs, row) -> new AuditEvent(rs.getString("event_id"), rs.getString("user_id"),
                safeCode(rs.getString("action")), rs.getObject("revision", Long.class),
                instant(rs, "occurred_at")), size + 1, offset);
        return page(rows, page, size);
    }

    private static int offset(int page, int size) {
        if (page < 0 || page > MAX_PAGE || size < 1 || size > MAX_SIZE) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "page must be 0–200 and size must be 1–50");
        }
        return page * size;
    }

    private static <T> Page<T> page(List<T> rows, int page, int size) {
        boolean more = rows.size() > size;
        return new Page<>(List.copyOf(rows.subList(0, Math.min(size, rows.size()))), page, size,
                more && page < MAX_PAGE, more && page == MAX_PAGE);
    }

    private static Instant instant(ResultSet rs, String column) throws SQLException {
        var timestamp = rs.getTimestamp(column);
        return timestamp == null ? null : timestamp.toInstant();
    }

    static String maskEmail(String email) {
        if (email == null || email.isBlank()) return null;
        int at = email.lastIndexOf('@');
        return at > 0 && at < email.length() - 1 ? email.substring(0, 1) + "•••@" + email.substring(at + 1) : "비공개";
    }

    static String safeCode(String value) {
        return value == null ? null : value.matches("[A-Za-z0-9_.:-]{1,100}") ? value : "REDACTED";
    }

    static String errorCode(String value) {
        if (value == null) return null;
        return List.of("google-calendar-not-configured", "invalid-google-oauth-state",
                "google-calendar-authorization-failed", "google-calendar-not-connected",
                "google-calendar-reauthorization-required", "invalid-google-calendar-settings",
                "google-calendar-etag-conflict", "google-calendar-upstream-failure", "google-calendar-sync-failed")
                .contains(value) ? value : "OTHER";
    }

    public record Overview(Instant observedAt, long accounts, long recentAccounts, long activePlans,
                           long calendarConnections, long syncFailures, long queuedJobs, long runningJobs,
                           long deadJobs, long retryingJobs, long failedNotifications, long recentAuditEvents) {}
    public record Page<T>(List<T> items, int page, int size, boolean hasNext, boolean limited) {}
    public record Account(String userId, String maskedEmail, Instant createdAt, Instant lastSeenAt,
                          boolean deletionRequested, String planCode, String entitlementStatus, String syncStatus) {}
    public record SyncFailure(String userId, String status, String errorCode, Instant lastCompletedAt, Instant updatedAt) {}
    public record JobFailure(String jobId, String userId, String type, String status, int attempts,
                             Instant availableAt, Instant updatedAt) {}
    public record AuditEvent(String eventId, String userId, String action, Long revision, Instant occurredAt) {}
}
