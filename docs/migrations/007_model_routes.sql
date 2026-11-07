-- Provider routes per catalogue model.
--
-- A catalogue name (`deepseek-v4.1-flash-1017`) is a promise to the buyer; where it
-- is actually served must stay an operator decision. Each row is one upstream route
-- on the local 9Router (myrikko, river, any reseller), tried in priority order:
-- first active route wins, the rest are fallbacks, and the buyer never sees a change.
--
-- model_prices.fallback_enabled is the "centang fallback" switch: off = only the
-- primary route is tried; on = walk the whole chain before failing.

CREATE TABLE IF NOT EXISTS model_routes (
    id             text PRIMARY KEY,
    model_id       text NOT NULL REFERENCES model_prices(model_id) ON DELETE CASCADE,
    upstream_model text NOT NULL,
    provider_label text,
    priority       integer NOT NULL DEFAULT 10,
    active         boolean NOT NULL DEFAULT true,
    note           text,
    created_at     timestamptz NOT NULL DEFAULT now(),
    UNIQUE (model_id, upstream_model)
);

CREATE INDEX IF NOT EXISTS model_routes_lookup ON model_routes(model_id, priority) WHERE active;

ALTER TABLE model_prices ADD COLUMN IF NOT EXISTS fallback_enabled boolean NOT NULL DEFAULT true;

-- seed: whatever the sync script had already mapped becomes the primary route
INSERT INTO model_routes (id, model_id, upstream_model, provider_label, priority, active, note)
SELECT 'rt_' || md5(ma.model_id || ma.upstream_model), ma.model_id, ma.upstream_model,
       split_part(ma.upstream_model, '/', 1), 1, true, 'seed: model_aliases'
  FROM model_aliases ma
ON CONFLICT (model_id, upstream_model) DO NOTHING;
