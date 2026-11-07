-- One sellable name = one product. The same model reached through five providers is
-- five *routes*, never five catalogue rows: the buyer buys a name, not a host.
CREATE UNIQUE INDEX IF NOT EXISTS model_prices_public_id_key
    ON model_prices(public_id) WHERE public_id IS NOT NULL;
