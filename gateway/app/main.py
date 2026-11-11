"""AethinkAI Gateway — /v1 proxy + metering.

Money: integer micro-IDR (1 IDR = 1_000_000).
cost_micro == tokens * price_idr_per_1M  (exact integer, see README).
"""

import asyncio
import json
import os
import time
import uuid
from contextlib import asynccontextmanager
from typing import Any

from fastapi import Depends, FastAPI, Header, HTTPException, Request
from fastapi.responses import JSONResponse, StreamingResponse

from . import db, upstream
from .admin import router as admin_router
from .user import router as user_router
from .live import router as live_router
from . import extras, payments, portal
from .ratelimit import rpm as rpm_window
from .extras import router as extras_router
from .config import HOLD_TTL_SECONDS, USD_IDR


@asynccontextmanager
async def lifespan(app: FastAPI):
    await db.init_pool()
    janitor = asyncio.create_task(_hold_janitor())
    # Reconciler polls the provider; it stays OFF unless the operator opts in
    # (PAY_RECONCILE=1). Webhook + the bot's "Cek status" already cover the flow.
    sweeper = asyncio.create_task(payments.expiry_sweeper(int(os.environ.get("PAY_EXPIRY_SWEEP_SECONDS", "60"))))
    collector = None
    if (os.environ.get("PAY_RECONCILE") or "").strip() in {"1", "true", "yes"}:
        collector = asyncio.create_task(payments.reconciler(int(os.environ.get("PAY_RECONCILE_SECONDS", "300"))))
    try:
        yield
    finally:
        janitor.cancel()
        sweeper.cancel()
        if collector is not None:
            collector.cancel()
        await db.close_pool()


async def _hold_janitor() -> None:
    """Every minute: give back money for holds whose request died mid-flight."""
    while True:
        try:
            released = await db.expire_holds()
            if released:
                print(f"[janitor] released {released} expired hold(s)")
        except Exception as exc:  # never kill the loop
            print(f"[janitor] error: {exc}")
        await asyncio.sleep(60)


# API docs are a map of the whole attack surface. They stay off unless the
# operator explicitly enables them; nginx also 404s these paths at the edge.
_DOCS = (os.environ.get("AETHINK_DOCS") or "").strip() in {"1", "true", "yes"}
app = FastAPI(
    title="AethinkAI Gateway",
    version="0.1.0",
    lifespan=lifespan,
    docs_url="/docs" if _DOCS else None,
    redoc_url="/redoc" if _DOCS else None,
    openapi_url="/openapi.json" if _DOCS else None,
)

STARTED_AT = time.time()
app.include_router(user_router)
app.include_router(admin_router)
app.include_router(live_router)
app.include_router(extras_router)
app.include_router(portal.portal)
app.include_router(portal.store)
app.include_router(portal.internal)
app.include_router(portal.admin_ops)
app.include_router(payments.router)


from fastapi.exceptions import HTTPException as _HTTPExc
from starlette.exceptions import HTTPException as _StarletteHTTPExc


@app.exception_handler(_StarletteHTTPExc)
async def _http_error_shape(request: Request, exc: _StarletteHTTPExc):
    """Expose {error:{code,message}} at the top level as well as the FastAPI `detail` wrapper.

    The web clients read body.error.message; keeping `detail` preserves compatibility with
    every existing caller.
    """
    detail = exc.detail
    payload = detail if isinstance(detail, dict) else {"error": {"message": str(detail), "code": "error"}}
    if isinstance(payload, dict) and "error" in payload and "detail" not in payload:
        payload = {**payload, "detail": payload["error"]}
    return JSONResponse(payload, status_code=exc.status_code, headers=getattr(exc, "headers", None))


@app.middleware("http")
async def security_headers(request: Request, call_next):
    """Only headers the edge does NOT set.

    nginx owns HSTS / X-Frame-Options / Referrer-Policy / Permissions-Policy /
    COOP. Setting them here too emits duplicates with *different* values
    (`X-Frame-Options: SAMEORIGIN, DENY`), which browsers resolve differently —
    so the app deliberately stays out of that set.
    """
    response = await call_next(request)
    response.headers.setdefault("X-Content-Type-Options", "nosniff")
    if request.url.path.startswith(("/api/", "/v1/")):
        response.headers.setdefault("Cache-Control", "no-store")
    return response


# ---------------------------------------------------------------- auth

async def require_key(authorization: str | None = Header(default=None)) -> dict[str, Any]:
    if not authorization or not authorization.lower().startswith("bearer "):
        raise HTTPException(401, {"error": {"message": "Missing API key", "code": "missing_api_key"}})
    raw = authorization.split(" ", 1)[1].strip()
    if not (raw.startswith("sk-aeth_") or raw.startswith("sk-bansos_")):
        raise HTTPException(401, {"error": {"message": "Invalid API key", "code": "invalid_api_key"}})
    row = await db.find_key(raw)
    if row is None:
        raise HTTPException(401, {"error": {"message": "Invalid API key", "code": "invalid_api_key"}})
    return row


# ---------------------------------------------------------------- helpers

def cost_micro(model_price: dict, tokens_in: int, tokens_out: int, tokens_cached: int = 0) -> int:
    """Exact integer micro-IDR: tokens/1e6 * price_idr * 1e6 == tokens * price_idr.

    prompt_tokens already INCLUDES cached tokens, so the cached slice must be
    priced once at price_cached_idr and removed from the full-rate slice.
    """
    cached = max(0, min(int(tokens_cached or 0), int(tokens_in or 0)))
    fresh = max(0, int(tokens_in or 0) - cached)
    return (
        fresh * int(model_price["price_in_idr"])
        + int(tokens_out or 0) * int(model_price["price_out_idr"])
        + cached * int(model_price.get("price_cached_idr", 0))
    )


def _client(request: Request) -> tuple[str | None, str | None]:
    """Real caller identity: Cloudflare / proxy headers first, socket last."""
    h = request.headers
    ip = (h.get("cf-connecting-ip") or h.get("x-real-ip")
          or (h.get("x-forwarded-for") or "").split(",")[0].strip()
          or (request.client.host if request.client else None))
    ua = (h.get("user-agent") or "").strip()[:300] or None
    return (ip or None), ua


def estimate_hold(model_price: dict, tokens_in: int, max_tokens: int) -> int:
    return cost_micro(model_price, tokens_in, max_tokens)


def _usage_fields(usage: dict[str, Any]) -> tuple[int, int, int]:
    ti = int(usage.get("prompt_tokens") or usage.get("input_tokens") or 0)
    to = int(usage.get("completion_tokens") or usage.get("output_tokens") or 0)
    cached = 0
    details = usage.get("prompt_tokens_details") or {}
    if isinstance(details, dict):
        cached = int(details.get("cached_tokens") or 0)
    return ti, to, cached


async def _settle(hold_id: str | None, grant: dict | None, user_id: str, charged: int,
                  request_id: str, note: str) -> int:
    """Charge a wallet hold, or spend bansos credit when the request ran on a grant."""
    if grant is not None:
        await extras.bansos_charge(grant["id"], charged)
        return 0
    return await db.settle_hold(hold_id, user_id, charged, request_id, note)


async def _cost_usd(upstream_model: str, ti: int, to: int, cached: int = 0) -> float:
    """What the upstream really charged us, in USD (dashboard margin only)."""
    real = upstream.upstream_cost(upstream_model, ti, to)
    if real is not None:
        return real
    card = await upstream.pricing_usd()
    usd_in, usd_out, usd_cached = card.get(upstream_model, (0.0, 0.0, 0.0))
    return (ti / 1e6) * usd_in + (to / 1e6) * usd_out + (cached / 1e6) * usd_cached


# ---------------------------------------------------------------- routes

@app.get("/api/status")
async def public_status():
    """Public, aggregate-only health snapshot for the landing page."""
    row = await db.pool().fetchrow(
        """
        SELECT count(*) FILTER (WHERE created_at > now() - interval '24 hours') AS requests_24h,
               coalesce(sum(tokens_in + tokens_out)
                 FILTER (WHERE created_at > now() - interval '24 hours'), 0) AS tokens_24h,
               count(*) FILTER (WHERE status <> 'ok' AND created_at > now() - interval '24 hours') AS errors_24h,
               count(*) FILTER (WHERE created_at > now() - interval '7 days') AS requests_7d,
               max(created_at) AS last_request_at,
               percentile_cont(0.95) WITHIN GROUP (ORDER BY latency_ms)
                 FILTER (WHERE created_at > now() - interval '7 days' AND latency_ms > 0) AS p95_ms
        FROM usage_events
        """
    )
    # what the shop actually sells: availability='on', priced. `active` alone counted
    # a model in maintenance as live on the landing page.
    models_active = await db.pool().fetchval(
        """SELECT count(*) FROM model_prices
            WHERE availability = 'on' AND (price_in_idr > 0 OR price_out_idr > 0)"""
    )
    requests_24h = int(row["requests_24h"] or 0)
    errors_24h = int(row["errors_24h"] or 0)
    success_rate = 100.0 if requests_24h == 0 else round((1 - errors_24h / requests_24h) * 100, 2)

    # Verdict from the recent window, not from a 24-hour tail: two 400s from a probe this
    # morning would otherwise advertise "degraded" all day. Needs a sample of 10.
    recent = await db.pool().fetchrow(
        """SELECT count(*) AS total,
                  count(*) FILTER (WHERE status <> 'ok') AS bad
             FROM usage_events
            WHERE created_at > now() - interval '15 minutes'"""
    )
    r_total, r_bad = int(recent["total"] or 0), int(recent["bad"] or 0)
    recent_error_pct = 0.0 if r_total == 0 else round(r_bad / r_total * 100, 2)
    healthy = r_total < 10 or recent_error_pct <= 5.0

    per_model = await db.pool().fetch(
        """SELECT model_id,
                  count(*) AS requests,
                  coalesce(sum(tokens_in + tokens_out), 0) AS tokens,
                  count(*) FILTER (WHERE status <> 'ok') AS errors,
                  percentile_cont(0.95) WITHIN GROUP (ORDER BY latency_ms)
                    FILTER (WHERE latency_ms > 0) AS p95_ms
             FROM usage_events
            WHERE created_at > now() - interval '24 hours'
              -- only names we actually sell: an internal route id must never reach the public page
              AND model_id IN (SELECT public_id FROM model_prices WHERE public_id IS NOT NULL)
            GROUP BY model_id
            ORDER BY requests DESC
            LIMIT 20"""
    )

    return {
        "status": "operational" if healthy else "degraded",
        "window_minutes": 15,
        "window_requests": r_total,
        "window_error_pct": recent_error_pct,
        "db": True,
        "uptime_seconds": int(time.time() - STARTED_AT),
        "models_active": int(models_active or 0),
        "requests_24h": requests_24h,
        "requests_7d": int(row["requests_7d"] or 0),
        "last_request_at": row["last_request_at"].isoformat() if row["last_request_at"] else None,
        "tokens_24h": int(row["tokens_24h"] or 0),
        "errors_24h": errors_24h,
        "p95_latency_ms": int(row["p95_ms"] or 0),
        "success_rate": success_rate,
        "models": [
            {"model_id": r["model_id"], "requests": int(r["requests"]),
             "tokens": int(r["tokens"]), "errors": int(r["errors"]),
             "p95_latency_ms": int(r["p95_ms"]) if r["p95_ms"] else None}
            for r in per_model
        ],
    }


@app.get("/health")
async def health():
    balance_ok = True
    try:
        await db.pool().fetchval("SELECT 1")
    except Exception:
        balance_ok = False
    return {"status": "ok" if balance_ok else "degraded", "db": balance_ok, "fx_usd_idr": USD_IDR}


BRANDS: list[tuple[str, str]] = [
    ("deepseek", "DeepSeek"), ("claude", "Claude"), ("anthropic", "Claude"),
    ("glm", "GLM"), ("zhipu", "GLM"), ("kimi", "Kimi"), ("moonshot", "Kimi"),
    ("qwen", "Qwen"), ("minimax", "MiniMax"), ("gemini", "Gemini"),
    ("grok", "Grok"), ("gpt", "GPT"), ("llama", "Llama"), ("mistral", "Mistral"),
]


def brand_of(text: str) -> str | None:
    low = text.lower()
    for token, brand in BRANDS:
        if token in low:
            return brand
    return None


def pretty_name(model_id: str, display_name: str | None) -> str:
    """Never show a raw routed id (`mk/glm-5.3-flash`) to a customer."""
    slug = model_id.split("/")[-1]
    name = (display_name or "").strip()
    if name and "/" not in name and name.lower() not in {model_id.lower(), slug.lower()}:
        return name
    parts = [p for p in slug.replace("_", "-").split("-") if p]
    out: list[str] = []
    for part in parts:
        brand = brand_of(part)
        if brand:
            out.append(brand)
        elif part.lower() in {"glm", "gpt", "ai", "v"}:
            out.append(part.upper())
        elif part.isdigit() or any(ch.isdigit() for ch in part):
            out.append(part if part.lower().startswith("v") else part)
        else:
            out.append(part.capitalize())
    return " ".join(out) or slug


def _upstream_chain(payload: dict[str, Any], routes: list[str], extra: list[str]) -> list[dict[str, Any]]:
    """Ordered attempts, deduplicated: admin routes first, then model-level fallbacks.

    The buyer asked for one model name; each entry here is a host we are willing to
    try for it, in the operator's order.
    """
    seen: set[str] = set()
    out: list[dict[str, Any]] = []
    for name in [*routes, *extra]:
        if name and name not in seen:
            seen.add(name)
            out.append({**payload, "model": name})
    return out


@app.get("/api/stream")
async def catalog_stream(request: Request):
    """Server-sent catalogue changes so an open tab never needs a reload.

    Version = newest row touch in model_prices. Cheap enough to check every two
    seconds and it covers every path that can change the shop: price, name, state,
    limits refresh after a route edit.
    """
    async def events():
        catalog_version: float | None = None
        status_version: float | None = None
        ticks = 0
        yield "retry: 3000\n\n"
        while True:
            if await request.is_disconnected():
                break
            try:
                catalog_v = await db.pool().fetchval(
                    """SELECT COALESCE(EXTRACT(EPOCH FROM max(updated_at)), 0)::float8
                         FROM model_prices""")
            except Exception:
                catalog_v = None
            try:
                # status changes when traffic happens: newest request + error count
                row = await db.pool().fetchrow(
                    """SELECT COALESCE(EXTRACT(EPOCH FROM max(created_at)), 0)::float8 AS ts,
                              count(*) FILTER (WHERE status <> 'ok') AS bad
                         FROM usage_events
                        WHERE created_at > now() - interval '15 minutes'""")
                status_v = float(f"{row['ts']:.3f}") + int(row["bad"] or 0) / 1_000_000 if row else None
            except Exception:
                status_v = None

            if catalog_v is not None and catalog_v != catalog_version:
                first = catalog_version is None
                catalog_version = catalog_v
                yield f"event: {'hello' if first else 'catalog'}\ndata: {json.dumps({'version': catalog_v})}\n\n"
            if status_v is not None and status_v != status_version:
                first = status_version is None
                status_version = status_v
                yield f"event: {'status_hello' if first else 'status'}\ndata: {json.dumps({'version': status_v})}\n\n"

            ticks += 1
            if ticks % 10 == 0:
                yield ": ping\n\n"
            await asyncio.sleep(2)

    return StreamingResponse(events(), media_type="text/event-stream",
                             headers={"Cache-Control": "no-store",
                                      "X-Accel-Buffering": "no",
                                      "Connection": "keep-alive"})


@app.get("/api/popular-models")
async def popular_models(days: int = 3, limit: int = 4):
    """Top models by real request volume — the landing "popular" row.

    Derived from usage_events, not from marketing: last `days` (default 3) requests
    across all buyers, newest activity decides. Falls back to a wider window while
    the gateway is young and the 3-day window is still empty.
    """
    days = max(1, min(days, 30))
    limit = max(1, min(limit, 12))
    pool = db.pool()

    async def top(window_days: int):
        return await pool.fetch(
            """
            WITH resolved AS (
                SELECT coalesce(p.public_id, e.model_id) AS id
                  FROM usage_events e
                  LEFT JOIN model_prices p ON p.model_id = e.model_id
                 WHERE e.created_at >= now() - ($1 || ' days')::interval
            )
            SELECT r.id, count(*)::int AS requests
              FROM resolved r
              JOIN model_prices p2 ON p2.public_id = r.id
             WHERE p2.availability <> 'off'
             GROUP BY r.id
             ORDER BY requests DESC, r.id
             LIMIT $2
            """,
            str(window_days), limit,
        )

    rows = await top(days)
    window = days
    if len(rows) < limit:
        for wider in (7, 30):
            more = {r["id"]: r for r in rows}
            for r in await top(wider):
                more.setdefault(r["id"], r)
            rows = list(more.values())[:limit]
            window = wider
            if len(rows) >= limit:
                break

    picked = [{"id": r["id"], "requests": int(r["requests"])} for r in rows]
    if len(picked) < limit:
        seen = {p["id"] for p in picked}
        for r in await pool.fetch(
            """SELECT coalesce(public_id, split_part(model_id, '/', 2)) AS id
                 FROM model_prices
                WHERE availability <> 'off' AND (price_in_idr > 0 OR price_out_idr > 0)
                ORDER BY price_in_idr, model_id LIMIT $1""", limit * 2):
            if r["id"] and r["id"] not in seen:
                picked.append({"id": r["id"], "requests": 0})
                seen.add(r["id"])
            if len(picked) >= limit:
                break

    return {"window_days": window, "models": picked[:limit]}


@app.get("/api/models")
async def public_models():
    """Catalogue visible to customers: only models the admin enabled and priced."""
    # The catalogue is our own rows, not the router's advertisement: a product can
    # point at the same upstream route as another product (a variant with a different
    # name and price), and that must still appear here.
    rows = await db.pool().fetch(
        """
        SELECT model_id, public_id, provider_label, display_name,
               price_in_idr, price_out_idr, price_cached_idr, availability,
               context_window, max_output, capabilities
        FROM model_prices
        WHERE availability <> 'off' AND (price_in_idr > 0 OR price_out_idr > 0)
        ORDER BY model_id
        """
    )

    out = []
    for p in rows:
        model_id = p["model_id"]
        caps = p["capabilities"] or {}
        if isinstance(caps, str):
            try:
                caps = json.loads(caps)
            except Exception:
                caps = {}
        slug = model_id.split("/")[-1].split("#")[-1]
        out.append({
            "id": p["public_id"] or slug,
            "status": p["availability"],
            "display_name": pretty_name(model_id, p["display_name"]),
            "provider": p["provider_label"] or brand_of(slug) or "Aethink",
            "context_length": p["context_window"] or caps.get("contextWindow") or 0,
            "max_completion_tokens": p["max_output"] or caps.get("maxOutput") or 0,
            "capabilities": {k: v for k, v in caps.items() if isinstance(v, bool) and v},
            "pricing_idr_per_1m": {
                "input": p["price_in_idr"],
                "output": p["price_out_idr"],
                "cached_input": p["price_cached_idr"],
            },
        })
    return {"object": "list", "data": out, "count": len(out)}


@app.get("/v1/models")
async def models(_key: dict = Depends(require_key)):
    """Only models the admin enabled and priced — a client never sees a route it cannot call."""
    # Served from our rows so a product variant that shares an upstream route with
    # another product is listed under its own name.
    rows = await db.pool().fetch(
        """SELECT model_id, public_id, provider_label, display_name,
                  price_in_idr, price_out_idr, price_cached_idr, availability,
                  context_window, max_output, capabilities, updated_at
           FROM model_prices
           WHERE availability <> 'off' AND (price_in_idr > 0 OR price_out_idr > 0)
           ORDER BY model_id"""
    )
    visible = []
    for p in rows:
        slug = p["model_id"].split("/")[-1].split("#")[-1]
        caps = p["capabilities"] or {}
        if isinstance(caps, str):
            try:
                caps = json.loads(caps)
            except Exception:
                caps = {}
        visible.append({
            "id": p["public_id"] or slug,          # Aethink model name, not the 9Router route
            "object": "model",
            "created": int(p["updated_at"].timestamp()) if p["updated_at"] else None,
            "owned_by": "aethink",
            "status": p["availability"],
            "name": pretty_name(p["model_id"], p["display_name"]),
            "provider": p["provider_label"] or brand_of(slug) or "Aethink",
            "context_length": p["context_window"] or caps.get("contextWindow") or 0,
            "max_completion_tokens": p["max_output"] or caps.get("maxOutput") or 0,
            "pricing_idr_per_1m": {
                "input": p["price_in_idr"],
                "output": p["price_out_idr"],
                "cached_input": p["price_cached_idr"],
            },
        })
    return {"object": "list", "data": visible}


@app.post("/v1/chat/completions")
async def chat_completions(request: Request, key: dict = Depends(require_key)):
    # ---- per-key RPM (sliding 60s window); 429 tells the client exactly when to retry
    limit = int(key.get("rpm_limit") or 60)
    # Two layers: per-key (the plan the buyer paid for) and a box-wide ceiling so one
    # campaign cannot saturate the gateway for everyone. The per-key limit is the one
    # customers are promised in the docs; the global one is capacity protection.
    global_cap = int(os.environ.get("AETHINK_GLOBAL_RPM", "1200"))
    g_allowed, _, g_reset = rpm_window.allow("global", global_cap, 60)
    if not g_allowed:
        raise HTTPException(
            429,
            {"error": {"message": "Gateway sedang penuh, coba beberapa detik lagi",
                       "code": "gateway_busy"}},
            headers={"Retry-After": str(max(1, int(g_reset)))})

    allowed, remaining, reset = rpm_window.allow(f"key:{key['id']}", limit)
    rate_headers = {
        "X-RateLimit-Limit": str(limit),
        "X-RateLimit-Remaining": str(remaining),
        "X-RateLimit-Reset": str(int(reset) + 1),
    }
    if not allowed:
        raise HTTPException(
            429,
            {"error": {"message": f"Rate limit {limit} request/menit terlampaui", "code": "rate_limited"}},
            headers={**rate_headers, "Retry-After": str(max(1, int(reset)))},
        )

    try:
        payload = await request.json()
    except Exception:
        raise HTTPException(400, {"error": {"message": "Invalid JSON body", "code": "invalid_json"}})

    model_id = payload.get("model")
    if not model_id:
        raise HTTPException(400, {"error": {"message": "Missing model", "code": "missing_model"}})

    # Validate the shape before anything dereferences it: `messages: "x"` used to
    # reach `m.get("content")` and turn a client mistake into a 500.
    messages = payload.get("messages")
    if not isinstance(messages, list) or not messages or any(not isinstance(m, dict) for m in messages):
        raise HTTPException(400, {"error": {"message": "messages harus array of object",
                                            "code": "invalid_messages"}})
    for field in ("max_tokens", "max_completion_tokens"):
        raw = payload.get(field)
        if raw is None:
            continue
        if not isinstance(raw, int) or isinstance(raw, bool) or raw < 1:
            raise HTTPException(400, {"error": {"message": f"{field} harus integer >= 1",
                                                "code": "invalid_max_tokens"}})
        payload[field] = min(raw, 65536)   # a 1e9 budget is not a request, it is a hold bomb

    route = await db.resolve_model(model_id)
    if route is None or (route["price_in_idr"] == 0 and route["price_out_idr"] == 0):
        raise HTTPException(403, {"error": {"message": f"Model not enabled: {model_id}", "code": "model_not_allowed"}})
    availability = (route.get("availability") or "on").lower()
    if availability == "off":
        raise HTTPException(403, {"error": {"message": f"Model tidak dijual: {model_id}",
                                            "code": "model_not_allowed"}})
    if availability == "maintenance":
        # gangguan: the catalogue still lists it, the endpoint refuses politely
        raise HTTPException(503, {"error": {"message": f"Model sedang gangguan: {model_id}",
                                            "code": "model_maintenance"}},
                            headers={"Retry-After": "300"})

    # Provider-reported limits. Claiming "1M context" is fine only while the route
    # that serves it says 1M; both numbers come from /v1/models of the local router.
    out_cap = int(route.get("max_output") or 0)
    ctx_cap = int(route.get("context_window") or 0)
    for field in ("max_tokens", "max_completion_tokens"):
        if payload.get(field) and out_cap:
            payload[field] = min(int(payload[field]), out_cap)
    if ctx_cap:
        chars = sum(len(str(m.get("content") or "")) for m in messages) + 32 * len(messages)
        if chars / 3.2 > ctx_cap:
            raise HTTPException(400, {"error": {
                "message": f"Prompt melebihi context window model ini ({ctx_cap} token)",
                "code": "context_window_exceeded"}})

    price = {
        "price_in_idr": route["price_in_idr"],
        "price_out_idr": route["price_out_idr"],
        "price_cached_idr": route["price_cached_idr"],
    }
    # catalogue slug -> the local 9Router route that actually serves it. The
    # mapping lives in model_aliases because the two catalogues name models
    # differently (`glm-5.3` vs `neuralwatt:glm-5.3-flash`). No mapping means the
    # local router has no provider for it: fail honestly, never reach elsewhere.
    routed = await db.routes_for(route["model_id"])
    if not route.get("fallback_enabled", True):
        routed = routed[:1]                     # "fallback off": primary route only
    if not routed:
        # nothing configured: the synced alias is the single route
        routed = [{"upstream_model": route.get("local_model") or route["model_id"]}]
    upstream_model = routed[0]["upstream_model"]
    route_chain = [r["upstream_model"] for r in routed]
    payload["model"] = upstream_model

    balance = await db.balance_micro(key["user_id"])
    grant = None
    if balance <= 0:
        # wallet dry -> maybe a bansos (free public credit) grant covers this model
        grant = await extras.bansos_for(key["user_id"], route.get("public_id") or model_id)
        if grant is None:
            raise HTTPException(402, {"error": {"message": "Insufficient balance", "code": "insufficient_credits"}})

    await db.touch_key(key["id"])

    request_id = "req_" + uuid.uuid4().hex
    stream = bool(payload.get("stream"))
    max_tokens = int(payload.get("max_tokens") or payload.get("max_completion_tokens") or 1024)
    prompt_tokens_guess = int(sum(len(str(m.get("content") or "")) for m in payload.get("messages", [])) / 4) + 8

    # Never let a negative hold through: a negative balance (from a bug or a manual
    # edit) would turn `min(estimate, balance)` into a negative debit, i.e. free money.
    hold_amount = 0 if grant else max(0, min(estimate_hold(price, prompt_tokens_guess, max_tokens), balance))
    hold_id = None
    if not grant:
        hold_id = await db.create_hold(key["user_id"], key["id"], hold_amount, HOLD_TTL_SECONDS)
        if hold_id is None:
            # guarded debit lost the race with another request: wallet is already spent
            raise HTTPException(402, {"error": {"message": "Insufficient balance",
                                                "code": "insufficient_credits"}})

    started = time.perf_counter()
    client_ip, client_ua = _client(request)
    event: dict[str, Any] = {
        "id": db.new_id(), "request_id": request_id, "user_id": key["user_id"], "key_id": key["id"],
        # model_id is what the buyer asked for (public name); served_model is the route
        # that actually answered. Recording the route here leaked mr/... into buyer
        # usage pages and broke per-model stats.
        "model_id": price.get("public_id") or upstream_model, "served_model": upstream_model,
        "price_in_idr": price["price_in_idr"], "price_out_idr": price["price_out_idr"],
        "stream": stream, "client_ip": client_ip, "client_ua": client_ua,
    }

    if stream:
        async def gen():
            buffer = b""
            status = "ok"
            http_status = 200
            served_route = upstream_model
            try:
                chain = _upstream_chain(payload, route_chain,
                                        await extras.fallbacks_for(upstream_model))
                for candidate in chain:
                    agen = upstream.stream_chat(candidate)
                    try:
                        first = await agen.__anext__()
                    except StopAsyncIteration:
                        break
                    except Exception:
                        continue
                    served_route = candidate["model"]
                    buffer += first
                    yield first
                    async for chunk in agen:
                        buffer += chunk
                        yield chunk
                    break
                else:
                    raise RuntimeError("all upstream routes failed")
            except upstream.UpstreamError as e:
                status, http_status = "upstream_error", e.status
                yield b'data: {"error":{"message":"upstream error"}}\n\n'
            finally:
                usage = upstream.parse_sse_usage(buffer)
                ti, to, cached = _usage_fields(usage)
                charged = cost_micro(price, ti, to, cached)
                new_balance = await _settle(
                    hold_id, grant, key["user_id"], charged, request_id, f"{model_id} {ti}/{to}"
                )
                event.update({
                    "route": served_route,
                    "served_model": usage.get("_model"), "tokens_in": ti, "tokens_out": to,
                    "tokens_cached": cached, "cost_micro": charged,
                    "cost_usd": await _cost_usd(served_route, ti, to, cached),
                    "latency_ms": int((time.perf_counter() - started) * 1000),
                    "status": status, "http_status": http_status,
                })
                await db.record_usage(event)

        return StreamingResponse(
            gen(),
            media_type="text/event-stream",
            headers={"X-Request-Id": request_id, "Cache-Control": "no-cache", "X-Accel-Buffering": "no",
                     "X-Balance-Micro": str(balance - hold_amount), **rate_headers},
        )

    chain = _upstream_chain(payload, route_chain,
                            await extras.fallbacks_for(upstream_model))

    status_code, body, served_route = 502, b'{"error":{"message":"upstream unreachable"}}', upstream_model
    last_error: Exception | None = None
    for candidate in chain:
        try:
            status_code, body = await upstream.chat(candidate)
        except Exception as exc:  # network failure
            last_error = exc
            continue
        if status_code >= 500:
            last_error = RuntimeError(f"upstream {status_code}")
            continue
        served_route = candidate["model"]
        break
    else:
        if hold_id:
            await db.release_hold(hold_id, key["user_id"])
        await db.record_usage({**event, "status": "upstream_error", "http_status": status_code,
                               "latency_ms": int((time.perf_counter() - started) * 1000)})
        return JSONResponse({"error": {"message": f"Upstream unreachable: {last_error}", "code": "upstream_unreachable"}},
                            status_code=502)

    import json as _json
    parsed: dict[str, Any] = upstream.parse_completion(body)
    usage: dict[str, Any] = parsed.get("usage") or {}
    served = parsed.get("model")

    ti, to, cached = _usage_fields(usage)
    charged = cost_micro(price, ti, to, cached)
    if status_code >= 400:
        if hold_id:
            await db.release_hold(hold_id, key["user_id"])
    else:
        await _settle(hold_id, grant, key["user_id"], charged, request_id, f"{model_id} {ti}/{to}")

    await db.record_usage({
        **event, "served_model": served or model_id, "tokens_in": ti, "tokens_out": to,
        "tokens_cached": cached, "cost_micro": charged if status_code < 400 else 0,
        "cost_usd": await _cost_usd(served_route, ti, to, cached),
        "latency_ms": int((time.perf_counter() - started) * 1000),
        "status": "ok" if status_code < 400 else "upstream_error", "http_status": status_code,
    })

    return JSONResponse(content=parsed or {}, status_code=status_code,
                        headers={"X-Request-Id": request_id, **rate_headers})