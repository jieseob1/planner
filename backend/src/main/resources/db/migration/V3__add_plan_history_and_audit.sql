CREATE TABLE planner_plan (
    plan_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin PRIMARY KEY,
    user_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    title VARCHAR(200) NOT NULL CHECK (TRIM(title) <> ''),
    plan_year INTEGER NOT NULL CHECK (plan_year BETWEEN 1900 AND 9999),
    plan_quarter SMALLINT NOT NULL CHECK (plan_quarter BETWEEN 1 AND 4),
    status VARCHAR(16) CHARACTER SET ascii COLLATE ascii_bin NOT NULL CHECK (status IN ('DRAFT', 'ACTIVE', 'CLOSED', 'ARCHIVED')),
    active_slot TINYINT
        GENERATED ALWAYS AS (CASE WHEN status = 'ACTIVE' THEN 1 ELSE NULL END) STORED,
    snapshot JSON,
    source_revision BIGINT CHECK (source_revision IS NULL OR source_revision > 0),
    created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
    updated_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
    activated_at DATETIME(6),
    closed_at DATETIME(6),
    archived_at DATETIME(6),
    UNIQUE KEY planner_plan_one_active_per_user_idx (user_id, active_slot),
    KEY planner_plan_user_status_updated_idx (user_id, status, updated_at DESC),
    CONSTRAINT planner_plan_user_fk FOREIGN KEY (user_id) REFERENCES app_user(user_id) ON DELETE CASCADE
) ENGINE=InnoDB;

CREATE TABLE planner_audit_event (
    event_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin PRIMARY KEY,
    user_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    plan_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin,
    action VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL CHECK (TRIM(action) <> ''),
    revision BIGINT,
    details JSON NOT NULL DEFAULT (JSON_OBJECT()),
    occurred_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
    KEY planner_audit_event_user_plan_time_idx (user_id, plan_id, occurred_at DESC),
    CONSTRAINT planner_audit_user_fk FOREIGN KEY (user_id) REFERENCES app_user(user_id) ON DELETE CASCADE,
    CONSTRAINT planner_audit_plan_fk FOREIGN KEY (plan_id) REFERENCES planner_plan(plan_id) ON DELETE SET NULL
) ENGINE=InnoDB;

INSERT IGNORE INTO planner_plan (
    plan_id, user_id, title, plan_year, plan_quarter, status, source_revision,
    created_at, updated_at, activated_at
)
SELECT
    LOWER(CONCAT(
        SUBSTRING(MD5(CONCAT(aggregate.user_id, ':active-plan')), 1, 8), '-',
        SUBSTRING(MD5(CONCAT(aggregate.user_id, ':active-plan')), 9, 4), '-',
        SUBSTRING(MD5(CONCAT(aggregate.user_id, ':active-plan')), 13, 4), '-',
        SUBSTRING(MD5(CONCAT(aggregate.user_id, ':active-plan')), 17, 4), '-',
        SUBSTRING(MD5(CONCAT(aggregate.user_id, ':active-plan')), 21, 12)
    )),
    aggregate.user_id,
    CONCAT(aggregate.plan_year, '년 ', aggregate.plan_quarter, '분기'),
    aggregate.plan_year,
    aggregate.plan_quarter,
    'ACTIVE',
    aggregate.revision,
    aggregate.created_at,
    aggregate.updated_at,
    aggregate.created_at
FROM planner_aggregate aggregate;

ALTER TABLE planner_aggregate
    ADD COLUMN plan_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin;

UPDATE planner_aggregate
SET plan_id = LOWER(CONCAT(
    SUBSTRING(MD5(CONCAT(user_id, ':active-plan')), 1, 8), '-',
    SUBSTRING(MD5(CONCAT(user_id, ':active-plan')), 9, 4), '-',
    SUBSTRING(MD5(CONCAT(user_id, ':active-plan')), 13, 4), '-',
    SUBSTRING(MD5(CONCAT(user_id, ':active-plan')), 17, 4), '-',
    SUBSTRING(MD5(CONCAT(user_id, ':active-plan')), 21, 12)
))
WHERE plan_id IS NULL;

ALTER TABLE planner_aggregate
    MODIFY plan_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    ADD CONSTRAINT planner_aggregate_plan_fk FOREIGN KEY (plan_id) REFERENCES planner_plan(plan_id) ON DELETE CASCADE,
    ADD UNIQUE KEY planner_aggregate_plan_idx (plan_id);
