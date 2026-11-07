"""Postgres access layer (asyncpg)."""

import json
import uuid
from datetime import datetime, timezone
from typing import Any, Optional

import asyncpg

from .config import DATABASE_URL

_pool: Optional[asyncpg.Pool] = None


async def init_pool() -> asyncpg.Pool:
    global _pool
    if _pool is None:
        _pool = await asyncpg.create_pool(DATABASE_URL, min_size=1, max_size=8)
    return _pool


async def close_pool() -> None:
    global _pool
    if _pool is not None:
        await _pool.close()
        _pool = None


def pool() -> asyncpg.Pool:
    if _pool is None:
        raise RuntimeError("db pool not initialised")
    return _pool


def now() -> datetime:
    return datetime.now(timezone.utc)


def new_id() -> str:
    return str(uuid.uuid4())


async def find_key(raw_key: str) -> Optional[dict[str, Any]]:
    """Resolve an sk-aeth_/sk-bansos_ key to its api_keys row + owner.

    Rejects revoked keys, suspended keys and suspended owners. The hash compare is constant-time.
    """
    import hashlib
    import hmac

    prefix = raw_key[:16]
    row = await pool().fetchrow(
        """
        SELECT k.id, k.user_id, k.hash, k.revoked_at, k.status AS key_status,
               k.rpm_limit, k.buyer_id, k.prefix, k.label,
               u.status AS owner_status, u.role, u.email
        FROM api_keys k JOIN users u ON u.id = k.user_id
        WHERE k.prefix = $1
        """,
        prefix,
    )
    if row is None or row["revoked_at"] is not None:
        return None
    if row["key_status"] not in (None, "active") or row["owner_status"] != "active":
        return None
    digest = hashlib.sha256(raw_key.encode()).hexdigest()
    if not hmac.compare_digest(digest, row["hash"]):
        return None
    return dict(row)


async def touch_key(key_id: str) -> None:
    await pool().execute("UPDATE api_keys SET last_used_at = now() WHERE id = $1", key_id)


async def balance_micro(user_id: str) -> int:
    val = await pool().fetchval("SELECT balance_micro FROM balances WHERE user_id = $1", user_id)
    return int(val or 0)


async def get_prices(model_id: str) -> dict[str, Any]:
    row = await pool().fetchrow(
        "SELECT price_in_idr, price_out_idr, price_cached_idr FROM model_prices WHERE model_id = $1 AND active",
        model_id,
    )
    if row is None:
        return {"price_in_idr": 0, "price_out_idr": 0, "price_cached_idr": 0}
    return dict(row)


async def resolve_model(alias: str) -> dict[str, Any] | None:
    """Resolve a customer-facing model name to its upstream route.

    Customers call the Aethink slug (`claude-fable-5`); the upstream route
    (`mk/claude-fable-5`) never leaves the gateway.
    """
    row = await pool().fetchrow(
        """
        SELECT mp.model_id, mp.public_id, mp.display_name,
               mp.price_in_idr, mp.price_out_idr, mp.price_cached_idr,
               mp.context_window, mp.max_output, mp.fallback_enabled,
               ma.upstream_model AS local_model
        FROM model_prices mp
        LEFT JOIN model_aliases ma ON ma.model_id = mp.model_id
        WHERE (mp.public_id = $1 OR (mp.public_id IS NULL AND mp.model_id = $1)) AND mp.active
        ORDER BY (mp.public_id = $1) DESC
        LIMIT 1
        """,
        alias,
    )
    return dict(row) if row else None


async def routes_for(model_id: str) -> list[dict[str, Any]]:
    """Ordered provider routes for a catalogue model (admin-managed chain)."""
    rows = await pool().fetch(
        """SELECT id, upstream_model, provider_label, priority
             FROM model_routes
            WHERE model_id = $1 AND active
            ORDER BY priority, created_at""",
        model_id,
    )
    return [dict(r) for r in rows]


async def create_hold(user_id: str, key_id: str, amount_micro: int, ttl_seconds: int) -> str | None:
    """Debit the wallet and park the money in a hold.

    Returns None when the wallet cannot cover the hold — the caller answers 402.
    The debit is guarded in SQL (`balance_micro >= amount`) instead of relying on
    the `balances_balance_micro_check` constraint: two parallel requests both pass
    an application-level balance check, and the loser used to raise a
    CheckViolation (HTTP 500) *after* the model had already been called.
    """
    amount_micro = int(amount_micro)
    if amount_micro < 0:
        raise ValueError(f"negative hold amount: {amount_micro}")
    hold_id = new_id()
    async with pool().acquire() as conn:
        async with conn.transaction():
            debited = await conn.fetchval(
                """
                UPDATE balances SET balance_micro = balance_micro - $2, updated_at = now()
                WHERE user_id = $1 AND balance_micro >= $2
                RETURNING balance_micro
                """,
                user_id,
                amount_micro,
            )
            if debited is None:
                return None
            await conn.execute(
                """
                INSERT INTO holds(id, user_id, key_id, amount_micro, state, expires_at)
                VALUES ($1, $2, $3, $4, 'held', now() + ($5 || ' seconds')::interval)
                """,
                hold_id,
                user_id,
                key_id,
                amount_micro,
                str(ttl_seconds),
            )
    return hold_id


async def settle_hold(hold_id: str, user_id: str, charged_micro: int, ref: str, note: str = "") -> int:
    """Release the hold and charge the real amount. Returns the new balance.

    The real cost can exceed the estimate that was held (long completion, cache miss).
    Charging it blindly pushed the wallet negative and the DB check turned a served
    request into a 500. So the charge is clamped to what the wallet can actually
    cover; the shortfall is recorded on the ledger note (`underpaid=N`) instead of
    being silently swallowed or billed into the void.
    """
    async with pool().acquire() as conn:
        async with conn.transaction():
            row = await conn.fetchrow("SELECT amount_micro FROM holds WHERE id = $1 FOR UPDATE", hold_id)
            held = int(row["amount_micro"]) if row else 0
            balance = await conn.fetchval(
                "SELECT balance_micro FROM balances WHERE user_id = $1", user_id
            )
            available = int(balance or 0) + held        # hold already left the wallet
            if charged_micro > available:
                note = f"{note} underpaid={charged_micro - available}".strip()
                charged_micro = max(0, available)
            refund = held - charged_micro
            await conn.execute(
                "UPDATE holds SET state = 'settled' WHERE id = $1", hold_id
            )
            new_balance = await conn.fetchval(
                """
                UPDATE balances SET balance_micro = balance_micro + $2, updated_at = now()
                WHERE user_id = $1 RETURNING balance_micro
                """,
                user_id,
                refund,
            )
            await conn.execute(
                """
                INSERT INTO ledger_entries(id, user_id, kind, amount_micro, balance_after, ref, note)
                VALUES ($1, $2, 'charge', $3, $4, $5, $6)
                """,
                new_id(),
                user_id,
                -charged_micro,
                new_balance,
                ref,
                note,
            )
    return int(new_balance)


async def release_hold(hold_id: str, user_id: str) -> None:
    """Give a hold back after a failed request — and say so in the ledger.

    Refunding the wallet without a ledger row breaks Σbalance == Σledger, which is
    the one invariant the operator uses to trust the books.
    """
    async with pool().acquire() as conn:
        async with conn.transaction():
            row = await conn.fetchrow(
                "SELECT amount_micro FROM holds WHERE id = $1 AND state = 'held' FOR UPDATE", hold_id
            )
            if row is None:
                return
            await conn.execute("UPDATE holds SET state = 'released' WHERE id = $1", hold_id)
            balance = await conn.fetchval(
                "UPDATE balances SET balance_micro = balance_micro + $2, updated_at = now() "
                "WHERE user_id = $1 RETURNING balance_micro",
                user_id,
                int(row["amount_micro"]),
            )
            await conn.execute(
                """INSERT INTO ledger_entries(id, user_id, kind, amount_micro, balance_after, ref, note)
                   VALUES ($1, $2, 'hold_release', $3, $4, $5, 'released hold')""",
                new_id(), user_id, int(row["amount_micro"]), balance, hold_id,
            )


async def record_usage(ev: dict[str, Any]) -> None:
    await pool().execute(
        """
        INSERT INTO usage_events(
            id, request_id, user_id, key_id, model_id, served_model,
            tokens_in, tokens_out, tokens_cached,
            price_in_idr, price_out_idr, cost_micro, cost_usd, cost_delta_micro,
            latency_ms, status, http_status, stream, client_ip, client_ua, route
        ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21)
        """,
        ev["id"], ev["request_id"], ev["user_id"], ev.get("key_id"), ev["model_id"], ev.get("served_model"),
        ev.get("tokens_in", 0), ev.get("tokens_out", 0), ev.get("tokens_cached", 0),
        ev.get("price_in_idr", 0), ev.get("price_out_idr", 0), ev.get("cost_micro", 0),
        ev.get("cost_usd", 0), ev.get("cost_delta_micro", 0),
        ev.get("latency_ms", 0), ev.get("status", "ok"), ev.get("http_status"), ev.get("stream", False),
        ev.get("client_ip"), ev.get("client_ua"), ev.get("route"),
    )


async def log_audit(actor: str, action: str, target: str | None, meta: dict | None = None) -> None:
    await pool().execute(
        "INSERT INTO audit_logs(actor, action, target, meta) VALUES ($1,$2,$3,$4::jsonb)",
        actor, action, target, json.dumps(meta or {}),
    )


async def credit_user(
    user_id: str,
    amount_micro: int,
    kind: str = "topup",
    ref: str | None = None,
    note: str = "",
) -> int:
    """Move money into a wallet and write the matching ledger row atomically."""
    async with pool().acquire() as conn:
        async with conn.transaction():
            balance = await conn.fetchval(
                """
                INSERT INTO balances(user_id, balance_micro, updated_at)
                VALUES ($1, $2, now())
                ON CONFLICT (user_id) DO UPDATE
                   SET balance_micro = balances.balance_micro + $2, updated_at = now()
                RETURNING balance_micro
                """,
                user_id,
                amount_micro,
            )
            await conn.execute(
                """
                INSERT INTO ledger_entries(id, user_id, kind, amount_micro, balance_after, ref, note)
                VALUES ($1, $2, $3, $4, $5, $6, $7)
                """,
                new_id(), user_id, kind, amount_micro, balance, ref, note,
            )
    return int(balance)


async def list_ledger(user_id: str, limit: int = 100) -> list[dict[str, Any]]:
    rows = await pool().fetch(
        """
        SELECT id, kind, amount_micro, balance_after, ref, note, created_at
        FROM ledger_entries WHERE user_id = $1
        ORDER BY created_at DESC LIMIT $2
        """,
        user_id, limit,
    )
    return [dict(r) for r in rows]


async def expire_holds() -> int:
    """Return money for holds whose request never settled (crash, timeout, client abort)."""
    rows = await pool().fetch(
        """
        SELECT id, user_id, amount_micro FROM holds
        WHERE state = 'held' AND expires_at < now()
        FOR UPDATE SKIP LOCKED
        """
    )
    released = 0
    for row in rows:
        async with pool().acquire() as conn:
            async with conn.transaction():
                claimed = await conn.fetchval(
                    "UPDATE holds SET state = 'expired' WHERE id = $1 AND state = 'held' RETURNING id",
                    row["id"],
                )
                if not claimed:
                    continue
                balance = await conn.fetchval(
                    """
                    UPDATE balances SET balance_micro = balance_micro + $2, updated_at = now()
                    WHERE user_id = $1 RETURNING balance_micro
                    """,
                    row["user_id"], int(row["amount_micro"]),
                )
                await conn.execute(
                    """
                    INSERT INTO ledger_entries(id, user_id, kind, amount_micro, balance_after, ref, note)
                    VALUES ($1, $2, 'hold_release', $3, $4, $5, 'expired hold')
                    """,
                    new_id(), row["user_id"], int(row["amount_micro"]), balance, row["id"],
                )
                released += 1
    return released


async def balance_liability() -> dict[str, Any]:
    """Wallet liability vs ledger sum — the invariant that must always hold."""
    row = await pool().fetchrow(
        """
        SELECT
          (SELECT coalesce(sum(balance_micro), 0) FROM balances)                  AS wallets_micro,
          (SELECT coalesce(sum(amount_micro), 0) FROM ledger_entries)             AS ledger_micro,
          (SELECT count(*) FROM balances WHERE balance_micro < 0)                 AS negative_wallets
        """
    )
    return dict(row)
