"""Admin API: model catalogue + pricing control."""

import math
from datetime import datetime, timezone
from typing import Any

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field

from . import auth, db, upstream
from .config import USD_IDR

router = APIRouter(prefix="/api/admin", tags=["admin"])

_BRANDS = [
    ("claude", "Anthropic"), ("anthropic", "Anthropic"),
    ("deepseek", "DeepSeek"), ("glm", "Zhipu"), ("zhipu", "Zhipu"),
    ("kimi", "Moonshot"), ("moonshot", "Moonshot"), ("qwen", "Alibaba"),
    ("gemini", "Google"), ("gemma", "Google"), ("mistral", "Mistral"),
    ("grok", "xAI"), ("gpt", "OpenAI"), ("o1", "OpenAI"), ("o3", "OpenAI"),
    ("minimax", "MiniMax"),
]


def _brand(model_id: str) -> str:
    low = (model_id or "").lower()
    for token, name in _BRANDS:
        if token in low:
            return name
    return "—"


class PriceIn(BaseModel):
    price_in_idr: int = Field(ge=0)
    price_out_idr: int = Field(ge=0)
    price_cached_idr: int = Field(default=0, ge=0)
    active: bool = True
    display_name: str | None = None
    provider_label: str | None = None
    public_id: str | None = None


class ImportIn(BaseModel):
    margin_pct: float = Field(default=35.0, ge=0, le=1000)
    only_missing: bool = True


@router.get("/models")
async def list_models(admin: dict = Depends(auth.require_admin)):
    """Union of upstream catalogue + local price rows, with 30d usage."""
    upstream_ids: list[str] = []
    try:
        data = await upstream.list_models()
        upstream_ids = [m["id"] for m in data.get("data", [])]
    except Exception:
        pass

    rows = await db.pool().fetch(
        """
        SELECT model_id, public_id, provider_label, display_name,
               price_in_idr, price_out_idr, price_cached_idr, active, updated_at
        FROM model_prices
        """
    )
    priced = {r["model_id"]: dict(r) for r in rows}

    usage = await db.pool().fetch(
        """
        SELECT model_id,
               count(*) AS requests,
               coalesce(sum(tokens_in),0) AS tokens_in,
               coalesce(sum(tokens_out),0) AS tokens_out,
               coalesce(sum(cost_micro),0) AS cost_micro
        FROM usage_events
        WHERE created_at > now() - interval '30 days'
        GROUP BY model_id
        """
    )
    usage_map = {r["model_id"]: dict(r) for r in usage}

    cost = await db.pool().fetch(
        """
        SELECT DISTINCT ON (model_id) model_id, usd_in, usd_out, usd_cached, usd_idr,
               implied_in_idr, implied_out_idr
        FROM cost_snapshots ORDER BY model_id, day DESC
        """
    )
    cost_map = {r["model_id"]: dict(r) for r in cost}

    ids = sorted(set(upstream_ids) | set(priced))
    out = []
    for mid in ids:
        p = priced.get(mid)
        u = usage_map.get(mid, {})
        c = cost_map.get(mid, {})
        item: dict[str, Any] = {
            "model_id": mid,
            "public_id": (p or {}).get("public_id") or mid.split("/")[-1],
            "provider_label": (p or {}).get("provider_label"),
            "display_name": (p or {}).get("display_name") or mid.split("/")[-1],
            "enabled": bool(p["active"]) if p else False,
            "priced": bool(p),
            "price_in_idr": p["price_in_idr"] if p else 0,
            "price_out_idr": p["price_out_idr"] if p else 0,
            "price_cached_idr": p["price_cached_idr"] if p else 0,
            "updated_at": p["updated_at"].isoformat() if p and p["updated_at"] else None,
            "requests_30d": int(u.get("requests") or 0),
            "tokens_in_30d": int(u.get("tokens_in") or 0),
            "tokens_out_30d": int(u.get("tokens_out") or 0),
            "revenue_micro_30d": int(u.get("cost_micro") or 0),
            "cost_usd_in": float(c["usd_in"]) if c else None,
            "cost_usd_out": float(c["usd_out"]) if c else None,
        }
        if c and p and p["price_in_idr"]:
            implied = float(c["implied_in_idr"])
            item["margin_in_pct"] = round((1 - implied / p["price_in_idr"]) * 100, 1) if p["price_in_idr"] else None
        out.append(item)

    return {"models": out, "count": len(out), "priced": len(priced)}


@router.put("/models/{model_id:path}")
async def upsert_price(model_id: str, body: PriceIn, admin: dict = Depends(auth.require_admin)):
    row = await db.pool().fetchrow(
        """
        INSERT INTO model_prices(model_id, public_id, provider_label, display_name,
                                 price_in_idr, price_out_idr, price_cached_idr,
                                 active, effective_at, updated_by, updated_at)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8, now(), $9, now())
        ON CONFLICT (model_id) DO UPDATE SET
            public_id = coalesce(EXCLUDED.public_id, model_prices.public_id),
            provider_label = coalesce(EXCLUDED.provider_label, model_prices.provider_label),
            display_name = coalesce(EXCLUDED.display_name, model_prices.display_name),
            price_in_idr = EXCLUDED.price_in_idr,
            price_out_idr = EXCLUDED.price_out_idr,
            price_cached_idr = EXCLUDED.price_cached_idr,
            active = EXCLUDED.active,
            effective_at = now(),
            updated_by = EXCLUDED.updated_by,
            updated_at = now()
        RETURNING model_id, public_id, provider_label, price_in_idr, price_out_idr,
                  price_cached_idr, active
        """,
        model_id, body.public_id, body.provider_label, body.display_name,
        body.price_in_idr, body.price_out_idr, body.price_cached_idr,
        body.active, admin["email"],
    )
    await db.log_audit(admin["email"], "price.upsert", model_id, body.model_dump())
    return {"model": dict(row)}


@router.post("/pricing/import")
async def import_pricing(body: ImportIn, admin: dict = Depends(auth.require_admin)):
    """Seed prices from the upstream USD price card at a fixed margin. Never overwrites manual prices."""
    import httpx

    try:
        async with httpx.AsyncClient(base_url="http://127.0.0.1:20128", timeout=30) as c:
            r = await c.get("/api/pricing", headers={"x-9r-peer-token": upstream.PEER_TOKEN, "x-9r-real-ip": "127.0.0.1"})
            r.raise_for_status()
            card = r.json()
    except Exception as e:
        raise HTTPException(502, {"error": {"message": f"Upstream price card unavailable: {e}", "code": "upstream_unavailable"}})

    created, skipped = 0, 0
    today = datetime.now(timezone.utc).date()
    for provider, models in card.items():
        if not isinstance(models, dict):
            continue
        for model, price in models.items():
            if not isinstance(price, dict):
                continue
            usd_in = float(price.get("input") or 0)
            usd_out = float(price.get("output") or 0)
            usd_cached = float(price.get("cached") or 0)
            implied_in = int(math.ceil(usd_in * USD_IDR))
            implied_out = int(math.ceil(usd_out * USD_IDR))
            model_id = f"{provider}/{model}"

            await db.pool().execute(
                """
                INSERT INTO cost_snapshots(model_id, day, usd_in, usd_out, usd_cached, usd_idr,
                                           implied_in_idr, implied_out_idr)
                VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
                ON CONFLICT (model_id, day) DO UPDATE SET
                    usd_in = EXCLUDED.usd_in, usd_out = EXCLUDED.usd_out, usd_cached = EXCLUDED.usd_cached,
                    usd_idr = EXCLUDED.usd_idr, implied_in_idr = EXCLUDED.implied_in_idr,
                    implied_out_idr = EXCLUDED.implied_out_idr
                """,
                model_id, today, usd_in, usd_out, usd_cached, USD_IDR, implied_in, implied_out,
            )

            exists = await db.pool().fetchval("SELECT 1 FROM model_prices WHERE model_id = $1", model_id)
            if exists:
                skipped += 1
                continue
            mult = 1 + body.margin_pct / 100
            await db.pool().execute(
                """
                INSERT INTO model_prices(model_id, display_name, price_in_idr, price_out_idr, price_cached_idr,
                                         active, updated_by)
                VALUES ($1,$2,$3,$4,$5,true,'import')
                """,
                model_id, model, int(math.ceil(implied_in * mult)), int(math.ceil(implied_out * mult)),
                int(math.ceil(int(math.ceil(usd_cached * USD_IDR)) * mult)),
            )
            created += 1

    await db.log_audit(admin["email"], "pricing.import", None, {"created": created, "skipped": skipped})
    return {"created": created, "skipped_existing": skipped, "margin_pct": body.margin_pct}


@router.get("/users")
async def list_users(admin: dict = Depends(auth.require_admin)):
    rows = await db.pool().fetch(
        """
        SELECT u.id, u.email, u.role, u.plan, u.status, u.created_at,
               coalesce(b.balance_micro, 0) AS balance_micro,
               (SELECT count(*) FROM api_keys k WHERE k.user_id = u.id AND k.revoked_at IS NULL) AS keys,
               (SELECT count(*) FROM usage_events e WHERE e.user_id = u.id) AS requests
        FROM users u LEFT JOIN balances b ON b.user_id = u.id
        ORDER BY u.created_at
        """
    )
    return {"users": [dict(r) for r in rows]}


@router.get("/usage")
async def usage_summary(days: int = 7, admin: dict = Depends(auth.require_admin)):
    rows = await db.pool().fetch(
        """
        SELECT date_trunc('day', created_at) AS day, model_id,
               count(*) AS requests,
               coalesce(sum(tokens_in),0) AS tokens_in,
               coalesce(sum(tokens_out),0) AS tokens_out,
               coalesce(sum(cost_micro),0) AS cost_micro
        FROM usage_events
        WHERE created_at > now() - ($1 || ' days')::interval
        GROUP BY 1, 2 ORDER BY 1 DESC, 6 DESC
        """,
        str(days),
    )
    total = await db.pool().fetchrow(
        """
        SELECT count(*) AS requests, coalesce(sum(cost_micro),0) AS revenue_micro,
               count(DISTINCT user_id) AS users
        FROM usage_events WHERE created_at > now() - ($1 || ' days')::interval
        """,
        str(days),
    )
    return {"days": days, "total": dict(total), "by_day_model": [dict(r) for r in rows]}

@router.get("/keys")
async def list_all_keys(admin: dict = Depends(auth.require_admin)):
    """Every key of every user, with owner + usage so support can trace a key."""
    rows = await db.pool().fetch(
        """
        SELECT k.id, k.user_id, u.email, k.prefix, k.name, k.created_at,
               k.last_used_at, k.revoked_at,
               COALESCE(s.requests, 0)  AS requests,
               COALESCE(s.cost_micro, 0) AS cost_micro
        FROM api_keys k
        JOIN users u ON u.id = k.user_id
        LEFT JOIN (
            SELECT key_id,
                   count(*)::int           AS requests,
                   sum(cost_micro)::bigint AS cost_micro
            FROM usage_events
            WHERE key_id IS NOT NULL
            GROUP BY key_id
        ) s ON s.key_id = k.id
        ORDER BY k.created_at DESC
        """
    )
    return {"keys": [dict(r) for r in rows]}

@router.delete("/keys/{key_id}")
async def admin_revoke_key(key_id: str, admin: dict = Depends(auth.require_admin)):
    row = await db.pool().fetchrow(
        "UPDATE api_keys SET revoked_at = now() WHERE id = $1 AND revoked_at IS NULL RETURNING id, user_id",
        key_id,
    )
    if row is None:
        raise HTTPException(404, {"error": {"message": "Key tidak ditemukan atau sudah dicabut", "code": "not_found"}})
    await db.log_audit(admin["email"], "key.revoke.admin", key_id, {"user_id": row["user_id"]})
    return {"revoked": key_id}

class CreditIn(BaseModel):
    amount_idr: float = Field(gt=0)
    note: str | None = None


class NewUserIn(BaseModel):
    email: str
    password: str = Field(min_length=8)
    name: str | None = None
    role: str = "customer"
    credit_idr: float = 0


@router.post("/users", status_code=201)
async def create_user(body: NewUserIn, admin: dict = Depends(auth.require_admin)):
    email = body.email.strip().lower()
    if await db.pool().fetchval("SELECT 1 FROM users WHERE lower(email) = $1", email):
        raise HTTPException(409, {"error": {"message": "Email sudah terdaftar", "code": "email_taken"}})
    user_id = db.new_id()
    await db.pool().execute(
        """
        INSERT INTO users(id, email, password_hash, role, plan, status, name)
        VALUES ($1,$2,$3,$4,'starter','active',$5)
        """,
        user_id, email, auth.hash_password(body.password), body.role, body.name,
    )
    micro = int(round(body.credit_idr * 1_000_000))
    await db.credit_user(user_id, micro, kind="topup", note=f"saldo awal oleh {admin['email']}")
    await db.log_audit(admin["email"], "user.create", user_id, {"email": email, "credit_idr": body.credit_idr})
    return {"user": {"id": user_id, "email": email, "role": body.role}, "balance_micro": micro}


@router.post("/users/{user_id}/credit")
async def credit_wallet(user_id: str, body: CreditIn, admin: dict = Depends(auth.require_admin)):
    email = await db.pool().fetchval("SELECT email FROM users WHERE id = $1", user_id)
    if email is None:
        raise HTTPException(404, {"error": {"message": "User tidak ditemukan", "code": "not_found"}})
    micro = int(round(body.amount_idr * 1_000_000))
    balance = await db.credit_user(user_id, micro, kind="topup", note=body.note or f"topup oleh {admin['email']}")
    await db.log_audit(admin["email"], "wallet.credit", user_id, {"amount_idr": body.amount_idr, "note": body.note})
    return {"user_id": user_id, "credited_micro": micro, "balance_micro": balance, "balance_idr": balance / 1_000_000}


@router.get("/summary")
async def dashboard_summary(admin: dict = Depends(auth.require_admin)):
    """One call for the admin dashboard: money in, money out, margin, liability."""
    usage = await db.pool().fetchrow(
        """
        SELECT
          count(*)                                                                    AS requests,
          count(DISTINCT user_id)                                                     AS active_users,
          coalesce(sum(cost_micro), 0)                                                AS revenue_micro,
          coalesce(sum(cost_usd), 0)                                                  AS cost_usd,
          coalesce(sum(cost_micro) FILTER (WHERE created_at::date = now()::date), 0)  AS revenue_today_micro,
          count(*) FILTER (WHERE created_at > now() - interval '24 hours')            AS requests_24h,
          count(*) FILTER (WHERE status <> 'ok')                                      AS failed_requests
        FROM usage_events
        """
    )
    topups = await db.pool().fetchrow(
        """
        SELECT coalesce(sum(amount_micro) FILTER (WHERE kind = 'topup'), 0) AS topup_micro,
               count(*) FILTER (WHERE kind = 'topup')                      AS topup_count,
               coalesce(sum(amount_micro) FILTER (WHERE kind = 'charge'), 0) AS charged_micro
        FROM ledger_entries
        """
    )
    liability = await db.balance_liability()
    models = await db.pool().fetchval("SELECT count(*) FROM model_prices WHERE active")
    users = await db.pool().fetchval("SELECT count(*) FROM users")

    revenue = int(usage["revenue_micro"])
    cost_idr = float(usage["cost_usd"]) * USD_IDR
    margin = revenue / 1_000_000 - cost_idr
    return {
        "requests": int(usage["requests"]),
        "requests_24h": int(usage["requests_24h"]),
        "failed_requests": int(usage["failed_requests"]),
        "active_users": int(usage["active_users"]),
        "users_total": int(users),
        "models_active": int(models),
        "revenue_micro": revenue,
        "revenue_idr": revenue / 1_000_000,
        "revenue_today_idr": int(usage["revenue_today_micro"]) / 1_000_000,
        "cost_idr": round(cost_idr, 2),
        "margin_idr": round(margin, 2),
        "margin_pct": round((margin / (revenue / 1_000_000) * 100), 1) if revenue else None,
        "topup_idr": int(topups["topup_micro"]) / 1_000_000,
        "topup_count": int(topups["topup_count"]),
        "liability_idr": int(liability["wallets_micro"]) / 1_000_000,
        "ledger_diff_micro": int(liability["wallets_micro"]) - int(liability["ledger_micro"]),
        "negative_wallets": int(liability["negative_wallets"]),
    }


@router.get("/reconciliation")
async def reconciliation(days: int = 7, admin: dict = Depends(auth.require_admin)):
    """Compare what the gateway billed with what 9Router says it spent upstream."""
    rows = await db.pool().fetch(
        """
        SELECT created_at::date AS day,
               count(*) AS requests,
               coalesce(sum(cost_micro), 0) AS billed_micro,
               coalesce(sum(cost_usd), 0)   AS upstream_usd
        FROM usage_events
        WHERE created_at > now() - ($1 || ' days')::interval
        GROUP BY 1 ORDER BY 1 DESC
        """,
        str(days),
    )
    by_day = []
    for r in rows:
        billed = int(r["billed_micro"]) / 1_000_000
        cost = float(r["upstream_usd"]) * USD_IDR
        by_day.append({
            "day": r["day"].isoformat(),
            "requests": int(r["requests"]),
            "billed_idr": round(billed, 2),
            "upstream_cost_idr": round(cost, 2),
            "margin_idr": round(billed - cost, 2),
        })

    upstream_card = None
    try:
        import httpx

        async with httpx.AsyncClient(base_url="http://127.0.0.1:20128", timeout=20) as c:
            resp = await c.get(
                "/api/usage/history",
                headers={"x-9r-peer-token": upstream.PEER_TOKEN, "x-9r-real-ip": "127.0.0.1"},
                params={"days": days},
            )
            if resp.status_code == 200:
                upstream_card = resp.json()
    except Exception as exc:
        upstream_card = {"error": str(exc)}

    total = await db.pool().fetchrow(
        """
        SELECT coalesce(sum(cost_micro),0) AS billed_micro, coalesce(sum(cost_usd),0) AS upstream_usd
        FROM usage_events WHERE created_at > now() - ($1 || ' days')::interval
        """,
        str(days),
    )
    return {
        "days": days,
        "billed_idr": int(total["billed_micro"]) / 1_000_000,
        "upstream_cost_idr": round(float(total["upstream_usd"]) * USD_IDR, 2),
        "by_day": by_day,
        "upstream_report": upstream_card,
    }


@router.post("/maintenance/expire-holds")
async def expire_holds_now(admin: dict = Depends(auth.require_admin)):
    released = await db.expire_holds()
    return {"released": released}

@router.post("/maintenance/backfill-cost")
async def backfill_cost(admin: dict = Depends(auth.require_admin)):
    """Recompute upstream USD cost for events recorded before cost tracking existed."""
    rows = await db.pool().fetch(
        """
        SELECT id, model_id, tokens_in, tokens_out, cost_micro
        FROM usage_events WHERE coalesce(cost_usd, 0) = 0 AND status = 'ok'
        """
    )
    updated, skipped = 0, 0
    for row in rows:
        ti, to = int(row["tokens_in"]), int(row["tokens_out"])
        cost_usd = upstream.upstream_cost(row["model_id"], ti, to, window_seconds=10_000_000)
        if cost_usd is None:
            skipped += 1
            continue
        delta = int(row["cost_micro"]) - int(round(cost_usd * USD_IDR * 1_000_000))
        await db.pool().execute(
            "UPDATE usage_events SET cost_usd = $2, cost_delta_micro = $3 WHERE id = $1",
            row["id"], cost_usd, delta,
        )
        updated += 1
    await db.log_audit(admin["email"], "cost.backfill", None, {"updated": updated, "skipped": skipped})
    return {"updated": updated, "skipped": skipped}

@router.get("/pricing/suggest")
async def suggest_prices(margin_pct: float = 35.0, admin: dict = Depends(auth.require_admin)):
    """Sell price that keeps `margin_pct` above the real upstream cost per model."""
    blended = upstream.blended_usd_per_1m()
    rows = await db.pool().fetch(
        "SELECT model_id, display_name, price_in_idr, price_out_idr, active FROM model_prices ORDER BY model_id"
    )
    mult = 1 + margin_pct / 100
    out = []
    for row in rows:
        slug = row["model_id"].split("/")[-1]
        usd = blended.get(slug)
        if usd is None:
            continue
        cost_idr = usd * USD_IDR
        suggested = int(math.ceil(cost_idr * mult / 100) * 100)  # bulatkan ke atas per 100 rupiah
        current = int(row["price_out_idr"] or row["price_in_idr"] or 0)
        out.append({
            "model_id": row["model_id"],
            "display_name": row["display_name"],
            "active": bool(row["active"]),
            "upstream_usd_per_1m": round(usd, 4),
            "upstream_idr_per_1m": round(cost_idr, 2),
            "current_price_idr": current,
            "suggested_price_idr": suggested,
            "current_margin_pct": round((1 - cost_idr / current) * 100, 1) if current else None,
            "healthy": bool(current and current > cost_idr),
        })
    return {"margin_pct": margin_pct, "fx_usd_idr": USD_IDR, "models": out}

@router.get("/requests")
async def all_requests(limit: int = 100, days: int = 7, admin: dict = Depends(auth.require_admin)):
    rows = await db.pool().fetch(
        """
        SELECT e.id, e.model_id, e.tokens_in, e.tokens_out, e.cost_micro, e.cost_usd,
               e.latency_ms, e.status, e.created_at,
               u.email, k.name AS key_name,
               coalesce(p.display_name, e.model_id) AS display_name
        FROM usage_events e
        JOIN users u ON u.id = e.user_id
        LEFT JOIN api_keys k ON k.id = e.key_id
        LEFT JOIN model_prices p ON p.model_id = e.model_id
        WHERE e.created_at > now() - ($1 || ' days')::interval
        ORDER BY e.created_at DESC
        LIMIT $2
        """,
        str(max(days, 1)), min(max(limit, 1), 500),
    )
    return {"requests": [dict(r) for r in rows]}

@router.get("/monitor")
async def monitor(days: int = 7, admin: dict = Depends(auth.require_admin)):
    """Hierarki: user -> key -> (provider/model, IP pemakai, request in/out harian)."""
    d = str(max(days, 1))
    pool = db.pool()

    keys = await pool.fetch(
        """
        SELECT k.id, k.user_id, u.email, u.name AS user_name, k.name, k.prefix,
               CASE WHEN k.revoked_at IS NULL THEN 'active' ELSE 'revoked' END AS status,
               k.created_at, k.last_used_at,
               count(e.id) AS requests,
               coalesce(sum(e.tokens_in), 0) AS tokens_in,
               coalesce(sum(e.tokens_out), 0) AS tokens_out,
               coalesce(sum(e.tokens_cached), 0) AS tokens_cached,
               coalesce(sum(e.cost_micro), 0) AS cost_micro,
               max(e.created_at) AS last_request
        FROM api_keys k
        JOIN users u ON u.id = k.user_id
        LEFT JOIN usage_events e
               ON e.key_id = k.id AND e.created_at > now() - ($1 || ' days')::interval
        GROUP BY k.id, u.email, u.name
        ORDER BY requests DESC, k.created_at DESC
        """,
        d,
    )

    by_model = await pool.fetch(
        """
        SELECT e.key_id, e.model_id,
               coalesce(p.display_name, e.model_id) AS display_name,
               coalesce(nullif(p.provider_label, ''), '—') AS provider,
               coalesce(p.public_id, split_part(e.model_id, '/', 2)) AS public_id,
               count(*) AS requests,
               coalesce(sum(e.tokens_in), 0) AS tokens_in,
               coalesce(sum(e.tokens_out), 0) AS tokens_out,
               coalesce(sum(e.cost_micro), 0) AS cost_micro,
               max(e.created_at) AS last_seen
        FROM usage_events e
        LEFT JOIN model_prices p ON p.model_id = e.model_id
        WHERE e.created_at > now() - ($1 || ' days')::interval
        GROUP BY e.key_id, e.model_id, p.display_name, p.provider_label, p.public_id
        ORDER BY requests DESC
        """,
        d,
    )

    by_ip = await pool.fetch(
        """
        SELECT e.key_id,
               coalesce(e.client_ip, 'unknown') AS ip,
               coalesce(nullif(e.client_ua, ''), 'unknown') AS user_agent,
               count(*) AS requests,
               coalesce(sum(e.cost_micro), 0) AS cost_micro,
               min(e.created_at) AS first_seen,
               max(e.created_at) AS last_seen
        FROM usage_events e
        WHERE e.created_at > now() - ($1 || ' days')::interval
        GROUP BY e.key_id, 2, 3
        ORDER BY requests DESC
        """,
        d,
    )

    daily = await pool.fetch(
        """
        SELECT key_id, to_char(date_trunc('day', created_at), 'YYYY-MM-DD') AS day,
               count(*) AS requests,
               coalesce(sum(tokens_in), 0) AS tokens_in,
               coalesce(sum(tokens_out), 0) AS tokens_out
        FROM usage_events
        WHERE created_at > now() - ($1 || ' days')::interval AND key_id IS NOT NULL
        GROUP BY 1, 2
        ORDER BY 2
        """,
        d,
    )

    model_map: dict[str, list] = {}
    for row in by_model:
        item = dict(row)
        if not item.get("provider") or item["provider"] == "—":
            item["provider"] = _brand(item.get("model_id", ""))
        model_map.setdefault(row["key_id"], []).append(item)
    ip_map: dict[str, list] = {}
    for row in by_ip:
        ip_map.setdefault(row["key_id"], []).append(dict(row))
    day_map: dict[str, list] = {}
    for row in daily:
        day_map.setdefault(row["key_id"], []).append(dict(row))

    out_keys = []
    users: dict[str, dict] = {}
    for row in keys:
        k = dict(row)
        k["models"] = model_map.get(k["id"], [])
        k["ips"] = ip_map.get(k["id"], [])
        k["daily"] = day_map.get(k["id"], [])
        k["ip_count"] = len({i["ip"] for i in k["ips"]})
        out_keys.append(k)

        u = users.setdefault(
            k["user_id"],
            {
                "user_id": k["user_id"], "email": k["email"], "user_name": k["user_name"],
                "keys_total": 0, "keys_active": 0, "requests": 0,
                "tokens_in": 0, "tokens_out": 0, "cost_micro": 0,
                "ip_count": 0, "key_names": [],
            },
        )
        u["keys_total"] += 1
        u["keys_active"] += 1 if k["status"] == "active" else 0
        u["requests"] += int(k["requests"] or 0)
        u["tokens_in"] += int(k["tokens_in"] or 0)
        u["tokens_out"] += int(k["tokens_out"] or 0)
        u["cost_micro"] += int(k["cost_micro"] or 0)
        u["ip_count"] += k["ip_count"]
        u["key_names"].append(k["name"])

    return {
        "days": int(d),
        "users": sorted(users.values(), key=lambda x: x["requests"], reverse=True),
        "keys": out_keys,
    }


@router.get("/traffic")
async def traffic(
    days: int = 7,
    limit: int = 50,
    admin: dict = Depends(auth.require_admin),
):
    """Siapa (IP + user-agent) yang memakai key, dari mana, berapa banyak."""
    rows = await db.pool().fetch(
        """
        SELECT coalesce(e.client_ip, 'unknown') AS client_ip,
               coalesce(nullif(e.client_ua, ''), 'unknown') AS client_ua,
               u.email,
               coalesce(k.name, '—') AS key_name,
               count(*) AS requests,
               sum(e.cost_micro) AS cost_micro,
               min(e.created_at) AS first_seen,
               max(e.created_at) AS last_seen
        FROM usage_events e
        JOIN users u ON u.id = e.user_id
        LEFT JOIN api_keys k ON k.id = e.key_id
        WHERE e.created_at > now() - ($1 || ' days')::interval
        GROUP BY 1, 2, 3, 4
        ORDER BY requests DESC
        LIMIT $2
        """,
        str(max(days, 1)), min(max(limit, 1), 500),
    )
    # ringkas per IP: berapa key/user berbeda + total
    per_ip = await db.pool().fetch(
        """
        SELECT coalesce(client_ip, 'unknown') AS client_ip,
               count(*) AS requests,
               count(DISTINCT key_id) AS keys,
               count(DISTINCT user_id) AS users,
               sum(cost_micro) AS cost_micro,
               max(created_at) AS last_seen
        FROM usage_events
        WHERE created_at > now() - ($1 || ' days')::interval
        GROUP BY 1 ORDER BY requests DESC LIMIT $2
        """,
        str(max(days, 1)), min(max(limit, 1), 500),
    )
    return {
        "clients": [dict(r) for r in rows],
        "ips": [dict(r) for r in per_ip],
    }


@router.get("/audit")
async def audit_feed(limit: int = 20, admin: dict = Depends(auth.require_admin)):
    rows = await db.pool().fetch(
        """
        SELECT actor, action, target, meta, created_at
        FROM audit_logs ORDER BY created_at DESC LIMIT $1
        """,
        min(max(limit, 1), 200),
    )
    return {"entries": [dict(r) for r in rows]}

