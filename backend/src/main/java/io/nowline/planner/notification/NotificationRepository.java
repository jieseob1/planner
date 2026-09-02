package io.nowline.planner.notification;

import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Repository;
import org.springframework.transaction.annotation.Transactional;

import java.sql.Timestamp;
import java.time.Instant;
import java.util.List;
import java.util.Optional;
import java.util.UUID;

import static io.nowline.planner.persistence.JdbcValues.id;
import static io.nowline.planner.persistence.JdbcValues.uuid;

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
                ON DUPLICATE KEY UPDATE
                    user_id = VALUES(user_id),
                    platform = VALUES(platform),
                    subscription_cipher = VALUES(subscription_cipher),
                    label = VALUES(label),
                    last_seen_at = CURRENT_TIMESTAMP(6),
                    disabled_at = NULL,
                    updated_at = CURRENT_TIMESTAMP(6)
                """, id(deviceId), id(userId), platform, cipher, trim(label, 100));
    }

    public void disableDevice(UUID userId, UUID deviceId) {
        jdbc.update("""
                UPDATE notification_device SET disabled_at = CURRENT_TIMESTAMP(6), updated_at = CURRENT_TIMESTAMP(6)
                WHERE user_id = ? AND device_id = ?
                """, id(userId), id(deviceId));
    }

    public void disableDevice(UUID deviceId) {
        jdbc.update("UPDATE notification_device SET disabled_at = CURRENT_TIMESTAMP(6), updated_at = CURRENT_TIMESTAMP(6) WHERE device_id = ?", id(deviceId));
    }

    public List<Device> activeDevices(UUID userId) {
        return jdbc.query("""
                SELECT device_id, user_id, platform, subscription_cipher, label
                FROM notification_device WHERE user_id = ? AND disabled_at IS NULL
                ORDER BY last_seen_at DESC
                """, (rs, row) -> new Device(
                uuid(rs, "device_id"), uuid(rs, "user_id"),
                rs.getString("platform"), rs.getString("subscription_cipher"), rs.getString("label")), id(userId));
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
                INSERT IGNORE INTO notification_delivery (
                    delivery_id, user_id, notification_type, deduplication_key,
                    title, body, target_path, scheduled_for, available_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP(6))
                """, id(UUID.randomUUID()), id(userId), type, deduplicationKey,
                trim(title, 200), trim(body, 500), trim(targetPath, 500), Timestamp.from(scheduledFor)) == 1;
    }

    @Transactional
    public Optional<Delivery> claimDelivery() {
        List<String> candidates = jdbc.query("""
                SELECT delivery_id FROM notification_delivery
                WHERE status = 'PENDING' AND available_at <= CURRENT_TIMESTAMP(6)
                ORDER BY available_at, created_at
                LIMIT 1 FOR UPDATE SKIP LOCKED
                """, (rs, row) -> rs.getString("delivery_id"));
        if (candidates.isEmpty()) return Optional.empty();
        String deliveryId = candidates.getFirst();
        int claimed = jdbc.update("""
                UPDATE notification_delivery
                SET status = 'RUNNING', attempts = attempts + 1, locked_at = CURRENT_TIMESTAMP(6)
                WHERE delivery_id = ? AND status = 'PENDING'
                """, deliveryId);
        if (claimed != 1) return Optional.empty();
        return jdbc.query("""
                SELECT delivery_id, user_id, notification_type, title, body, target_path, attempts
                FROM notification_delivery WHERE delivery_id = ?
                """, rs -> rs.next() ? Optional.of(new Delivery(
                uuid(rs, "delivery_id"), uuid(rs, "user_id"),
                rs.getString("notification_type"), rs.getString("title"), rs.getString("body"),
                rs.getString("target_path"), rs.getInt("attempts"))) : Optional.empty(), deliveryId);
    }

    public void delivered(UUID deliveryId) {
        jdbc.update("""
                UPDATE notification_delivery SET status = 'DELIVERED', delivered_at = CURRENT_TIMESTAMP(6),
                    locked_at = NULL, last_error = NULL WHERE delivery_id = ?
                """, id(deliveryId));
    }

    public void skipped(UUID deliveryId, String reason) {
        jdbc.update("""
                UPDATE notification_delivery SET status = 'SKIPPED', locked_at = NULL, last_error = ?
                WHERE delivery_id = ?
                """, trim(reason, 500), id(deliveryId));
    }

    public void failed(UUID deliveryId, int attempts, String reason) {
        if (attempts >= 5) {
            jdbc.update("""
                    UPDATE notification_delivery SET status = 'FAILED', locked_at = NULL, last_error = ?
                    WHERE delivery_id = ?
                    """, trim(reason, 500), id(deliveryId));
            return;
        }
        long delay = Math.min(900, 15L * (1L << attempts));
        jdbc.update("""
                UPDATE notification_delivery SET status = 'PENDING', locked_at = NULL,
                    available_at = DATE_ADD(CURRENT_TIMESTAMP(6), INTERVAL ? SECOND), last_error = ?
                WHERE delivery_id = ?
                """, delay, trim(reason, 500), id(deliveryId));
    }

    public void recoverAbandoned() {
        jdbc.update("""
                UPDATE notification_delivery SET status = 'PENDING', locked_at = NULL,
                    available_at = CURRENT_TIMESTAMP(6), last_error = 'delivery-lease-expired'
                WHERE status = 'RUNNING' AND locked_at < DATE_SUB(CURRENT_TIMESTAMP(6), INTERVAL 10 MINUTE)
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
