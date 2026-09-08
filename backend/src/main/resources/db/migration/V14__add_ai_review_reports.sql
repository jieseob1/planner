CREATE TABLE ai_review_setting (
 user_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin PRIMARY KEY,
 consent BOOLEAN NOT NULL DEFAULT FALSE,
 include_reflections BOOLEAN NOT NULL DEFAULT FALSE,
 weekly_enabled BOOLEAN NOT NULL DEFAULT FALSE,
 monthly_enabled BOOLEAN NOT NULL DEFAULT FALSE,
 scheduled_time TIME NOT NULL DEFAULT '08:00:00',
 consent_version VARCHAR(30) NOT NULL DEFAULT '2026-09-08',
 updated_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
 FOREIGN KEY (user_id) REFERENCES app_user(user_id) ON DELETE CASCADE
) ENGINE=InnoDB;

-- Survives account deletion: aggregate financial reservation only, no personal data.
CREATE TABLE ai_review_budget_month (
 budget_month CHAR(7) CHARACTER SET ascii COLLATE ascii_bin PRIMARY KEY,
 reserved_usd DECIMAL(18,8) NOT NULL DEFAULT 0
) ENGINE=InnoDB;

CREATE TABLE ai_review_report (
 report_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin PRIMARY KEY,
 user_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
 request_id VARCHAR(100) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
 period VARCHAR(10) NOT NULL,
 start_date DATE NOT NULL,
 end_date DATE NOT NULL,
 version INT NOT NULL,
 status VARCHAR(16) NOT NULL DEFAULT 'QUEUED',
 input_snapshot JSON NOT NULL,
 input_hash CHAR(64) NOT NULL,
 prompt_version VARCHAR(40) NOT NULL,
 model VARCHAR(100) NOT NULL,
 budget_month CHAR(7) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
 reserved_usd DECIMAL(18,8) NOT NULL,
 input_price_per_million DECIMAL(18,8) NOT NULL,
 output_price_per_million DECIMAL(18,8) NOT NULL,
 max_output_tokens INT NOT NULL,
 report_body JSON,
 input_tokens BIGINT,
 output_tokens BIGINT,
 cost_usd DECIMAL(18,8),
 error_code VARCHAR(80),
 created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
 started_at DATETIME(6),
 provider_started_at DATETIME(6),
 completed_at DATETIME(6),
 UNIQUE KEY ai_review_request_uq(user_id, request_id),
 UNIQUE KEY ai_review_version_uq(user_id, period, start_date, version),
 KEY ai_review_claim_idx(status, created_at),
 KEY ai_review_account_month_idx(user_id, budget_month),
 FOREIGN KEY (user_id) REFERENCES app_user(user_id) ON DELETE CASCADE,
 FOREIGN KEY (budget_month) REFERENCES ai_review_budget_month(budget_month),
 CHECK (period IN ('week','month')),
 CHECK (status IN ('QUEUED','RUNNING','READY','FAILED','UNKNOWN','CANCELLED'))
) ENGINE=InnoDB;
