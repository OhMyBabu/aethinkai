-- Payment (WijayaPay QRIS) — additive, safe to re-run.
ALTER TABLE orders            ADD COLUMN IF NOT EXISTS rpm_limit      integer NOT NULL DEFAULT 60;
ALTER TABLE orders            ADD COLUMN IF NOT EXISTS checkout_token text;
ALTER TABLE orders            ADD COLUMN IF NOT EXISTS expired_at     timestamptz;
ALTER TABLE payment_intents   ADD COLUMN IF NOT EXISTS expires_at     timestamptz;
ALTER TABLE payment_intents   ADD COLUMN IF NOT EXISTS trx_reference  text;
ALTER TABLE payment_intents   ADD COLUMN IF NOT EXISTS order_id       text;

CREATE UNIQUE INDEX IF NOT EXISTS orders_checkout_token_idx    ON orders(checkout_token) WHERE checkout_token IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS payment_intents_ref_idx      ON payment_intents(provider, provider_ref) WHERE provider_ref IS NOT NULL;
CREATE INDEX        IF NOT EXISTS payment_intents_status_idx   ON payment_intents(status, created_at DESC);
CREATE INDEX        IF NOT EXISTS payment_intents_order_idx    ON payment_intents(order_id);

-- orders.status gains 'expired' (no rewrite needed, text column)
COMMENT ON COLUMN orders.status IS 'pending | granted | expired | cancelled';
