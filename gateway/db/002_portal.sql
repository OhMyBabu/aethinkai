-- AethinkAI portal: buyers, orders, key limits, auth hardening indexes.

CREATE TABLE IF NOT EXISTS buyers (
  id          text PRIMARY KEY,
  tg_id       bigint UNIQUE,
  username    text,
  name        text,
  status      text NOT NULL DEFAULT 'active',   -- active | suspended
  note        text,
  created_at  timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE api_keys ADD COLUMN IF NOT EXISTS buyer_id  text REFERENCES buyers(id) ON DELETE CASCADE;
ALTER TABLE api_keys ADD COLUMN IF NOT EXISTS rpm_limit integer NOT NULL DEFAULT 60;
ALTER TABLE api_keys ADD COLUMN IF NOT EXISTS status    text NOT NULL DEFAULT 'active'; -- active | suspended | revoked
ALTER TABLE api_keys ADD COLUMN IF NOT EXISTS label     text;

CREATE TABLE IF NOT EXISTS orders (
  id              text PRIMARY KEY,
  buyer_id        text REFERENCES buyers(id) ON DELETE SET NULL,
  sku             text NOT NULL,
  credits_micro   bigint NOT NULL DEFAULT 0,
  price_idr       bigint NOT NULL DEFAULT 0,
  payment_ref     text UNIQUE,
  status          text NOT NULL DEFAULT 'pending', -- pending | paid | granted | refunded
  key_id          text REFERENCES api_keys(id) ON DELETE SET NULL,
  telegram_msg_id bigint,
  created_at      timestamptz NOT NULL DEFAULT now(),
  granted_at      timestamptz
);

CREATE INDEX IF NOT EXISTS idx_keys_buyer       ON api_keys(buyer_id);
CREATE INDEX IF NOT EXISTS idx_keys_status      ON api_keys(status);
CREATE INDEX IF NOT EXISTS idx_orders_buyer     ON orders(buyer_id, created_at DESC);
CREATE INDEX IF NOT EXISTS usage_events_key_time ON usage_events(key_id, created_at DESC);
CREATE INDEX IF NOT EXISTS usage_events_time     ON usage_events(created_at DESC);

-- brute-force / abuse trail (kept short, admin can purge)
CREATE TABLE IF NOT EXISTS auth_failures (
  id    bigserial PRIMARY KEY,
  scope text NOT NULL,        -- portal_session | admin_login | internal_grant
  ident text,                 -- key prefix / email / tg id (never the secret)
  ip    text,
  at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_auth_failures_at ON auth_failures(at DESC);
