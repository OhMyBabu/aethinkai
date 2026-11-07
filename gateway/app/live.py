"""Live (SSE) feed for dashboards: new requests + rolling totals, no reload."""

import asyncio
import json
from datetime import datetime, timedelta, timezone
from typing import Any

import jwt
from fastapi import APIRouter, Query, Request
from fastapi.responses import JSONResponse, StreamingResponse

from . import auth, db
from .config import USD_IDR

router = APIRouter(prefix="/api/live", tags=["live"])

POLL_SECONDS = 2.0
SUMMARY_EVERY = 3  # every 3rd tick (~6s)

_COLS = """
SELECT e.id, e.model_id,
       coalesce(p.display_name, e.model_id) AS display_name,
       coalesce(nullif(p.provider_label, ''), '') AS provider,
       e.tokens_in, e.tokens_out, e.tokens_cached,
       e.cost_micro, e.latency_ms, e.status, e.created_at,
       coalesce(k.name, '—') AS key_name
"""

_ME_ROWS = _COLS + """
FROM usage_events e
LEFT JOIN model_prices p ON p.model_id = e.model_id
LEFT JOIN api_keys k ON k.id = e.key_id
WHERE e.created_at > $1 AND e.user_id = $2
ORDER BY e.created_at ASC
LIMIT 200
"""

_ADMIN_ROWS = _COLS + """, u.email
FROM usage_events e
LEFT JOIN model_prices p ON p.model_id = e.model_id
LEFT JOIN api_keys k ON k.id = e.key_id
JOIN users u ON u.id = e.user_id
WHERE e.created_at > $1
ORDER BY e.created_at ASC
LIMIT 200
"""


def _sse(event: str, payload: Any) -> str:
    return f"event: {event}\ndata: {json.dumps(payload, default=str)}\n\n"


async def _resolve(token: str) -> dict | None:
    try:
        payload = jwt.decode(token, auth.JWT_SECRET, algorithms=[auth.JWT_ALG])
    except Exception:
        return None
    row = await db.pool().fetchrow(
        "SELECT id, email, role, plan, status FROM users WHERE id = $1", payload.get("sub")
    )
    if row is None or row["status"] != "active":
        return None
    return dict(row)


async def _user_summary(uid: str) -> dict:
    balance = await db.balance_micro(uid)
    row = await db.pool().fetchrow(
        """
        SELECT coalesce(sum(cost_micro) FILTER (WHERE created_at > now() - interval '30 days'), 0) AS spend_30d,
               coalesce(sum(cost_micro) FILTER (WHERE created_at::date = now()::date), 0)          AS spend_today,
               count(*) FILTER (WHERE created_at > now() - interval '30 days')                     AS requests_30d,
               max(created_at)                                                                      AS last_request
        FROM usage_events WHERE user_id = $1
        """,
        uid,
    )
    return {"balance_micro": balance, "balance_idr": balance / 1_000_000, **dict(row)}


async def _admin_summary() -> dict:
    usage = await db.pool().fetchrow(
        """
        SELECT count(*) AS requests,
               count(DISTINCT user_id) AS active_users,
               coalesce(sum(cost_micro), 0) AS revenue_micro,
               coalesce(sum(cost_usd), 0) AS cost_usd,
               count(*) FILTER (WHERE created_at > now() - interval '24 hours') AS requests_24h,
               count(DISTINCT client_ip) AS ips
        FROM usage_events
        """
    )
    liability = await db.balance_liability()
    wallets_micro = int(liability["wallets_micro"])
    revenue = int(usage["revenue_micro"])
    cost_idr = float(usage["cost_usd"]) * USD_IDR
    return {
        **{k: (float(v) if k == "cost_usd" else v) for k, v in dict(usage).items()},
        "revenue_idr": revenue / 1_000_000,
        "cost_idr": cost_idr,
        "margin_idr": revenue / 1_000_000 - cost_idr,
        "margin_pct": (100 * (revenue / 1_000_000 - cost_idr) / (revenue / 1_000_000)) if revenue else 0.0,
        "liability_idr": wallets_micro / 1_000_000,
        "ledger_diff_micro": wallets_micro - int(liability["ledger_micro"]),
        "negative_wallets": int(liability["negative_wallets"]),
        "ips_total": int(usage["ips"] or 0),
    }


async def _stream(request: Request, user: dict, admin: bool, since: str | None):
    uid = str(user["id"])
    cursor = datetime.now(timezone.utc) - timedelta(seconds=5)
    if since:
        try:
            cursor = datetime.fromisoformat(since.replace("Z", "+00:00"))
        except ValueError:
            pass

    sql = _ADMIN_ROWS if admin else _ME_ROWS
    yield _sse("ready", {"role": "admin" if admin else "user", "server_time": cursor.isoformat(), "poll": POLL_SECONDS})

    tick = 0
    while True:
        if await request.is_disconnected():
            break
        try:
            rows = await db.pool().fetch(sql, cursor) if admin else await db.pool().fetch(sql, cursor, uid)
        except Exception as exc:  # never kill the stream
            yield _sse("error", {"message": str(exc)[:200]})
            rows = []
        cursor = datetime.now(timezone.utc)
        if rows:
            yield _sse("requests", {"rows": [dict(r) for r in rows]})

        tick += 1
        if tick % SUMMARY_EVERY == 0:
            try:
                payload = await _admin_summary() if admin else await _user_summary(uid)
                yield _sse("summary", payload)
            except Exception as exc:
                yield _sse("error", {"message": f"summary: {exc}"[:200]})

        yield ": ping\n\n"
        await asyncio.sleep(POLL_SECONDS)


async def _guarded(request: Request, token: str, admin: bool, since: str | None):
    user = await _resolve(token)
    if user is None:
        return JSONResponse({"error": {"message": "Invalid session", "code": "invalid_session"}}, status_code=401)
    if admin and user["role"] != "admin":
        return JSONResponse({"error": {"message": "Admin only", "code": "forbidden"}}, status_code=403)
    return StreamingResponse(
        _stream(request, user, admin, since),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache, no-transform",
            "Content-Encoding": "identity",
            "X-Accel-Buffering": "no",
            "Connection": "keep-alive",
        },
    )


@router.get("/me")
async def live_me(request: Request, token: str = Query(...), since: str | None = None):
    return await _guarded(request, token, False, since)


@router.get("/admin")
async def live_admin(request: Request, token: str = Query(...), since: str | None = None):
    return await _guarded(request, token, True, since)


# ------------------------------------------------------------------ polling
# Cloudflare quick tunnels buffer text/event-stream, so dashboards also get a
# plain JSON endpoint with the exact same payloads. The client prefers SSE and
# falls back here automatically.

def _cursor(since: str | None) -> datetime:
    if since:
        try:
            return datetime.fromisoformat(since.replace("Z", "+00:00"))
        except ValueError:
            pass
    return datetime.now(timezone.utc) - timedelta(seconds=30)


async def _poll_common(token: str, since: str | None, admin: bool):
    user = await _resolve(token)
    if user is None:
        return JSONResponse({"error": {"message": "Invalid session", "code": "invalid_session"}}, 401)
    if admin and user["role"] != "admin":
        return JSONResponse({"error": {"message": "Admin only", "code": "forbidden"}}, 403)
    cursor = _cursor(since)
    uid = str(user["id"])
    if admin:
        rows = await db.pool().fetch(_ADMIN_ROWS, cursor)
        summary = await _admin_summary()
    else:
        rows = await db.pool().fetch(_ME_ROWS, cursor, uid)
        summary = await _user_summary(uid)
    return {
        "rows": [dict(r) for r in rows],
        "summary": summary,
        "server_time": datetime.now(timezone.utc).isoformat(),
    }


@router.get("/poll/me")
async def poll_me(token: str = Query(...), since: str | None = None):
    return await _poll_common(token, since, False)


@router.get("/poll/admin")
async def poll_admin(token: str = Query(...), since: str | None = None):
    return await _poll_common(token, since, True)
