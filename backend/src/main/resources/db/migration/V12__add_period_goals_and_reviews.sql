-- Account-level documents deliberately do not reference the active planner aggregate.
CREATE TABLE period_document (
    user_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    document_id VARCHAR(80) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    revision BIGINT NOT NULL,
    body JSON NOT NULL,
    deleted BOOLEAN NOT NULL DEFAULT FALSE,
    updated_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
    PRIMARY KEY (user_id, document_id),
    CONSTRAINT period_document_user_fk FOREIGN KEY (user_id) REFERENCES app_user(user_id) ON DELETE CASCADE
) ENGINE=InnoDB;

CREATE TABLE period_document_history (
    user_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    document_id VARCHAR(80) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    revision BIGINT NOT NULL,
    body JSON NOT NULL,
    mutation_id VARCHAR(128) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL,
    request_hash CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
    PRIMARY KEY (user_id, document_id, revision),
    UNIQUE KEY period_mutation_id (user_id, mutation_id),
    CONSTRAINT period_history_user_fk FOREIGN KEY (user_id) REFERENCES app_user(user_id) ON DELETE CASCADE
) ENGINE=InnoDB;

ALTER TABLE planner_task ADD COLUMN completed_at DATETIME(6) NULL;
