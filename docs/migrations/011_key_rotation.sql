-- 011_key_rotation.sql — web key rotation has to be proved by the Telegram account
--
-- The bot can rotate a key because the chat *is* the identity. A browser session is
-- only a token: rotating from the web therefore needs a code that only the linked
-- Telegram account can read.
--
-- One live request per buyer at a time; five minutes; five attempts; the plaintext
-- code is kept only for the lifetime of the row so support can resend it, and the
-- row is marked used before the new key is minted.

CREATE TABLE IF NOT EXISTS key_rotation_codes (
    id           text PRIMARY KEY,
    buyer_id     text NOT NULL,
    user_id      text,
    code         text NOT NULL,
    attempts     integer NOT NULL DEFAULT 0,
    used_at      timestamptz,
    expires_at   timestamptz NOT NULL,
    created_at   timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS key_rotation_codes_buyer_idx
    ON key_rotation_codes (buyer_id, created_at DESC);

-- a buyer never has two usable codes at once: the request step expires the old ones
CREATE INDEX IF NOT EXISTS key_rotation_codes_live_idx
    ON key_rotation_codes (buyer_id) WHERE used_at IS NULL;
