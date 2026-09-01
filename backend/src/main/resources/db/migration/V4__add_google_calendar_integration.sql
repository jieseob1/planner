CREATE TABLE google_oauth_state (
    state_hash CHAR(64) CHARACTER SET ascii COLLATE ascii_bin PRIMARY KEY,
    user_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    code_verifier_cipher TEXT NOT NULL,
    return_path VARCHAR(500) NOT NULL,
    expires_at DATETIME(6) NOT NULL,
    created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
    KEY google_oauth_state_expiry_idx (expires_at),
    CONSTRAINT google_oauth_state_user_fk FOREIGN KEY (user_id) REFERENCES app_user(user_id) ON DELETE CASCADE
) ENGINE=InnoDB;

CREATE TABLE google_calendar_connection (
    user_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin PRIMARY KEY,
    google_account_email VARCHAR(320),
    refresh_token_cipher TEXT NOT NULL,
    granted_scopes JSON NOT NULL,
    selected_calendar_id VARCHAR(1024) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin,
    sync_direction VARCHAR(16) CHARACTER SET ascii COLLATE ascii_bin NOT NULL DEFAULT 'BIDIRECTIONAL'
        CHECK (sync_direction IN ('IMPORT_ONLY', 'EXPORT_ONLY', 'BIDIRECTIONAL')),
    sync_token TEXT,
    sync_status VARCHAR(24) CHARACTER SET ascii COLLATE ascii_bin NOT NULL DEFAULT 'PENDING'
        CHECK (sync_status IN ('PENDING', 'SYNCING', 'READY', 'REAUTHORIZE', 'ERROR')),
    last_sync_started_at DATETIME(6),
    last_sync_completed_at DATETIME(6),
    last_error_code VARCHAR(100),
    created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
    updated_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
    CONSTRAINT google_calendar_connection_user_fk FOREIGN KEY (user_id) REFERENCES app_user(user_id) ON DELETE CASCADE
) ENGINE=InnoDB;

CREATE TABLE google_calendar_event_link (
    link_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin PRIMARY KEY,
    user_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    calendar_id VARCHAR(1024) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL,
    google_event_id VARCHAR(1024) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL,
    google_etag VARCHAR(512) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin,
    nowline_block_id VARCHAR(160) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin,
    origin VARCHAR(16) CHARACTER SET ascii COLLATE ascii_bin NOT NULL CHECK (origin IN ('GOOGLE', 'NOWLINE')),
    summary VARCHAR(500) NOT NULL DEFAULT '',
    start_at DATETIME(6),
    end_at DATETIME(6),
    event_timezone VARCHAR(100),
    recurring_event_id VARCHAR(1024) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin,
    event_status VARCHAR(24) CHARACTER SET ascii COLLATE ascii_bin NOT NULL DEFAULT 'confirmed',
    google_updated_at DATETIME(6),
    payload_checksum CHAR(64) CHARACTER SET ascii COLLATE ascii_bin,
    event_identity CHAR(64) CHARACTER SET ascii COLLATE ascii_bin
        GENERATED ALWAYS AS (SHA2(CONCAT(calendar_id, CHAR(0), google_event_id), 256)) STORED,
    block_identity CHAR(64) CHARACTER SET ascii COLLATE ascii_bin
        GENERATED ALWAYS AS (
            CASE WHEN nowline_block_id IS NULL THEN NULL
                 ELSE SHA2(CONCAT(calendar_id, CHAR(0), nowline_block_id, CHAR(0), origin), 256)
            END
        ) STORED,
    created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
    updated_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
    UNIQUE KEY google_calendar_event_identity_uq (user_id, event_identity),
    UNIQUE KEY google_calendar_block_identity_uq (user_id, block_identity),
    KEY google_calendar_event_active_idx (user_id, event_status, start_at),
    CONSTRAINT google_calendar_event_user_fk FOREIGN KEY (user_id) REFERENCES app_user(user_id) ON DELETE CASCADE
) ENGINE=InnoDB;

CREATE TABLE google_calendar_watch_channel (
    channel_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin PRIMARY KEY,
    user_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    calendar_id VARCHAR(1024) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL,
    resource_id VARCHAR(1024) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL,
    channel_token_hash CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    expiration_at DATETIME(6) NOT NULL,
    last_message_number BIGINT,
    watch_identity CHAR(64) CHARACTER SET ascii COLLATE ascii_bin
        GENERATED ALWAYS AS (SHA2(calendar_id, 256)) STORED,
    created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
    updated_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
    UNIQUE KEY google_calendar_watch_identity_uq (user_id, watch_identity),
    CONSTRAINT google_calendar_watch_user_fk FOREIGN KEY (user_id) REFERENCES app_user(user_id) ON DELETE CASCADE
) ENGINE=InnoDB;

CREATE TABLE integration_job (
    job_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin PRIMARY KEY,
    user_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin,
    job_type VARCHAR(40) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    deduplication_key VARCHAR(300) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL,
    payload JSON NOT NULL DEFAULT (JSON_OBJECT()),
    status VARCHAR(16) CHARACTER SET ascii COLLATE ascii_bin NOT NULL DEFAULT 'PENDING'
        CHECK (status IN ('PENDING', 'RUNNING', 'SUCCEEDED', 'DEAD')),
    attempts INTEGER NOT NULL DEFAULT 0 CHECK (attempts >= 0),
    available_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
    locked_at DATETIME(6),
    locked_by VARCHAR(200),
    last_error VARCHAR(1000),
    active_identity CHAR(64) CHARACTER SET ascii COLLATE ascii_bin
        GENERATED ALWAYS AS (
            CASE WHEN status IN ('PENDING', 'RUNNING')
                 THEN SHA2(CONCAT(job_type, CHAR(0), deduplication_key), 256)
                 ELSE NULL
            END
        ) STORED,
    created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
    updated_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
    UNIQUE KEY integration_job_active_dedupe_idx (active_identity),
    KEY integration_job_poll_idx (status, available_at, created_at),
    CONSTRAINT integration_job_user_fk FOREIGN KEY (user_id) REFERENCES app_user(user_id) ON DELETE CASCADE
) ENGINE=InnoDB;
