CREATE TABLE google_oauth_state (
    state_hash CHAR(64) PRIMARY KEY,
    user_id UUID NOT NULL REFERENCES app_user(user_id) ON DELETE CASCADE,
    code_verifier_cipher TEXT NOT NULL,
    return_path VARCHAR(500) NOT NULL,
    expires_at TIMESTAMPTZ NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX google_oauth_state_expiry_idx ON google_oauth_state(expires_at);

CREATE TABLE google_calendar_connection (
    user_id UUID PRIMARY KEY REFERENCES app_user(user_id) ON DELETE CASCADE,
    google_account_email VARCHAR(320),
    refresh_token_cipher TEXT NOT NULL,
    granted_scopes TEXT[] NOT NULL,
    selected_calendar_id VARCHAR(1024),
    sync_direction VARCHAR(16) NOT NULL DEFAULT 'BIDIRECTIONAL'
        CHECK (sync_direction IN ('IMPORT_ONLY', 'EXPORT_ONLY', 'BIDIRECTIONAL')),
    sync_token TEXT,
    sync_status VARCHAR(24) NOT NULL DEFAULT 'PENDING'
        CHECK (sync_status IN ('PENDING', 'SYNCING', 'READY', 'REAUTHORIZE', 'ERROR')),
    last_sync_started_at TIMESTAMPTZ,
    last_sync_completed_at TIMESTAMPTZ,
    last_error_code VARCHAR(100),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE google_calendar_event_link (
    link_id UUID PRIMARY KEY,
    user_id UUID NOT NULL REFERENCES app_user(user_id) ON DELETE CASCADE,
    calendar_id VARCHAR(1024) NOT NULL,
    google_event_id VARCHAR(1024) NOT NULL,
    google_etag VARCHAR(512),
    nowline_block_id VARCHAR(160),
    origin VARCHAR(16) NOT NULL CHECK (origin IN ('GOOGLE', 'NOWLINE')),
    summary VARCHAR(500) NOT NULL DEFAULT '',
    start_at TIMESTAMPTZ,
    end_at TIMESTAMPTZ,
    event_timezone VARCHAR(100),
    recurring_event_id VARCHAR(1024),
    event_status VARCHAR(24) NOT NULL DEFAULT 'confirmed',
    google_updated_at TIMESTAMPTZ,
    payload_checksum CHAR(64),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (user_id, calendar_id, google_event_id),
    UNIQUE NULLS NOT DISTINCT (user_id, calendar_id, nowline_block_id, origin)
);

CREATE INDEX google_calendar_event_active_idx
    ON google_calendar_event_link(user_id, calendar_id, start_at)
    WHERE event_status <> 'cancelled';

CREATE TABLE google_calendar_watch_channel (
    channel_id UUID PRIMARY KEY,
    user_id UUID NOT NULL REFERENCES app_user(user_id) ON DELETE CASCADE,
    calendar_id VARCHAR(1024) NOT NULL,
    resource_id VARCHAR(1024) NOT NULL,
    channel_token_hash CHAR(64) NOT NULL,
    expiration_at TIMESTAMPTZ NOT NULL,
    last_message_number BIGINT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (user_id, calendar_id)
);

CREATE TABLE integration_job (
    job_id UUID PRIMARY KEY,
    user_id UUID REFERENCES app_user(user_id) ON DELETE CASCADE,
    job_type VARCHAR(40) NOT NULL,
    deduplication_key VARCHAR(300) NOT NULL,
    payload JSONB NOT NULL DEFAULT '{}'::jsonb,
    status VARCHAR(16) NOT NULL DEFAULT 'PENDING'
        CHECK (status IN ('PENDING', 'RUNNING', 'SUCCEEDED', 'DEAD')),
    attempts INTEGER NOT NULL DEFAULT 0 CHECK (attempts >= 0),
    available_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    locked_at TIMESTAMPTZ,
    locked_by VARCHAR(200),
    last_error VARCHAR(1000),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX integration_job_active_dedupe_idx
    ON integration_job(job_type, deduplication_key)
    WHERE status IN ('PENDING', 'RUNNING');

CREATE INDEX integration_job_poll_idx
    ON integration_job(status, available_at, created_at)
    WHERE status = 'PENDING';

DROP TRIGGER IF EXISTS planner_time_block_overlap_guard ON planner_time_block;
ALTER TABLE planner_time_block DROP CONSTRAINT IF EXISTS planner_time_block_no_overlap;

CREATE OR REPLACE FUNCTION enforce_planner_time_block_overlap() RETURNS trigger AS $$
BEGIN
    IF EXISTS (
        SELECT 1 FROM planner_time_block existing
        WHERE existing.user_id = NEW.user_id
          AND existing.week_offset = NEW.week_offset
          AND existing.day_key = NEW.day_key
          AND existing.block_id <> NEW.block_id
          AND int4range(existing.start_minutes, existing.start_minutes + existing.duration_minutes, '[)')
              && int4range(NEW.start_minutes, NEW.start_minutes + NEW.duration_minutes, '[)')
          AND NOT (existing.external OR NEW.external)
    ) THEN
        RAISE EXCEPTION 'planner time blocks overlap' USING ERRCODE = '23P01';
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER planner_time_block_overlap_guard
BEFORE INSERT OR UPDATE ON planner_time_block
FOR EACH ROW EXECUTE FUNCTION enforce_planner_time_block_overlap();
