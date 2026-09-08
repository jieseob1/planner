-- Only new preference rows use this default. Existing explicit choices are preserved.
ALTER TABLE user_preference ALTER COLUMN block_reminder_minutes SET DEFAULT 15;
