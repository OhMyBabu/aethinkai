-- Three states, because "hidden" and "broken" are not the same thing:
--   on           visible in the buyer catalogue and callable
--   maintenance  visible in the catalogue, every call answers 503 (gangguan)
--   off          not advertised at all (buyer catalogue + landing disappear)
ALTER TABLE model_prices ADD COLUMN IF NOT EXISTS availability text NOT NULL DEFAULT 'on';
UPDATE model_prices SET availability = CASE WHEN active THEN 'on' ELSE 'off' END;
CREATE INDEX IF NOT EXISTS model_prices_availability_idx ON model_prices(availability);
