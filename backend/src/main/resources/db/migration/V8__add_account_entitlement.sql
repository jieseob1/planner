CREATE TABLE account_entitlement (
    user_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    plan_code VARCHAR(32) NOT NULL DEFAULT 'BETA',
    status_code VARCHAR(32) NOT NULL DEFAULT 'ACTIVE',
    provider_code VARCHAR(32) NULL,
    provider_customer_id VARCHAR(191) NULL,
    provider_subscription_id VARCHAR(191) NULL,
    current_period_ends_at TIMESTAMP(6) NULL,
    cancel_at_period_end BOOLEAN NOT NULL DEFAULT FALSE,
    created_at TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
    updated_at TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
    PRIMARY KEY (user_id),
    UNIQUE KEY uk_account_entitlement_provider_subscription (provider_code, provider_subscription_id),
    CONSTRAINT fk_account_entitlement_user
        FOREIGN KEY (user_id) REFERENCES app_user(user_id) ON DELETE CASCADE,
    CONSTRAINT chk_account_entitlement_plan
        CHECK (plan_code IN ('BETA', 'PRO')),
    CONSTRAINT chk_account_entitlement_status
        CHECK (status_code IN ('ACTIVE', 'TRIALING', 'PAST_DUE', 'CANCELED', 'EXPIRED'))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_as_ci;

INSERT INTO account_entitlement (user_id, plan_code, status_code)
SELECT user_id, 'BETA', 'ACTIVE'
FROM app_user
WHERE deleted_at IS NULL;
