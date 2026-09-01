CREATE TABLE planner_revision_clock (
    user_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin PRIMARY KEY,
    last_revision BIGINT NOT NULL CHECK (last_revision > 0),
    updated_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6)
) ENGINE=InnoDB;

CREATE TABLE planner_aggregate (
    user_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin PRIMARY KEY,
    revision BIGINT NOT NULL CHECK (revision > 0),
    snapshot_version SMALLINT NOT NULL CHECK (snapshot_version = 1),
    planner_week_offset INTEGER NOT NULL CHECK (planner_week_offset BETWEEN -520 AND 520),
    plan_year INTEGER NOT NULL CHECK (plan_year BETWEEN 1900 AND 9999),
    annual_direction VARCHAR(2000) NOT NULL CHECK (TRIM(annual_direction) <> ''),
    plan_quarter SMALLINT NOT NULL CHECK (plan_quarter BETWEEN 1 AND 4),
    quarter_focus VARCHAR(2000) NOT NULL CHECK (TRIM(quarter_focus) <> ''),
    quarter_end_date DATE NOT NULL,
    review_blocker VARCHAR(2000),
    review_metric_draft VARCHAR(200) NOT NULL,
    review_completed_at DATETIME(6),
    created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
    updated_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6)
) ENGINE=InnoDB;

CREATE TABLE planner_outcome (
    user_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    outcome_id VARCHAR(160) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL CHECK (TRIM(outcome_id) <> ''),
    sort_order INTEGER NOT NULL CHECK (sort_order >= 0),
    title VARCHAR(500) NOT NULL CHECK (TRIM(title) <> ''),
    parent_title VARCHAR(500) NOT NULL CHECK (TRIM(parent_title) <> ''),
    current_value DECIMAL(20, 6),
    target_value DECIMAL(20, 6) NOT NULL CHECK (target_value > 0),
    unit VARCHAR(40) NOT NULL CHECK (TRIM(unit) <> ''),
    confidence VARCHAR(16) NOT NULL CHECK (confidence IN ('high', 'medium', 'low', 'unknown')),
    last_updated_days INTEGER CHECK (last_updated_days >= 0),
    actual_hours DECIMAL(20, 6) NOT NULL CHECK (actual_hours >= 0),
    needed_hours DECIMAL(20, 6) NOT NULL CHECK (needed_hours >= 0),
    available_hours DECIMAL(20, 6) NOT NULL CHECK (available_hours >= 0),
    evidence_label VARCHAR(500) NOT NULL CHECK (TRIM(evidence_label) <> ''),
    change_label VARCHAR(500) NOT NULL CHECK (TRIM(change_label) <> ''),
    attention VARCHAR(24) NOT NULL CHECK (attention IN ('none', 'stale', 'time-shortage', 'stalled', 'no-evidence')),
    decision VARCHAR(16) CHECK (decision IN ('keep', 'reduce', 'extend', 'stop')),
    PRIMARY KEY (user_id, outcome_id),
    UNIQUE KEY planner_outcome_sort_uq (user_id, sort_order),
    CONSTRAINT planner_outcome_aggregate_fk FOREIGN KEY (user_id) REFERENCES planner_aggregate(user_id) ON DELETE CASCADE
) ENGINE=InnoDB;

CREATE TABLE planner_task (
    user_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    task_id VARCHAR(160) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL CHECK (TRIM(task_id) <> ''),
    sort_order INTEGER NOT NULL CHECK (sort_order >= 0),
    title VARCHAR(500) NOT NULL CHECK (TRIM(title) <> ''),
    outcome_id VARCHAR(160) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin,
    estimate_minutes INTEGER NOT NULL CHECK (estimate_minutes BETWEEN 1 AND 10080),
    status VARCHAR(16) NOT NULL CHECK (status IN ('todo', 'in-progress', 'done', 'cancelled')),
    pinned BOOLEAN NOT NULL,
    carry_count INTEGER NOT NULL CHECK (carry_count >= 0),
    note VARCHAR(4000),
    PRIMARY KEY (user_id, task_id),
    UNIQUE KEY planner_task_sort_uq (user_id, sort_order),
    KEY planner_task_outcome_idx (user_id, outcome_id),
    CONSTRAINT planner_task_aggregate_fk FOREIGN KEY (user_id) REFERENCES planner_aggregate(user_id) ON DELETE CASCADE,
    CONSTRAINT planner_task_outcome_fk FOREIGN KEY (user_id, outcome_id) REFERENCES planner_outcome(user_id, outcome_id) ON DELETE CASCADE
) ENGINE=InnoDB;

CREATE TABLE planner_time_block (
    user_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    block_id VARCHAR(160) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL CHECK (TRIM(block_id) <> ''),
    sort_order INTEGER NOT NULL CHECK (sort_order >= 0),
    task_id VARCHAR(160) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin,
    title VARCHAR(500) NOT NULL CHECK (TRIM(title) <> ''),
    day_key VARCHAR(3) CHARACTER SET ascii COLLATE ascii_bin NOT NULL CHECK (day_key IN ('mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun')),
    start_minutes INTEGER NOT NULL CHECK (start_minutes BETWEEN 0 AND 1439),
    duration_minutes INTEGER NOT NULL CHECK (duration_minutes BETWEEN 1 AND 1440),
    external BOOLEAN NOT NULL DEFAULT FALSE,
    week_offset INTEGER NOT NULL DEFAULT 0 CHECK (week_offset BETWEEN -520 AND 520),
    PRIMARY KEY (user_id, block_id),
    UNIQUE KEY planner_time_block_sort_uq (user_id, sort_order),
    KEY planner_time_block_overlap_idx (user_id, week_offset, day_key, start_minutes),
    CONSTRAINT planner_time_block_aggregate_fk FOREIGN KEY (user_id) REFERENCES planner_aggregate(user_id) ON DELETE CASCADE,
    CONSTRAINT planner_time_block_task_fk FOREIGN KEY (user_id, task_id) REFERENCES planner_task(user_id, task_id) ON DELETE CASCADE,
    CHECK (start_minutes + duration_minutes <= 1440)
) ENGINE=InnoDB;

CREATE TABLE planner_time_entry (
    user_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    entry_id VARCHAR(160) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL CHECK (TRIM(entry_id) <> ''),
    sort_order INTEGER NOT NULL CHECK (sort_order >= 0),
    task_id VARCHAR(160) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL,
    duration_seconds BIGINT NOT NULL CHECK (duration_seconds > 0),
    source VARCHAR(16) NOT NULL CHECK (source IN ('timer', 'manual')),
    observed_at DATETIME(6) NOT NULL,
    evidence VARCHAR(4000),
    PRIMARY KEY (user_id, entry_id),
    UNIQUE KEY planner_time_entry_sort_uq (user_id, sort_order),
    KEY planner_time_entry_observed_idx (user_id, observed_at DESC),
    CONSTRAINT planner_time_entry_aggregate_fk FOREIGN KEY (user_id) REFERENCES planner_aggregate(user_id) ON DELETE CASCADE,
    CONSTRAINT planner_time_entry_task_fk FOREIGN KEY (user_id, task_id) REFERENCES planner_task(user_id, task_id) ON DELETE CASCADE
) ENGINE=InnoDB;

CREATE TABLE planner_timer (
    user_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin PRIMARY KEY,
    task_id VARCHAR(160) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL,
    started_at BIGINT CHECK (started_at >= 0),
    accumulated_seconds BIGINT NOT NULL CHECK (accumulated_seconds >= 0),
    paused BOOLEAN NOT NULL,
    CONSTRAINT planner_timer_aggregate_fk FOREIGN KEY (user_id) REFERENCES planner_aggregate(user_id) ON DELETE CASCADE,
    CONSTRAINT planner_timer_task_fk FOREIGN KEY (user_id, task_id) REFERENCES planner_task(user_id, task_id) ON DELETE CASCADE
) ENGINE=InnoDB;

CREATE TABLE planner_review_top_task (
    user_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    position SMALLINT NOT NULL CHECK (position BETWEEN 0 AND 2),
    task_id VARCHAR(160) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL,
    PRIMARY KEY (user_id, position),
    UNIQUE KEY planner_review_top_task_uq (user_id, task_id),
    CONSTRAINT planner_review_aggregate_fk FOREIGN KEY (user_id) REFERENCES planner_aggregate(user_id) ON DELETE CASCADE,
    CONSTRAINT planner_review_task_fk FOREIGN KEY (user_id, task_id) REFERENCES planner_task(user_id, task_id) ON DELETE CASCADE
) ENGINE=InnoDB;

CREATE TABLE planner_idempotency (
    user_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    operation VARCHAR(8) CHARACTER SET ascii COLLATE ascii_bin NOT NULL CHECK (operation IN ('PUT', 'DELETE')),
    idempotency_key VARCHAR(128) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL CHECK (TRIM(idempotency_key) <> ''),
    request_hash CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    response_status SMALLINT NOT NULL,
    result_revision BIGINT,
    response_body LONGTEXT,
    created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
    PRIMARY KEY (user_id, operation, idempotency_key),
    KEY planner_idempotency_created_at_idx (created_at)
) ENGINE=InnoDB;

DELIMITER $$

CREATE TRIGGER planner_time_block_overlap_insert
BEFORE INSERT ON planner_time_block
FOR EACH ROW
BEGIN
    IF NEW.external = FALSE AND EXISTS (
        SELECT 1 FROM planner_time_block existing
        WHERE existing.user_id = NEW.user_id
          AND existing.week_offset = NEW.week_offset
          AND existing.day_key = NEW.day_key
          AND existing.external = FALSE
          AND existing.start_minutes < NEW.start_minutes + NEW.duration_minutes
          AND NEW.start_minutes < existing.start_minutes + existing.duration_minutes
    ) THEN
        SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'planner time blocks overlap';
    END IF;
END$$

CREATE TRIGGER planner_time_block_overlap_update
BEFORE UPDATE ON planner_time_block
FOR EACH ROW
BEGIN
    IF NEW.external = FALSE AND EXISTS (
        SELECT 1 FROM planner_time_block existing
        WHERE existing.user_id = NEW.user_id
          AND existing.week_offset = NEW.week_offset
          AND existing.day_key = NEW.day_key
          AND existing.block_id <> NEW.block_id
          AND existing.external = FALSE
          AND existing.start_minutes < NEW.start_minutes + NEW.duration_minutes
          AND NEW.start_minutes < existing.start_minutes + existing.duration_minutes
    ) THEN
        SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'planner time blocks overlap';
    END IF;
END$$

DELIMITER ;
