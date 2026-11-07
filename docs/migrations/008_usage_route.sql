-- Which upstream route actually answered. `served_model` is what the router echoed
-- back (often the requested name); `route` is the host we chose, which is what tells
-- an operator whether the primary or a fallback is doing the work.
ALTER TABLE usage_events ADD COLUMN IF NOT EXISTS route text;
CREATE INDEX IF NOT EXISTS usage_events_route_idx ON usage_events(route, created_at DESC);
