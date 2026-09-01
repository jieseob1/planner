package io.nowline.planner.notification;

import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Repository;

import java.sql.Timestamp;
import java.time.Instant;
import java.util.List;
import java.util.Optional;
import java.util.UUID;

@Repository
public class NotificationRepository {

    private final JdbcTemplate jdbc;

    public NotificationRepository(JdbcTemplate jdbc) {
        this.jdbc = jdbc;
    }

    public void upsertDevice(UUID userId, UUID deviceId, String platform, String cipher, String label) {
        jdbc.update("""
                INSERT INTO notification_device (
                    device_id, user_id, platform, subscription_cipher, label
                ) VALUES (?, ?, ?, ?, ?)
                ON CONFLICT (user_id, device_id) DO UPDATE SET
                    platform = EXCLUDED.platform,
                    subscription_cipher = EXCLUDED.subscription_cipher,
                    label = EXCLUDED.label,
                    last_seen_at = now(),
                    disabled_at = NULL,
                    updated_at = now()
                """, deviceId, userId, platform, cipher, trim(label, 100));
    }

    public void disableDevice(UUID userId, UUID deviceId) {
        jdbc.update("""
                UPDATE notification_device SET disabled_at = now(), updated_at = now()
                WHERE user_id = ? AND device_id = ?
                """, userId, deviceId);
    }

    public void disableDevice(UUID deviceId) {
        jdbc.update("UPDATE notification_device SET disabled_at = now(), updated_at = now() WHERE device_id = ?", deviceId);
    }

    public List<Device> activeDevices(UUID userId) {
        return jdbc.query("""
                SELECT device_id, user_id, platform, subscription_cipher, label
                FROM notification_device WHERE user_id = ? AND disabled_at IS NULL
                ORDER BY last_seen_at DESC
                """, (rs, row) -> new Device(
                rs.getObject("device_id", UUID.class), rs.getObject("user_id", UUID.class),
                rs.getString("platform"), rs.getString("subscription_cipher"), rs.getString("label")), userId);
    }

    public boolean createDelivery(
            UUID userId,
            String type,
            String deduplicationKey,
            String title,
            String body,
            String targetPath,
            Instant scheduledFor
    ) {
        return jdbc.update("""
                INSERT INTO notification_delivery (
                    delivery_id, user_id, notification_type, deduplication_key,
                    title, body, target_path, scheduled_for, available_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, now())
                ON CONFLICT (user_id, deduplication_key) DO NOTHING
                """, UUID.randomUUID(), userId, type, deduplicationKey,
                trim(title, 200), trim(body, 500), trim(targetPath, 500), Timestamp.from(scheduledFor)) == 1;
    }

    public Optional<Delivery> claimDelivery() {
        return jdbc.query("""
                WITH candidate AS (
                    SELECT delivery_id FROM notification_delivery
                    WHERE status = 'PENDING' AND available_at <= now()
                    ORDER BY available_at, created_at
                    FOR UPDATE SKIP LOCKED LIMIT 1
                )
                UPDATE notification_delivery delivery
                SET status = 'RUNNING', attempts = attempts + 1, locked_at = now()
                FROM candidate WHERE delivery.delivery_id = candidate.delivery_id
                RETURNING delivery.delivery_id, delivery.user_id, delivery.notification_type,
                          delivery.title, delivery.body, delivery.target_path, delivery.attempts
                """, rs -> rs.next() ? Optional.of(new Delivery(
                rs.getObject("delivery_id", UUID.class), rs.getObject("user_id", UUID.class),
                rs.getString("notification_type"), rs.getString("title"), rs.getString("body"),
                rs.getString("target_path"), rs.getInt("attempts"))) : Optional.empty());
    }

    public void delivered(UUID deliveryId) {
        jdbc.update("""
                UPDATE notification_delivery SET status = 'DELIVERED', delivered_at = now(),
                    locked_at = NULL, last_error = NULL WHERE delivery_id = ?
                """, deliveryId);
    }

    public void skipped(UUID deliveryId, String reason) {
        jdbc.update("""
                UPDATE notification_delivery SET status = 'SKIPPED', locked_at = NULL, last_error = ?
                WHERE delivery_id = ?
                """, trim(reason, 500), deliveryId);
    }

    public void failed(UUID deliveryId, int attempts, String reason) {
        if (attempts >= 5) {
            jdbc.update("""
                    UPDATE notification_delivery SET status = 'FAILED', locked_at = NULL, last_error = ?
                    WHERE delivery_id = ?
                    """, trim(reason, 500), deliveryId);
            return;
        }
        long delay = Math.min(900, 15L * (1L << attempts));
        jdbc.update("""
                UPDATE notification_delivery SET status = 'PENDING', locked_at = NULL,
                    available_at = now() + (? * interval '1 second'), last_error = ?
                WHERE delivery_id = ?
                """, delay, trim(reason, 500), deliveryId);
    }

    public void recoverAbandoned() {
        jdbc.update("""
                UPDATE notification_delivery SET status = 'PENDING', locked_at = NULL,
                    available_at = now(), last_error = 'delivery-lease-expired'
                WHERE status = 'RUNNING' AND locked_at < now() - interval '10 minutes'
                """);
    }

    private String trim(String value, int max) {
        if (value == null) return null;
        return value.substring(0, Math.min(max, value.length()));
    }

    public record Device(UUID deviceId, UUID userId, String platform, String cipher, String label) {
    }

    public record Delivery(
            UUID deliveryId,
            UUID userId,
            String type,
            String title,
            String body,
            String targetPath,
            int attempts
    ) {
    }
}
