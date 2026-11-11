-- One open order and one live QR per buyer.
CREATE INDEX IF NOT EXISTS orders_buyer_pending_idx
  ON orders(buyer_id, created_at DESC) WHERE status = 'pending';

CREATE INDEX IF NOT EXISTS payment_intents_live_idx
  ON payment_intents(status, expires_at) WHERE status = 'pending';
