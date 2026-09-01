ALTER TABLE app_user
    ADD COLUMN terms_accepted_at DATETIME(6),
    ADD COLUMN privacy_accepted_at DATETIME(6),
    ADD COLUMN policy_version VARCHAR(32);
