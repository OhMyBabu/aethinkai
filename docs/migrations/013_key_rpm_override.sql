-- 013_key_rpm_override.sql — admin-set RPM survives purchases
--
-- Packages are flat 60 rpm, but an admin can raise (or lower) one user's limit by hand.
-- Without a flag, the next package purchase would overwrite that decision (the grant
-- path raises rpm to the package value). `rpm_override` marks the key as hand-tuned:
-- the grant path then leaves it alone.

ALTER TABLE api_keys ADD COLUMN IF NOT EXISTS rpm_override boolean NOT NULL DEFAULT false;
