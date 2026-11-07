-- Context/output limits are provider facts, not marketing copy.
-- The local 9Router reports them per route in /v1/models (context_length,
-- max_completion_tokens, capabilities.contextWindow/maxOutput). We cache what it
-- reports so the shop, the admin panel and the request guard all quote the same
-- number instead of a hardcoded "1M".
ALTER TABLE model_prices ADD COLUMN IF NOT EXISTS context_window     integer;
ALTER TABLE model_prices ADD COLUMN IF NOT EXISTS max_output         integer;
ALTER TABLE model_prices ADD COLUMN IF NOT EXISTS capabilities       jsonb;
ALTER TABLE model_prices ADD COLUMN IF NOT EXISTS limits_synced_at   timestamptz;
