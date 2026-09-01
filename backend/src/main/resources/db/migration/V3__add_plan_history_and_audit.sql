CREATE TABLE planner_plan (
    plan_id UUID PRIMARY KEY,
    user_id UUID NOT NULL REFERENCES app_user(user_id) ON DELETE CASCADE,
    title VARCHAR(200) NOT NULL CHECK (btrim(title) <> ''),
    plan_year INTEGER NOT NULL CHECK (plan_year BETWEEN 1900 AND 9999),
    plan_quarter SMALLINT NOT NULL CHECK (plan_quarter BETWEEN 1 AND 4),
    status VARCHAR(16) NOT NULL CHECK (status IN ('DRAFT', 'ACTIVE', 'CLOSED', 'ARCHIVED')),
    snapshot JSONB,
    source_revision BIGINT CHECK (source_revision IS NULL OR source_revision > 0),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    activated_at TIMESTAMPTZ,
    closed_at TIMESTAMPTZ,
    archived_at TIMESTAMPTZ
);

CREATE UNIQUE INDEX planner_plan_one_active_per_user_idx
    ON planner_plan(user_id)
    WHERE status = 'ACTIVE';

CREATE INDEX planner_plan_user_status_updated_idx
    ON planner_plan(user_id, status, updated_at DESC);

CREATE TABLE planner_audit_event (
    event_id UUID PRIMARY KEY,
    user_id UUID NOT NULL REFERENCES app_user(user_id) ON DELETE CASCADE,
    plan_id UUID REFERENCES planner_plan(plan_id) ON DELETE SET NULL,
    action VARCHAR(64) NOT NULL CHECK (btrim(action) <> ''),
    revision BIGINT,
    details JSONB NOT NULL DEFAULT '{}'::jsonb,
    occurred_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX planner_audit_event_user_plan_time_idx
    ON planner_audit_event(user_id, plan_id, occurred_at DESC);

INSERT INTO planner_plan (
    plan_id, user_id, title, plan_year, plan_quarter, status, source_revision,
    created_at, updated_at, activated_at
)
SELECT
    md5(aggregate.user_id::text || ':active-plan')::uuid,
    aggregate.user_id,
    aggregate.plan_year::text || '년 ' || aggregate.plan_quarter::text || '분기',
    aggregate.plan_year,
    aggregate.plan_quarter,
    'ACTIVE',
    aggregate.revision,
    aggregate.created_at,
    aggregate.updated_at,
    aggregate.created_at
FROM planner_aggregate aggregate
ON CONFLICT (plan_id) DO NOTHING;

ALTER TABLE planner_aggregate ADD COLUMN plan_id UUID;

UPDATE planner_aggregate
SET plan_id = md5(user_id::text || ':active-plan')::uuid
WHERE plan_id IS NULL;

ALTER TABLE planner_aggregate
    ALTER COLUMN plan_id SET NOT NULL,
    ADD CONSTRAINT planner_aggregate_plan_fk
        FOREIGN KEY (plan_id) REFERENCES planner_plan(plan_id);

CREATE UNIQUE INDEX planner_aggregate_plan_idx ON planner_aggregate(plan_id);
