-- One active key per wallet.
--
-- Identity is the Telegram account: buyers.tg_id UNIQUE -> one user -> one wallet.
-- Before this, every purchase minted another key on the same wallet, so "which key
-- is mine" had several answers and the credential surface grew for no benefit.
--
-- 1) consolidate: keep the most recently used (then newest) active key per user
-- 2) enforce it: partial unique index, so a race cannot create a second one

UPDATE api_keys k
   SET revoked_at = now(), status = 'revoked'
 WHERE k.revoked_at IS NULL
   AND k.status = 'active'
   AND k.id <> (
        SELECT x.id FROM api_keys x
         WHERE x.user_id = k.user_id
           AND x.revoked_at IS NULL
           AND x.status = 'active'
         ORDER BY x.last_used_at DESC NULLS LAST, x.created_at DESC
         LIMIT 1
   );

CREATE UNIQUE INDEX IF NOT EXISTS api_keys_one_active_per_user
    ON api_keys(user_id)
 WHERE revoked_at IS NULL AND status = 'active';
