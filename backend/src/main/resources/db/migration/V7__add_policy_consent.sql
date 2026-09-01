ALTER TABLE app_user
    ADD COLUMN terms_accepted_at TIMESTAMPTZ,
    ADD COLUMN privacy_accepted_at TIMESTAMPTZ,
    ADD COLUMN policy_version VARCHAR(32);
