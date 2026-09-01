CREATE TABLE user_preference (
    user_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin PRIMARY KEY,
    timezone VARCHAR(100) NOT NULL DEFAULT 'Asia/Seoul',
    locale VARCHAR(20) NOT NULL DEFAULT 'ko-KR',
    daily_reminder_enabled BOOLEAN NOT NULL DEFAULT TRUE,
    daily_reminder_time TIME NOT NULL DEFAULT '08:00:00',
    block_reminder_minutes INTEGER NOT NULL DEFAULT 10 CHECK (block_reminder_minutes BETWEEN 0 AND 1440),
    updated_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
    CONSTRAINT user_preference_user_fk FOREIGN KEY (user_id) REFERENCES app_user(user_id) ON DELETE CASCADE
) ENGINE=InnoDB;

CREATE TABLE notification_device (
    device_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin PRIMARY KEY,
    user_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    platform VARCHAR(16) CHARACTER SET ascii COLLATE ascii_bin NOT NULL CHECK (platform IN ('WEB', 'IOS', 'ANDROID')),
    subscription_cipher TEXT NOT NULL,
    label VARCHAR(100),
    last_seen_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
    disabled_at DATETIME(6),
    created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
    updated_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
    UNIQUE KEY notification_device_user_uq (user_id, device_id),
    KEY notification_device_active_idx (user_id, disabled_at),
    CONSTRAINT notification_device_user_fk FOREIGN KEY (user_id) REFERENCES app_user(user_id) ON DELETE CASCADE
) ENGINE=InnoDB;

CREATE TABLE notification_delivery (
    delivery_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin PRIMARY KEY,
    user_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    device_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin,
    notification_type VARCHAR(40) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    deduplication_key VARCHAR(300) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL,
    title VARCHAR(200) NOT NULL,
    body VARCHAR(500) NOT NULL,
    target_path VARCHAR(500) NOT NULL,
    scheduled_for DATETIME(6) NOT NULL,
    available_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
    delivered_at DATETIME(6),
    status VARCHAR(16) CHARACTER SET ascii COLLATE ascii_bin NOT NULL DEFAULT 'PENDING'
        CHECK (status IN ('PENDING', 'RUNNING', 'DELIVERED', 'FAILED', 'SKIPPED')),
    attempts INTEGER NOT NULL DEFAULT 0 CHECK (attempts >= 0),
    locked_at DATETIME(6),
    last_error VARCHAR(500),
    created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
    UNIQUE KEY notification_delivery_dedupe_uq (user_id, deduplication_key),
    KEY notification_delivery_due_idx (status, available_at, scheduled_for),
    CONSTRAINT notification_delivery_user_fk FOREIGN KEY (user_id) REFERENCES app_user(user_id) ON DELETE CASCADE,
    CONSTRAINT notification_delivery_device_fk FOREIGN KEY (device_id) REFERENCES notification_device(device_id) ON DELETE SET NULL
) ENGINE=InnoDB;
