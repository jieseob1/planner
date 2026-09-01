CREATE TABLE app_user (
    user_id UUID PRIMARY KEY,
    oidc_issuer VARCHAR(500) NOT NULL,
    oidc_subject VARCHAR(512) NOT NULL,
    email VARCHAR(320),
    display_name VARCHAR(200),
    timezone VARCHAR(80) NOT NULL DEFAULT 'Asia/Seoul',
    locale VARCHAR(20) NOT NULL DEFAULT 'ko-KR',
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    last_seen_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    deletion_requested_at TIMESTAMPTZ,
    deleted_at TIMESTAMPTZ,
    UNIQUE (oidc_issuer, oidc_subject)
);

INSERT INTO app_user (user_id, oidc_issuer, oidc_subject, display_name)
SELECT user_id, 'urn:nowline:legacy', user_id::text, 'Migrated local user'
FROM (
    SELECT user_id FROM planner_revision_clock
    UNION
    SELECT user_id FROM planner_aggregate
    UNION
    SELECT user_id FROM planner_idempotency
) legacy_users
ON CONFLICT (user_id) DO NOTHING;

ALTER TABLE planner_revision_clock
    ADD CONSTRAINT planner_revision_clock_user_fk
    FOREIGN KEY (user_id) REFERENCES app_user(user_id) ON DELETE CASCADE;

ALTER TABLE planner_aggregate
    ADD CONSTRAINT planner_aggregate_user_fk
    FOREIGN KEY (user_id) REFERENCES app_user(user_id) ON DELETE CASCADE;

ALTER TABLE planner_idempotency
    ADD CONSTRAINT planner_idempotency_user_fk
    FOREIGN KEY (user_id) REFERENCES app_user(user_id) ON DELETE CASCADE;

CREATE INDEX app_user_active_last_seen_idx
    ON app_user(last_seen_at DESC)
    WHERE deleted_at IS NULL;
