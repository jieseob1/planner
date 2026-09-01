CREATE TABLE app_user (
    user_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin PRIMARY KEY,
    oidc_issuer VARCHAR(500) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL,
    oidc_subject VARCHAR(512) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL,
    identity_key CHAR(64) CHARACTER SET ascii COLLATE ascii_bin
        GENERATED ALWAYS AS (SHA2(CONCAT(oidc_issuer, CHAR(0), oidc_subject), 256)) STORED,
    email VARCHAR(320),
    display_name VARCHAR(200),
    timezone VARCHAR(80) NOT NULL DEFAULT 'Asia/Seoul',
    locale VARCHAR(20) NOT NULL DEFAULT 'ko-KR',
    created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
    last_seen_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
    deletion_requested_at DATETIME(6),
    deleted_at DATETIME(6),
    UNIQUE KEY app_user_oidc_uq (identity_key),
    KEY app_user_active_last_seen_idx (deleted_at, last_seen_at DESC)
) ENGINE=InnoDB;

INSERT IGNORE INTO app_user (user_id, oidc_issuer, oidc_subject, display_name)
SELECT user_id, 'urn:nowline:legacy', user_id, 'Migrated local user'
FROM (
    SELECT user_id FROM planner_revision_clock
    UNION
    SELECT user_id FROM planner_aggregate
    UNION
    SELECT user_id FROM planner_idempotency
) AS legacy_users;

ALTER TABLE planner_revision_clock
    ADD CONSTRAINT planner_revision_clock_user_fk
    FOREIGN KEY (user_id) REFERENCES app_user(user_id) ON DELETE CASCADE;

ALTER TABLE planner_aggregate
    ADD CONSTRAINT planner_aggregate_user_fk
    FOREIGN KEY (user_id) REFERENCES app_user(user_id) ON DELETE CASCADE;

ALTER TABLE planner_idempotency
    ADD CONSTRAINT planner_idempotency_user_fk
    FOREIGN KEY (user_id) REFERENCES app_user(user_id) ON DELETE CASCADE;
