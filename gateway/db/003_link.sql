-- Telegram account linking for the web portal.
-- Buyers never get a password: the web shows a one-time code, the bot confirms it, the web polls.

CREATE TABLE IF NOT EXISTS link_codes (
    code         text PRIMARY KEY,
    tg_id        bigint,
    username     text,
    name         text,
    status       text NOT NULL DEFAULT 'pending',  -- pending | confirmed | expired
    created_at   timestamptz NOT NULL DEFAULT now(),
    expires_at   timestamptz NOT NULL,
    confirmed_at timestamptz
);

CREATE INDEX IF NOT EXISTS link_codes_expires_idx ON link_codes (expires_at);
CREATE INDEX IF NOT EXISTS link_codes_tg_idx ON link_codes (tg_id);
