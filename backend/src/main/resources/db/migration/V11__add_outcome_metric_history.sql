ALTER TABLE planner_outcome
    ADD COLUMN metric_updated_at DATETIME(6) NULL AFTER last_updated_days,
    ADD COLUMN next_check_date DATE NULL AFTER metric_updated_at;

CREATE TABLE planner_outcome_metric_history (
    user_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    outcome_id VARCHAR(160) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL,
    history_id VARCHAR(160) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL CHECK (TRIM(history_id) <> ''),
    sort_order INTEGER NOT NULL CHECK (sort_order >= 0),
    metric_value DECIMAL(20, 6) NULL CHECK (metric_value >= 0),
    observed_at DATETIME(6) NOT NULL,
    evidence VARCHAR(500) NOT NULL CHECK (TRIM(evidence) <> ''),
    PRIMARY KEY (user_id, outcome_id, history_id),
    UNIQUE KEY planner_outcome_metric_history_sort_uq (user_id, outcome_id, sort_order),
    KEY planner_outcome_metric_history_observed_idx (user_id, outcome_id, observed_at DESC),
    CONSTRAINT planner_outcome_metric_history_outcome_fk
        FOREIGN KEY (user_id, outcome_id)
        REFERENCES planner_outcome(user_id, outcome_id)
        ON DELETE CASCADE
) ENGINE=InnoDB;
