CREATE TABLE user_preference (
    user_id UUID PRIMARY KEY REFERENCES app_user(user_id) ON DELETE CASCADE,
    timezone VARCHAR(100) NOT NULL DEFAULT 'Asia/Seoul',
    locale VARCHAR(20) NOT NULL DEFAULT 'ko-KR',
    daily_reminder_enabled BOOLEAN NOT NULL DEFAULT true,
    daily_reminder_time TIME NOT NULL DEFAULT TIME '08:00',
    block_reminder_minutes INTEGER NOT NULL DEFAULT 10 CHECK (block_reminder_minutes BETWEEN 0 AND 1440),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE notification_device (
    device_id UUID PRIMARY KEY,
    user_id UUID NOT NULL REFERENCES app_user(user_id) ON DELETE CASCADE,
    platform VARCHAR(16) NOT NULL CHECK (platform IN ('WEB', 'IOS', 'ANDROID')),
    subscription_cipher TEXT NOT NULL,
    label VARCHAR(100),
    last_seen_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    disabled_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (user_id, device_id)
);

CREATE INDEX notification_device_active_idx ON notification_device(user_id)
    WHERE disabled_at IS NULL;

CREATE TABLE notification_delivery (
    delivery_id UUID PRIMARY KEY,
    user_id UUID NOT NULL REFERENCES app_user(user_id) ON DELETE CASCADE,
    device_id UUID REFERENCES notification_device(device_id) ON DELETE SET NULL,
    notification_type VARCHAR(40) NOT NULL,
    deduplication_key VARCHAR(300) NOT NULL,
    title VARCHAR(200) NOT NULL,
    body VARCHAR(500) NOT NULL,
    target_path VARCHAR(500) NOT NULL,
    scheduled_for TIMESTAMPTZ NOT NULL,
    available_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    delivered_at TIMESTAMPTZ,
    status VARCHAR(16) NOT NULL DEFAULT 'PENDING'
        CHECK (status IN ('PENDING', 'RUNNING', 'DELIVERED', 'FAILED', 'SKIPPED')),
    attempts INTEGER NOT NULL DEFAULT 0,
    locked_at TIMESTAMPTZ,
    last_error VARCHAR(500),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (user_id, deduplication_key)
);

CREATE INDEX notification_delivery_due_idx ON notification_delivery(status, scheduled_for)
    WHERE status = 'PENDING';
