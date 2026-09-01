CREATE TABLE api_rate_limit (
    rate_key VARCHAR(96) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin PRIMARY KEY,
    window_started_at DATETIME(6) NOT NULL,
    request_count INTEGER NOT NULL CHECK (request_count > 0),
    expires_at DATETIME(6) NOT NULL,
    KEY idx_api_rate_limit_expiry (expires_at)
) ENGINE=InnoDB;

CREATE TABLE maintenance_lock (
    lock_name VARCHAR(80) CHARACTER SET ascii COLLATE ascii_bin PRIMARY KEY,
    last_acquired_at DATETIME(6)
) ENGINE=InnoDB;

INSERT INTO maintenance_lock (lock_name) VALUES ('nowline-data-retention');
