package io.nowline.planner.integration.calendar;

import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Repository;

import java.sql.Array;
import java.sql.Timestamp;
import java.time.Instant;
import java.util.Arrays;
import java.util.List;
import java.util.Optional;
import java.util.UUID;

@Repository
public class CalendarIntegrationRepository {

    private final JdbcTemplate jdbc;

    public CalendarIntegrationRepository(JdbcTemplate jdbc) {
        this.jdbc = jdbc;
    }

    public void saveState(String stateHash, UUID userId, String verifierCipher, String returnPath, Instant expiresAt) {
        jdbc.update("""
                        INSERT INTO google_oauth_state (
                            state_hash, user_id, code_verifier_cipher, return_path, expires_at
                        ) VALUES (?, ?, ?, ?, ?)
                        """, stateHash, userId, verifierCipher, returnPath, Timestamp.from(expiresAt));
    }

    public Optional<OAuthState> consumeState(String stateHash) {
        return jdbc.query("""
                        DELETE FROM google_oauth_state
                        WHERE state_hash = ? AND expires_at > now()
                        RETURNING user_id, code_verifier_cipher, return_path
                        """, rs -> rs.next() ? Optional.of(new OAuthState(
                rs.getObject("user_id", UUID.class),
                rs.getString("code_verifier_cipher"),
                rs.getString("return_path"))) : Optional.empty(), stateHash);
    }

    public void purgeExpiredStates() {
        jdbc.update("DELETE FROM google_oauth_state WHERE expires_at <= now()");
    }

    public void upsertConnection(
            UUID userId,
            String email,
            String refreshTokenCipher,
            List<String> scopes,
            String selectedCalendarId
    ) {
        jdbc.update(connection -> {
            var statement = connection.prepareStatement("""
                    INSERT INTO google_calendar_connection (
                        user_id, google_account_email, refresh_token_cipher, granted_scopes,
                        selected_calendar_id, sync_status
                    ) VALUES (?, ?, ?, ?, ?, 'PENDING')
                    ON CONFLICT (user_id) DO UPDATE SET
                        google_account_email = COALESCE(EXCLUDED.google_account_email, google_calendar_connection.google_account_email),
                        refresh_token_cipher = EXCLUDED.refresh_token_cipher,
                        granted_scopes = EXCLUDED.granted_scopes,
                        selected_calendar_id = COALESCE(EXCLUDED.selected_calendar_id, google_calendar_connection.selected_calendar_id),
                        sync_token = NULL,
                        sync_status = 'PENDING',
                        last_error_code = NULL,
                        updated_at = now()
                    """);
            statement.setObject(1, userId);
            statement.setString(2, email);
            statement.setString(3, refreshTokenCipher);
            Array scopeArray = connection.createArrayOf("text", scopes.toArray());
            statement.setArray(4, scopeArray);
            statement.setString(5, selectedCalendarId);
            return statement;
        });
    }

    public Optional<Connection> findConnection(UUID userId) {
        return jdbc.query("""
                        SELECT user_id, google_account_email, refresh_token_cipher, granted_scopes,
                               selected_calendar_id, sync_direction, sync_token, sync_status,
                               last_sync_started_at, last_sync_completed_at, last_error_code,
                               created_at, updated_at
                        FROM google_calendar_connection WHERE user_id = ?
                        """, rs -> rs.next() ? Optional.of(new Connection(
                rs.getObject("user_id", UUID.class),
                rs.getString("google_account_email"),
                rs.getString("refresh_token_cipher"),
                Arrays.asList((String[]) rs.getArray("granted_scopes").getArray()),
                rs.getString("selected_calendar_id"),
                rs.getString("sync_direction"),
                rs.getString("sync_token"),
                rs.getString("sync_status"),
                instant(rs.getTimestamp("last_sync_started_at")),
                instant(rs.getTimestamp("last_sync_completed_at")),
                rs.getString("last_error_code"),
                rs.getTimestamp("created_at").toInstant(),
                rs.getTimestamp("updated_at").toInstant())) : Optional.empty(), userId);
    }

    public void updateSettings(UUID userId, String calendarId, String direction) {
        int updated = jdbc.update("""
                        UPDATE google_calendar_connection
                        SET selected_calendar_id = ?, sync_direction = ?, sync_token = NULL,
                            sync_status = 'PENDING', last_error_code = NULL, updated_at = now()
                        WHERE user_id = ?
                        """, calendarId, direction, userId);
        if (updated != 1) throw CalendarIntegrationException.notConnected();
    }

    public void deleteConnection(UUID userId) {
        jdbc.update("DELETE FROM google_calendar_connection WHERE user_id = ?", userId);
    }

    public void markSyncing(UUID userId) {
        jdbc.update("""
                UPDATE google_calendar_connection
                SET sync_status = 'SYNCING', last_sync_started_at = now(), last_error_code = NULL, updated_at = now()
                WHERE user_id = ?
                """, userId);
    }

    public void markReady(UUID userId, String syncToken) {
        jdbc.update("""
                UPDATE google_calendar_connection
                SET sync_status = 'READY', sync_token = ?, last_sync_completed_at = now(),
                    last_error_code = NULL, updated_at = now()
                WHERE user_id = ?
                """, syncToken, userId);
    }

    public void markFailed(UUID userId, String status, String errorCode) {
        jdbc.update("""
                UPDATE google_calendar_connection
                SET sync_status = ?, last_error_code = ?, updated_at = now()
                WHERE user_id = ?
                """, status, trim(errorCode, 100), userId);
    }

    public List<String> googleBlockIds(UUID userId, String calendarId) {
        return jdbc.query("""
                SELECT nowline_block_id FROM google_calendar_event_link
                WHERE user_id = ? AND calendar_id = ? AND origin = 'GOOGLE'
                  AND nowline_block_id IS NOT NULL AND event_status <> 'cancelled'
                """, (rs, row) -> rs.getString(1), userId, calendarId);
    }

    public void clearGoogleLinks(UUID userId, String calendarId) {
        jdbc.update("""
                DELETE FROM google_calendar_event_link
                WHERE user_id = ? AND calendar_id = ? AND origin = 'GOOGLE'
                """, userId, calendarId);
        jdbc.update("""
                UPDATE google_calendar_connection SET sync_token = NULL, updated_at = now()
                WHERE user_id = ?
                """, userId);
    }

    public Optional<EventLink> findLinkByEvent(UUID userId, String calendarId, String eventId) {
        return jdbc.query("""
                SELECT link_id, user_id, calendar_id, google_event_id, google_etag, nowline_block_id,
                       origin, summary, start_at, end_at, event_timezone, recurring_event_id,
                       event_status, google_updated_at, payload_checksum
                FROM google_calendar_event_link
                WHERE user_id = ? AND calendar_id = ? AND google_event_id = ?
                """, rs -> rs.next() ? Optional.of(eventLink(rs)) : Optional.empty(), userId, calendarId, eventId);
    }

    public Optional<EventLink> findNowlineLink(UUID userId, String calendarId, String blockId) {
        return jdbc.query("""
                SELECT link_id, user_id, calendar_id, google_event_id, google_etag, nowline_block_id,
                       origin, summary, start_at, end_at, event_timezone, recurring_event_id,
                       event_status, google_updated_at, payload_checksum
                FROM google_calendar_event_link
                WHERE user_id = ? AND calendar_id = ? AND nowline_block_id = ? AND origin = 'NOWLINE'
                """, rs -> rs.next() ? Optional.of(eventLink(rs)) : Optional.empty(), userId, calendarId, blockId);
    }

    public List<EventLink> nowlineLinks(UUID userId, String calendarId) {
        return jdbc.query("""
                SELECT link_id, user_id, calendar_id, google_event_id, google_etag, nowline_block_id,
                       origin, summary, start_at, end_at, event_timezone, recurring_event_id,
                       event_status, google_updated_at, payload_checksum
                FROM google_calendar_event_link
                WHERE user_id = ? AND calendar_id = ? AND origin = 'NOWLINE'
                """, (rs, row) -> eventLink(rs), userId, calendarId);
    }

    public void upsertEventLink(
            UUID userId,
            String calendarId,
            GoogleCalendarGateway.CalendarEvent event,
            String blockId,
            String origin,
            Instant startAt,
            Instant endAt,
            String timeZone,
            String checksum
    ) {
        jdbc.update("""
                INSERT INTO google_calendar_event_link (
                    link_id, user_id, calendar_id, google_event_id, google_etag, nowline_block_id,
                    origin, summary, start_at, end_at, event_timezone, recurring_event_id,
                    event_status, google_updated_at, payload_checksum
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                ON CONFLICT (user_id, calendar_id, google_event_id) DO UPDATE SET
                    google_etag = EXCLUDED.google_etag,
                    nowline_block_id = EXCLUDED.nowline_block_id,
                    origin = EXCLUDED.origin,
                    summary = EXCLUDED.summary,
                    start_at = EXCLUDED.start_at,
                    end_at = EXCLUDED.end_at,
                    event_timezone = EXCLUDED.event_timezone,
                    recurring_event_id = EXCLUDED.recurring_event_id,
                    event_status = EXCLUDED.event_status,
                    google_updated_at = EXCLUDED.google_updated_at,
                    payload_checksum = EXCLUDED.payload_checksum,
                    updated_at = now()
                """,
                UUID.randomUUID(), userId, calendarId, event.id(), event.etag(), blockId, origin,
                event.summary() == null ? "" : trim(event.summary(), 500),
                timestamp(startAt), timestamp(endAt), timeZone, event.recurringEventId(),
                event.status() == null ? "confirmed" : event.status(), timestamp(event.updatedAt()), checksum);
    }

    public void deleteEventLink(UUID userId, UUID linkId) {
        jdbc.update("DELETE FROM google_calendar_event_link WHERE user_id = ? AND link_id = ?", userId, linkId);
    }

    public void enqueue(UUID userId, String type, String deduplicationKey) {
        jdbc.update("""
                        INSERT INTO integration_job (job_id, user_id, job_type, deduplication_key)
                        VALUES (?, ?, ?, ?)
                        ON CONFLICT DO NOTHING
                        """, UUID.randomUUID(), userId, type, deduplicationKey);
    }

    public Optional<Job> claimJob(String workerId) {
        return jdbc.query("""
                WITH candidate AS (
                    SELECT job_id FROM integration_job
                    WHERE status = 'PENDING' AND available_at <= now()
                    ORDER BY available_at, created_at
                    FOR UPDATE SKIP LOCKED
                    LIMIT 1
                )
                UPDATE integration_job job
                SET status = 'RUNNING', locked_at = now(), locked_by = ?,
                    attempts = attempts + 1, updated_at = now()
                FROM candidate
                WHERE job.job_id = candidate.job_id
                RETURNING job.job_id, job.user_id, job.job_type, job.deduplication_key, job.attempts
                """, rs -> rs.next() ? Optional.of(new Job(
                rs.getObject("job_id", UUID.class),
                rs.getObject("user_id", UUID.class),
                rs.getString("job_type"),
                rs.getString("deduplication_key"),
                rs.getInt("attempts"))) : Optional.empty(), workerId);
    }

    public void completeJob(UUID jobId) {
        jdbc.update("""
                UPDATE integration_job SET status = 'SUCCEEDED', locked_at = NULL, locked_by = NULL,
                    last_error = NULL, updated_at = now() WHERE job_id = ? AND status = 'RUNNING'
                """, jobId);
    }

    public void retryJob(UUID jobId, int attempts, String error) {
        if (attempts >= 8) {
            jdbc.update("""
                    UPDATE integration_job SET status = 'DEAD', locked_at = NULL, locked_by = NULL,
                        last_error = ?, updated_at = now() WHERE job_id = ?
                    """, trim(error, 1000), jobId);
            return;
        }
        long delaySeconds = Math.min(900, 5L * (1L << Math.min(attempts, 8)));
        jdbc.update("""
                UPDATE integration_job SET status = 'PENDING', locked_at = NULL, locked_by = NULL,
                    available_at = now() + (? * interval '1 second'), last_error = ?, updated_at = now()
                WHERE job_id = ?
                """, delaySeconds, trim(error, 1000), jobId);
    }

    public void recoverAbandonedJobs() {
        jdbc.update("""
                UPDATE integration_job SET status = 'PENDING', locked_at = NULL, locked_by = NULL,
                    available_at = now(), last_error = 'worker-lease-expired', updated_at = now()
                WHERE status = 'RUNNING' AND locked_at < now() - interval '10 minutes'
                """);
    }

    public Optional<WatchChannel> findWatch(UUID userId, String calendarId) {
        return jdbc.query("""
                SELECT channel_id, user_id, calendar_id, resource_id, channel_token_hash,
                       expiration_at, last_message_number
                FROM google_calendar_watch_channel WHERE user_id = ? AND calendar_id = ?
                """, rs -> rs.next() ? Optional.of(watch(rs)) : Optional.empty(), userId, calendarId);
    }

    public Optional<WatchChannel> findWatchByChannel(UUID channelId, String resourceId) {
        return jdbc.query("""
                SELECT channel_id, user_id, calendar_id, resource_id, channel_token_hash,
                       expiration_at, last_message_number
                FROM google_calendar_watch_channel WHERE channel_id = ? AND resource_id = ?
                """, rs -> rs.next() ? Optional.of(watch(rs)) : Optional.empty(), channelId, resourceId);
    }

    public void upsertWatch(
            UUID userId,
            String calendarId,
            UUID channelId,
            String resourceId,
            String tokenHash,
            Instant expirationAt
    ) {
        jdbc.update("""
                INSERT INTO google_calendar_watch_channel (
                    channel_id, user_id, calendar_id, resource_id, channel_token_hash, expiration_at
                ) VALUES (?, ?, ?, ?, ?, ?)
                ON CONFLICT (user_id, calendar_id) DO UPDATE SET
                    channel_id = EXCLUDED.channel_id,
                    resource_id = EXCLUDED.resource_id,
                    channel_token_hash = EXCLUDED.channel_token_hash,
                    expiration_at = EXCLUDED.expiration_at,
                    last_message_number = NULL,
                    updated_at = now()
                """, channelId, userId, calendarId, resourceId, tokenHash, timestamp(expirationAt));
    }

    public boolean acceptWatchMessage(UUID channelId, String resourceId, String tokenHash, long messageNumber) {
        return jdbc.update("""
                UPDATE google_calendar_watch_channel
                SET last_message_number = ?, updated_at = now()
                WHERE channel_id = ? AND resource_id = ? AND channel_token_hash = ?
                  AND expiration_at > now()
                  AND (last_message_number IS NULL OR last_message_number < ?)
                """, messageNumber, channelId, resourceId, tokenHash, messageNumber) == 1;
    }

    public void deleteWatch(UUID userId, String calendarId) {
        jdbc.update("DELETE FROM google_calendar_watch_channel WHERE user_id = ? AND calendar_id = ?", userId, calendarId);
    }

    public List<Connection> connectionsNeedingWatch(Instant before) {
        return jdbc.query("""
                SELECT c.user_id, c.google_account_email, c.refresh_token_cipher, c.granted_scopes,
                       c.selected_calendar_id, c.sync_direction, c.sync_token, c.sync_status,
                       c.last_sync_started_at, c.last_sync_completed_at, c.last_error_code,
                       c.created_at, c.updated_at
                FROM google_calendar_connection c
                LEFT JOIN google_calendar_watch_channel w ON w.user_id = c.user_id
                    AND w.calendar_id = c.selected_calendar_id
                WHERE c.selected_calendar_id IS NOT NULL
                  AND (w.channel_id IS NULL OR w.expiration_at < ?)
                ORDER BY c.updated_at
                LIMIT 200
                """, (rs, row) -> connection(rs), timestamp(before));
    }

    public List<UUID> connectionsNeedingReconciliation(Instant before) {
        return jdbc.query("""
                SELECT user_id FROM google_calendar_connection
                WHERE last_sync_completed_at IS NULL OR last_sync_completed_at < ?
                ORDER BY COALESCE(last_sync_completed_at, created_at)
                LIMIT 500
                """, (rs, row) -> rs.getObject(1, UUID.class), timestamp(before));
    }

    private Connection connection(java.sql.ResultSet rs) throws java.sql.SQLException {
        return new Connection(
                rs.getObject("user_id", UUID.class),
                rs.getString("google_account_email"),
                rs.getString("refresh_token_cipher"),
                Arrays.asList((String[]) rs.getArray("granted_scopes").getArray()),
                rs.getString("selected_calendar_id"),
                rs.getString("sync_direction"),
                rs.getString("sync_token"),
                rs.getString("sync_status"),
                instant(rs.getTimestamp("last_sync_started_at")),
                instant(rs.getTimestamp("last_sync_completed_at")),
                rs.getString("last_error_code"),
                rs.getTimestamp("created_at").toInstant(),
                rs.getTimestamp("updated_at").toInstant());
    }

    private EventLink eventLink(java.sql.ResultSet rs) throws java.sql.SQLException {
        return new EventLink(
                rs.getObject("link_id", UUID.class), rs.getObject("user_id", UUID.class),
                rs.getString("calendar_id"), rs.getString("google_event_id"), rs.getString("google_etag"),
                rs.getString("nowline_block_id"), rs.getString("origin"), rs.getString("summary"),
                instant(rs.getTimestamp("start_at")), instant(rs.getTimestamp("end_at")),
                rs.getString("event_timezone"), rs.getString("recurring_event_id"),
                rs.getString("event_status"), instant(rs.getTimestamp("google_updated_at")),
                rs.getString("payload_checksum"));
    }

    private WatchChannel watch(java.sql.ResultSet rs) throws java.sql.SQLException {
        return new WatchChannel(
                rs.getObject("channel_id", UUID.class), rs.getObject("user_id", UUID.class),
                rs.getString("calendar_id"), rs.getString("resource_id"), rs.getString("channel_token_hash"),
                rs.getTimestamp("expiration_at").toInstant(), rs.getObject("last_message_number", Long.class));
    }

    private Timestamp timestamp(Instant value) {
        return value == null ? null : Timestamp.from(value);
    }

    private String trim(String value, int max) {
        if (value == null) return null;
        return value.substring(0, Math.min(max, value.length()));
    }

    private Instant instant(Timestamp value) {
        return value == null ? null : value.toInstant();
    }

    public record OAuthState(UUID userId, String verifierCipher, String returnPath) {
    }

    public record Connection(
            UUID userId,
            String email,
            String refreshTokenCipher,
            List<String> scopes,
            String selectedCalendarId,
            String syncDirection,
            String syncToken,
            String syncStatus,
            Instant lastSyncStartedAt,
            Instant lastSyncCompletedAt,
            String lastErrorCode,
            Instant createdAt,
            Instant updatedAt
    ) {
    }

    public record EventLink(
            UUID linkId,
            UUID userId,
            String calendarId,
            String googleEventId,
            String googleEtag,
            String nowlineBlockId,
            String origin,
            String summary,
            Instant startAt,
            Instant endAt,
            String timeZone,
            String recurringEventId,
            String eventStatus,
            Instant googleUpdatedAt,
            String payloadChecksum
    ) {
    }

    public record Job(UUID jobId, UUID userId, String type, String deduplicationKey, int attempts) {
    }

    public record WatchChannel(
            UUID channelId,
            UUID userId,
            String calendarId,
            String resourceId,
            String tokenHash,
            Instant expirationAt,
            Long lastMessageNumber
    ) {
    }
}
