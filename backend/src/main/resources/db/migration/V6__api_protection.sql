CREATE TABLE api_rate_limit (
    rate_key VARCHAR(96) PRIMARY KEY,
    window_started_at TIMESTAMPTZ NOT NULL,
    request_count INTEGER NOT NULL CHECK (request_count > 0),
    expires_at TIMESTAMPTZ NOT NULL
);

CREATE INDEX idx_api_rate_limit_expiry ON api_rate_limit (expires_at);
