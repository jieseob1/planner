CREATE TABLE deleted_identity_tombstone (
    user_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    deleted_at DATETIME(6) NULL,
    PRIMARY KEY (user_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_as_ci;

-- Keep a non-PII coordination row for every existing deterministic user id.
-- The row survives account deletion and serializes future provisioning against it.
INSERT INTO deleted_identity_tombstone (user_id, deleted_at)
SELECT user_id, NULL
FROM app_user;
