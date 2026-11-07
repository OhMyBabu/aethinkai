-- 012_packages.sql — packages become data, not constants
--
-- Until now the three packages lived as a Python list: the admin page edited a
-- browser store, the bot cached /api/packages, and nothing could set RPM. Packages
-- are now rows the admin owns, and every surface reads the same rows.
--
-- RPM rule (the question that started this): RPM belongs to the *account*, and it is
-- the highest package the buyer has ever bought. Credits are pooled, so tying RPM to
-- "the last package bought" makes it jump up and down on every top-up. Custom top-ups
-- never change RPM.

CREATE TABLE IF NOT EXISTS packages (
    sku           text PRIMARY KEY,
    name          text NOT NULL,
    blurb         text,
    price_idr     bigint NOT NULL CHECK (price_idr > 0),
    credits_micro bigint NOT NULL CHECK (credits_micro > 0),
    rpm_limit     integer NOT NULL CHECK (rpm_limit >= 1),
    kind          text NOT NULL DEFAULT 'plan' CHECK (kind IN ('plan', 'topup')),
    active        boolean NOT NULL DEFAULT true,
    sort          integer NOT NULL DEFAULT 100,
    created_at    timestamptz NOT NULL DEFAULT now(),
    updated_at    timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS packages_active_idx ON packages (active, sort, price_idr);

-- custom top-up policy lives here so the shop has one source of truth
CREATE TABLE IF NOT EXISTS topup_policy (
    id          integer PRIMARY KEY DEFAULT 1 CHECK (id = 1),
    min_idr     bigint NOT NULL DEFAULT 2000 CHECK (min_idr >= 2000),
    max_idr     bigint NOT NULL DEFAULT 5000000,
    enabled     boolean NOT NULL DEFAULT true,
    updated_at  timestamptz NOT NULL DEFAULT now()
);
INSERT INTO topup_policy (id) VALUES (1) ON CONFLICT (id) DO NOTHING;

-- defaults are price == credit allowance; admin can break the link per package
INSERT INTO packages (sku, name, blurb, price_idr, credits_micro, rpm_limit, kind, sort)
VALUES
    ('starter', 'Starter', 'cocok buat coba-coba & bot pribadi', 5000, 5000000000, 60, 'plan', 10),
    ('pro',     'Pro',     'buat produk kecil & automation harian', 25000, 25000000000, 180, 'plan', 20),
    ('max',     'Max',     'traffic tinggi, parallel request', 100000, 100000000000, 600, 'plan', 30)
ON CONFLICT (sku) DO NOTHING;

-- what RPM an account has earned; api_keys.rpm_limit mirrors it for enforcement
ALTER TABLE buyers ADD COLUMN IF NOT EXISTS plan_rpm integer NOT NULL DEFAULT 30;
