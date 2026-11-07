-- Test traffic must never colour business numbers.
ALTER TABLE buyers ADD COLUMN IF NOT EXISTS is_test boolean NOT NULL DEFAULT false;
UPDATE buyers SET is_test = true WHERE username LIKE 'e2e\_%' OR username LIKE 'probe%';
