-- TOTP 2FA for dashboard logins — additive, safe to re-run.
ALTER TABLE users ADD COLUMN IF NOT EXISTS totp_secret        text;
ALTER TABLE users ADD COLUMN IF NOT EXISTS totp_enabled       boolean NOT NULL DEFAULT false;
ALTER TABLE users ADD COLUMN IF NOT EXISTS totp_confirmed_at  timestamptz;
-- last accepted counter: blocks replay of a code inside its 90 s window
ALTER TABLE users ADD COLUMN IF NOT EXISTS totp_last_step     bigint;

CREATE INDEX IF NOT EXISTS users_totp_enabled_idx ON users(totp_enabled) WHERE totp_enabled;
