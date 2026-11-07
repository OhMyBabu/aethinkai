-- AethinkAI Gateway — schema v1
-- Money unit: integer micro-IDR (1 IDR = 1_000_000)

CREATE TABLE IF NOT EXISTS users (
    id            TEXT PRIMARY KEY,
    email         TEXT UNIQUE NOT NULL,
    password_hash TEXT NOT NULL,
    role          TEXT NOT NULL DEFAULT 'customer',   -- customer | admin
    plan          TEXT NOT NULL DEFAULT 'free',
    status        TEXT NOT NULL DEFAULT 'active',      -- active | suspended
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS api_keys (
    id           TEXT PRIMARY KEY,
    user_id      TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    prefix       TEXT UNIQUE NOT NULL,                 -- sk-aeth_ab12cd34
    hash         TEXT NOT NULL,                        -- sha256(secret)
    name         TEXT NOT NULL DEFAULT 'default',
    last_used_at TIMESTAMPTZ,
    revoked_at   TIMESTAMPTZ,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_keys_user ON api_keys(user_id);

CREATE TABLE IF NOT EXISTS balances (
    user_id       TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    balance_micro BIGINT NOT NULL DEFAULT 0 CHECK (balance_micro >= 0),
    updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS holds (
    id           TEXT PRIMARY KEY,
    user_id      TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    key_id       TEXT REFERENCES api_keys(id) ON DELETE SET NULL,
    amount_micro BIGINT NOT NULL,
    state        TEXT NOT NULL DEFAULT 'held',   -- held | settled | released | expired
    expires_at   TIMESTAMPTZ NOT NULL,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_holds_state ON holds(state, expires_at);

CREATE TABLE IF NOT EXISTS model_prices (
    model_id        TEXT PRIMARY KEY,               -- e.g. mk/deepseek-v4-flash-0731
    display_name    TEXT,
    price_in_idr    BIGINT NOT NULL DEFAULT 0,      -- per 1M input tokens
    price_out_idr   BIGINT NOT NULL DEFAULT 0,      -- per 1M output tokens
    price_cached_idr BIGINT NOT NULL DEFAULT 0,     -- per 1M cached input tokens
    active          BOOLEAN NOT NULL DEFAULT true,
    effective_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_by      TEXT,
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS cost_snapshots (
    model_id         TEXT NOT NULL,
    day              DATE NOT NULL,
    usd_in           NUMERIC(12,6) NOT NULL DEFAULT 0,
    usd_out          NUMERIC(12,6) NOT NULL DEFAULT 0,
    usd_cached       NUMERIC(12,6) NOT NULL DEFAULT 0,
    usd_idr          NUMERIC(14,4) NOT NULL,
    implied_in_idr   BIGINT NOT NULL DEFAULT 0,
    implied_out_idr  BIGINT NOT NULL DEFAULT 0,
    PRIMARY KEY (model_id, day)
);

CREATE TABLE IF NOT EXISTS fx_rates (
    usd_idr      NUMERIC(14,4) NOT NULL,
    effective_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS usage_events (
    id           TEXT PRIMARY KEY,
    request_id   TEXT NOT NULL,
    user_id      TEXT NOT NULL,
    key_id       TEXT,
    model_id     TEXT NOT NULL,
    served_model TEXT,
    tokens_in    INTEGER NOT NULL DEFAULT 0,
    tokens_out   INTEGER NOT NULL DEFAULT 0,
    tokens_cached INTEGER NOT NULL DEFAULT 0,
    price_in_idr  BIGINT NOT NULL DEFAULT 0,
    price_out_idr BIGINT NOT NULL DEFAULT 0,
    cost_micro   BIGINT NOT NULL DEFAULT 0,
    cost_usd     NUMERIC(14,8) NOT NULL DEFAULT 0,
    cost_delta_micro BIGINT NOT NULL DEFAULT 0,
    latency_ms   INTEGER NOT NULL DEFAULT 0,
    status       TEXT NOT NULL DEFAULT 'ok',   -- ok | upstream_error | aborted | rejected
    http_status  INTEGER,
    stream       BOOLEAN NOT NULL DEFAULT false,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_usage_user_day ON usage_events(user_id, created_at);
CREATE INDEX IF NOT EXISTS idx_usage_model_day ON usage_events(model_id, created_at);

CREATE TABLE IF NOT EXISTS ledger_entries (
    id            TEXT PRIMARY KEY,
    user_id       TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    kind          TEXT NOT NULL,   -- topup | charge | refund | adjust
    amount_micro  BIGINT NOT NULL, -- signed
    balance_after BIGINT NOT NULL,
    ref           TEXT,
    note          TEXT,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_ledger_user ON ledger_entries(user_id, created_at);

CREATE TABLE IF NOT EXISTS payment_intents (
    id           TEXT PRIMARY KEY,
    user_id      TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    provider     TEXT NOT NULL,            -- midtrans | xendit
    provider_ref TEXT UNIQUE,
    amount_idr   BIGINT NOT NULL,
    status       TEXT NOT NULL DEFAULT 'pending', -- pending | paid | expired | failed
    paid_at      TIMESTAMPTZ,
    raw          JSONB,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS audit_logs (
    id         BIGSERIAL PRIMARY KEY,
    actor      TEXT,
    action     TEXT NOT NULL,
    target     TEXT,
    meta       JSONB,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
