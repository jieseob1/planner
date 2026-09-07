CREATE TABLE planner_subtask (
    user_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    task_id VARCHAR(160) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL,
    subtask_id VARCHAR(160) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL CHECK (TRIM(subtask_id) <> ''),
    title VARCHAR(500) NOT NULL CHECK (TRIM(title) <> ''),
    done BOOLEAN NOT NULL DEFAULT FALSE,
    sort_order INT NOT NULL CHECK (sort_order >= 0),
    PRIMARY KEY (user_id, task_id, subtask_id),
    UNIQUE KEY planner_subtask_sort_uq (user_id, task_id, sort_order),
    CONSTRAINT planner_subtask_task_fk FOREIGN KEY (user_id, task_id)
        REFERENCES planner_task(user_id, task_id) ON DELETE CASCADE
);
