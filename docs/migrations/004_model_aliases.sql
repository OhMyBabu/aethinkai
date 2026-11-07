-- The Aethink catalogue speaks its own slugs (`claude-fable-5`); the local 9Router
-- speaks `provider:model` (`github:claude-fable-5`, `neuralwatt:kimi-k3`). One row
-- per catalogue entry records which local route actually serves it. NULL = the
-- local router has no provider credentials for it yet (a customer call then fails
-- with upstream_unavailable instead of silently reaching for any other host).
CREATE TABLE IF NOT EXISTS model_aliases (
    model_id        text PRIMARY KEY,
    upstream_model  text NOT NULL,
    note            text,
    updated_at      timestamptz NOT NULL DEFAULT now()
);
