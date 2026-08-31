CREATE EXTENSION IF NOT EXISTS btree_gist;

CREATE TABLE planner_revision_clock (
    user_id UUID PRIMARY KEY,
    last_revision BIGINT NOT NULL CHECK (last_revision > 0),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE planner_aggregate (
    user_id UUID PRIMARY KEY,
    revision BIGINT NOT NULL CHECK (revision > 0),
    snapshot_version SMALLINT NOT NULL CHECK (snapshot_version = 1),
    planner_week_offset INTEGER NOT NULL CHECK (planner_week_offset BETWEEN -520 AND 520),
    plan_year INTEGER NOT NULL CHECK (plan_year BETWEEN 1900 AND 9999),
    annual_direction VARCHAR(2000) NOT NULL CHECK (btrim(annual_direction) <> ''),
    plan_quarter SMALLINT NOT NULL CHECK (plan_quarter BETWEEN 1 AND 4),
    quarter_focus VARCHAR(2000) NOT NULL CHECK (btrim(quarter_focus) <> ''),
    quarter_end_date DATE NOT NULL,
    review_blocker VARCHAR(2000),
    review_metric_draft VARCHAR(200) NOT NULL,
    review_completed_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE planner_outcome (
    user_id UUID NOT NULL,
    outcome_id VARCHAR(160) NOT NULL CHECK (btrim(outcome_id) <> ''),
    sort_order INTEGER NOT NULL CHECK (sort_order >= 0),
    title VARCHAR(500) NOT NULL CHECK (btrim(title) <> ''),
    parent_title VARCHAR(500) NOT NULL CHECK (btrim(parent_title) <> ''),
    current_value NUMERIC(20, 6),
    target_value NUMERIC(20, 6) NOT NULL CHECK (target_value > 0),
    unit VARCHAR(40) NOT NULL CHECK (btrim(unit) <> ''),
    confidence VARCHAR(16) NOT NULL CHECK (confidence IN ('high', 'medium', 'low', 'unknown')),
    last_updated_days INTEGER CHECK (last_updated_days >= 0),
    actual_hours NUMERIC(20, 6) NOT NULL CHECK (actual_hours >= 0),
    needed_hours NUMERIC(20, 6) NOT NULL CHECK (needed_hours >= 0),
    available_hours NUMERIC(20, 6) NOT NULL CHECK (available_hours >= 0),
    evidence_label VARCHAR(500) NOT NULL CHECK (btrim(evidence_label) <> ''),
    change_label VARCHAR(500) NOT NULL CHECK (btrim(change_label) <> ''),
    attention VARCHAR(24) NOT NULL CHECK (attention IN ('none', 'stale', 'time-shortage', 'stalled', 'no-evidence')),
    decision VARCHAR(16) CHECK (decision IN ('keep', 'reduce', 'extend', 'stop')),
    PRIMARY KEY (user_id, outcome_id),
    UNIQUE (user_id, sort_order),
    FOREIGN KEY (user_id) REFERENCES planner_aggregate(user_id) ON DELETE CASCADE
);

CREATE TABLE planner_task (
    user_id UUID NOT NULL,
    task_id VARCHAR(160) NOT NULL CHECK (btrim(task_id) <> ''),
    sort_order INTEGER NOT NULL CHECK (sort_order >= 0),
    title VARCHAR(500) NOT NULL CHECK (btrim(title) <> ''),
    outcome_id VARCHAR(160),
    estimate_minutes INTEGER NOT NULL CHECK (estimate_minutes BETWEEN 1 AND 10080),
    status VARCHAR(16) NOT NULL CHECK (status IN ('todo', 'in-progress', 'done', 'cancelled')),
    pinned BOOLEAN NOT NULL,
    carry_count INTEGER NOT NULL CHECK (carry_count >= 0),
    note VARCHAR(4000),
    PRIMARY KEY (user_id, task_id),
    UNIQUE (user_id, sort_order),
    FOREIGN KEY (user_id) REFERENCES planner_aggregate(user_id) ON DELETE CASCADE,
    FOREIGN KEY (user_id, outcome_id) REFERENCES planner_outcome(user_id, outcome_id)
);

CREATE TABLE planner_time_block (
    user_id UUID NOT NULL,
    block_id VARCHAR(160) NOT NULL CHECK (btrim(block_id) <> ''),
    sort_order INTEGER NOT NULL CHECK (sort_order >= 0),
    task_id VARCHAR(160),
    title VARCHAR(500) NOT NULL CHECK (btrim(title) <> ''),
    day_key VARCHAR(3) NOT NULL CHECK (day_key IN ('mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun')),
    start_minutes INTEGER NOT NULL CHECK (start_minutes BETWEEN 0 AND 1439),
    duration_minutes INTEGER NOT NULL CHECK (duration_minutes BETWEEN 1 AND 1440),
    external BOOLEAN NOT NULL DEFAULT FALSE,
    week_offset INTEGER NOT NULL DEFAULT 0 CHECK (week_offset BETWEEN -520 AND 520),
    PRIMARY KEY (user_id, block_id),
    UNIQUE (user_id, sort_order),
    CHECK (start_minutes + duration_minutes <= 1440),
    FOREIGN KEY (user_id) REFERENCES planner_aggregate(user_id) ON DELETE CASCADE,
    FOREIGN KEY (user_id, task_id) REFERENCES planner_task(user_id, task_id)
);

ALTER TABLE planner_time_block
    ADD CONSTRAINT planner_time_block_no_overlap
    EXCLUDE USING gist (
        user_id WITH =,
        week_offset WITH =,
        day_key WITH =,
        int4range(start_minutes, start_minutes + duration_minutes, '[)') WITH &&
    );

CREATE TABLE planner_time_entry (
    user_id UUID NOT NULL,
    entry_id VARCHAR(160) NOT NULL CHECK (btrim(entry_id) <> ''),
    sort_order INTEGER NOT NULL CHECK (sort_order >= 0),
    task_id VARCHAR(160) NOT NULL,
    duration_seconds BIGINT NOT NULL CHECK (duration_seconds > 0),
    source VARCHAR(16) NOT NULL CHECK (source IN ('timer', 'manual')),
    observed_at TIMESTAMPTZ NOT NULL,
    evidence VARCHAR(4000),
    PRIMARY KEY (user_id, entry_id),
    UNIQUE (user_id, sort_order),
    FOREIGN KEY (user_id) REFERENCES planner_aggregate(user_id) ON DELETE CASCADE,
    FOREIGN KEY (user_id, task_id) REFERENCES planner_task(user_id, task_id)
);

CREATE TABLE planner_timer (
    user_id UUID PRIMARY KEY,
    task_id VARCHAR(160) NOT NULL,
    started_at BIGINT CHECK (started_at >= 0),
    accumulated_seconds BIGINT NOT NULL CHECK (accumulated_seconds >= 0),
    paused BOOLEAN NOT NULL,
    FOREIGN KEY (user_id) REFERENCES planner_aggregate(user_id) ON DELETE CASCADE,
    FOREIGN KEY (user_id, task_id) REFERENCES planner_task(user_id, task_id)
);

CREATE TABLE planner_review_top_task (
    user_id UUID NOT NULL,
    position SMALLINT NOT NULL CHECK (position BETWEEN 0 AND 2),
    task_id VARCHAR(160) NOT NULL,
    PRIMARY KEY (user_id, position),
    UNIQUE (user_id, task_id),
    FOREIGN KEY (user_id) REFERENCES planner_aggregate(user_id) ON DELETE CASCADE,
    FOREIGN KEY (user_id, task_id) REFERENCES planner_task(user_id, task_id)
);

CREATE TABLE planner_idempotency (
    user_id UUID NOT NULL,
    operation VARCHAR(8) NOT NULL CHECK (operation IN ('PUT', 'DELETE')),
    idempotency_key VARCHAR(128) NOT NULL CHECK (btrim(idempotency_key) <> ''),
    request_hash CHAR(64) NOT NULL,
    response_status SMALLINT NOT NULL,
    result_revision BIGINT,
    response_body JSONB,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (user_id, operation, idempotency_key)
);

CREATE INDEX planner_idempotency_created_at_idx ON planner_idempotency(created_at);
CREATE INDEX planner_task_outcome_idx ON planner_task(user_id, outcome_id);
CREATE INDEX planner_time_entry_observed_idx ON planner_time_entry(user_id, observed_at DESC);
