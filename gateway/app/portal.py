"""Buyer portal + internal provisioning + admin access management.

Identity model
--------------
A buyer exists because they paid in the Telegram store. The bot never stores credentials: it calls
`POST /api/internal/grant` (HMAC-signed, idempotent on order_id) and the gateway mints the API key.
The buyer then opens the web portal, pastes that key once, and receives a **read-only** JWT for 12h —
the key itself is never kept in the browser session.

Threat model handled here
-------------------------
* key guessing / credential stuffing -> per-IP + per-identity escalating lockout, generic errors
* replay of provisioning calls       -> HMAC over raw body + 5 minute timestamp window
* double credit for one payment      -> order_id / payment_ref unique + granted status check
* leaked portal JWT                  -> scope="read", purpose="portal", 12h TTL, per-key revocation check
* key revocation mid-session         -> every portal request re-reads the key row
"""

from __future__ import annotations

import hashlib
import hmac
import json
import os
import secrets
import time
from datetime import datetime, timedelta, timezone
from typing import Any

import asyncpg
import httpx
import jwt
from fastapi import APIRouter, Depends, Header, HTTPException, Request
from pydantic import BaseModel, Field

from . import auth, db
from .ratelimit import auth_lock, rpm as rpm_window

# ------------------------------------------------------------------ secrets

INTERNAL_FILE = "/root/.secrets/aethink-internal"


def _load_internal_secret() -> str:
    try:
        return open(INTERNAL_FILE).read().strip()
    except FileNotFoundError:
        os.makedirs("/root/.secrets", exist_ok=True)
        val = secrets.token_hex(32)
        with open(INTERNAL_FILE, "w") as fh:
            fh.write(val)
        os.chmod(INTERNAL_FILE, 0o600)
        return val


INTERNAL_SECRET = os.environ.get("AETHINK_INTERNAL_SECRET", "").strip() or _load_internal_secret()
PORTAL_TTL_HOURS = 12
MAX_CLOCK_SKEW = 300  # seconds for the provisioning timestamp

portal = APIRouter(prefix="/api/portal", tags=["portal"])
store = APIRouter(prefix="/api", tags=["store"])

# Single source of truth for the catalogue: the web store, the bot and the grant path all read this.
async def load_packages(include_inactive: bool = False) -> list[dict[str, Any]]:
    """Packages live in the database: admin owns them, every surface reads them.

    Shaped for both consumers: `idr`/`rpm` for the bot (which has always read those
    keys) and `price_idr`/`credits_micro`/`rpm_limit` for the gateway and web UI.
    """
    rows = await db.pool().fetch(
        f"""SELECT sku, name, blurb, price_idr, credits_micro, rpm_limit, kind, active, sort
              FROM packages {"" if include_inactive else "WHERE active"}
             ORDER BY sort, price_idr"""
    )
    out = []
    for r in rows:
        item = dict(r)
        item["idr"] = int(r["price_idr"])
        item["rpm"] = int(r["rpm_limit"])
        item["credits"] = int(r["credits_micro"]) / 1_000_000
        out.append(item)
    return out


async def package_by_sku(sku: str, include_inactive: bool = False) -> dict[str, Any] | None:
    for p in await load_packages(include_inactive=include_inactive):
        if p["sku"] == sku:
            return p
    return None


async def topup_policy() -> dict[str, Any]:
    row = await db.pool().fetchrow("SELECT min_idr, max_idr, enabled FROM topup_policy WHERE id = 1")
    return dict(row) if row else {"min_idr": 2000, "max_idr": 5000000, "enabled": True}


BOT_USERNAME = os.environ.get("AETHINK_BOT_USERNAME", "AethinkBot")
LINK_TTL_MINUTES = 10


@store.get("/packages")
async def public_packages():
    return {"packages": await load_packages(), "topup": await topup_policy()}
internal = APIRouter(prefix="/api/internal", tags=["internal"])
admin_ops = APIRouter(prefix="/api/admin/access", tags=["admin-access"])


# ------------------------------------------------------------------ helpers

def _new_key() -> tuple[str, str, str]:
    raw = "sk-aeth_" + secrets.token_hex(24)
    return raw, raw[:16], hashlib.sha256(raw.encode()).hexdigest()


# Invoice ids are human-checkable: AETH-YYYYMMDD-XXXX (4 chars, no I/O/0/1 confusion).
ORDER_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"


def new_order_ref(prefix: str = "AETH") -> str:
    day = datetime.now(timezone.utc).strftime("%Y%m%d")
    tail = "".join(secrets.choice(ORDER_ALPHABET) for _ in range(4))
    return f"{prefix}-{day}-{tail}"


async def unique_order_ref(prefix: str = "AETH") -> str:
    """AETH-20261107-7K2Q, retried against the orders primary key."""
    for _ in range(8):
        ref = new_order_ref(prefix)
        taken = await db.pool().fetchval("SELECT 1 FROM orders WHERE id = $1", ref)
        if not taken:
            return ref
    raise _bad("order_ref_failed", "Gagal membuat nomor invoice, coba lagi", 503)


def _client_ip(request: Request) -> str:
    h = request.headers
    return (
        (h.get("cf-connecting-ip") or h.get("x-real-ip")
         or (h.get("x-forwarded-for") or "").split(",")[0].strip()
         or (request.client.host if request.client else "unknown"))
    )


def _bad(code: str, message: str, status: int = 401, **extra: Any) -> HTTPException:
    return HTTPException(status, {"error": {"message": message, "code": code, **extra}})


async def _audit_failure(scope: str, ident: str | None, ip: str) -> None:
    try:
        await db.pool().execute(
            "INSERT INTO auth_failures(scope, ident, ip) VALUES ($1,$2,$3)", scope, ident, ip
        )
    except Exception:
        pass


def _issue_portal_token(key_id: str, buyer_id: str | None, user_id: str) -> tuple[str, str]:
    now = datetime.now(timezone.utc)
    exp = now + timedelta(hours=PORTAL_TTL_HOURS)
    payload = {
        "sub": key_id,
        "buyer": buyer_id,
        "user": user_id,
        "scope": "read",
        "purpose": "portal",
        "aud": "aethink-portal",
        "iat": now,
        "exp": exp,
        "jti": secrets.token_hex(8),
    }
    return jwt.encode(payload, auth.JWT_SECRET, algorithm=auth.JWT_ALG), exp.isoformat()


def _issue_buyer_token(buyer_id: str) -> tuple[str, str]:
    now = datetime.now(timezone.utc)
    exp = now + timedelta(hours=PORTAL_TTL_HOURS)
    payload = {
        "sub": f"buyer:{buyer_id}",
        "buyer": buyer_id,
        "kind": "buyer",
        "scope": "buyer",
        "purpose": "portal",
        "aud": "aethink-portal",
        "iat": now,
        "exp": exp,
        "jti": secrets.token_hex(8),
    }
    return jwt.encode(payload, auth.JWT_SECRET, algorithm=auth.JWT_ALG), exp.isoformat()


async def portal_identity(authorization: str | None = Header(default=None)) -> dict[str, Any]:
    if not authorization or not authorization.lower().startswith("bearer "):
        raise _bad("missing_session", "Hubungkan Telegram atau tempel API key dulu")
    token = authorization.split(" ", 1)[1].strip()
    if token.startswith("sk-"):
        raise _bad("use_session_endpoint", "Tukar API key lewat /api/portal/session", 400)
    try:
        payload = jwt.decode(
            token, auth.JWT_SECRET, algorithms=[auth.JWT_ALG], audience="aethink-portal"
        )
    except jwt.ExpiredSignatureError:
        raise _bad("session_expired", "Sesi habis, tempel ulang API key")
    except Exception:
        raise _bad("invalid_session", "Sesi tidak valid")
    if payload.get("purpose") != "portal":
        raise _bad("invalid_session", "Sesi tidak valid")

    sub = str(payload.get("sub") or "")
    if sub.startswith("buyer:"):  # telegram-linked session, may own zero keys yet
        buyer = await db.pool().fetchrow(
            """SELECT id AS buyer_id, tg_id, username, name AS buyer_name, status AS buyer_status
               FROM buyers WHERE id = $1""",
            sub.split(":", 1)[1],
        )
        if buyer is None or buyer["buyer_status"] != "active":
            raise _bad("buyer_inactive", "Akun pembeli tidak aktif")
        first_key = await db.pool().fetchrow(
            """SELECT id, user_id, prefix, name, label, rpm_limit, status, last_used_at, created_at
               FROM api_keys WHERE buyer_id = $1 AND revoked_at IS NULL
               ORDER BY created_at DESC LIMIT 1""",
            buyer["buyer_id"],
        )
        row = {
            "key_id": first_key["id"] if first_key else None,
            "user_id": first_key["user_id"] if first_key else None,
            "prefix": first_key["prefix"] if first_key else None,
            "name": first_key["name"] if first_key else None,
            "label": first_key["label"] if first_key else None,
            "rpm_limit": first_key["rpm_limit"] if first_key else None,
            "key_status": first_key["status"] if first_key else None,
            "revoked_at": None,
            "last_used_at": first_key["last_used_at"] if first_key else None,
            "created_at": first_key["created_at"] if first_key else None,
            **dict(buyer),
            "email": None,
            "plan": None,
            "kind": "buyer",
        }
        return row

    row = await db.pool().fetchrow(
        """
        SELECT k.id AS key_id, k.user_id, k.buyer_id, k.prefix, k.name, k.label, k.rpm_limit,
               k.status AS key_status, k.revoked_at, k.last_used_at, k.created_at,
               b.tg_id, b.username, b.name AS buyer_name, b.status AS buyer_status,
               u.email, u.plan
        FROM api_keys k
        LEFT JOIN buyers b ON b.id = k.buyer_id
        JOIN users u ON u.id = k.user_id
        WHERE k.id = $1
        """,
        payload.get("sub"),
    )
    if row is None or row["revoked_at"] is not None or row["key_status"] != "active" or row["buyer_status"] == "suspended":
        raise _bad("key_revoked", "API key sudah tidak aktif")
    out = dict(row)
    out["kind"] = "key"
    return out


async def _scope_keys(row: dict[str, Any]) -> list[str]:
    """All active keys of the same buyer (falls back to this single key for legacy rows)."""
    if row.get("buyer_id"):
        ids = await db.pool().fetch(
            "SELECT id FROM api_keys WHERE buyer_id = $1 AND revoked_at IS NULL AND status = 'active'",
            row["buyer_id"],
        )
        return [r["id"] for r in ids] or ([row["key_id"]] if row.get("key_id") else [])
    return [row["key_id"]] if row.get("key_id") else []


async def _identity_balance(row: dict[str, Any]) -> int:
    keys = await _scope_keys(row)
    if not keys:
        return 0
    val = await db.pool().fetchval(
        """SELECT coalesce(sum(balance_micro),0) FROM balances
           WHERE user_id IN (SELECT DISTINCT user_id FROM api_keys WHERE id = ANY($1::text[]))""",
        keys,
    )
    return int(val or 0)


def _mask(prefix: str) -> str:
    return f"{prefix}…"


# ------------------------------------------------------------------ session

class SessionIn(BaseModel):
    api_key: str = Field(min_length=12, max_length=120)


@portal.post("/session")
async def portal_session(body: SessionIn, request: Request):
    """Exchange an API key for a short-lived read-only portal token.

    Brute-force resistant: escalating lockout per IP and per key prefix, generic error text,
    every failure written to auth_failures for the admin panel.
    """
    ip = _client_ip(request)
    prefix = body.api_key.strip()[:16]
    # scoped to (identity, ip): a distributed attacker cannot lock a legitimate buyer globally
    locks = (f"ip:{ip}", f"key:{prefix}:{ip}")
    wait = auth_lock.check(*locks)
    if wait:
        raise HTTPException(
            429,
            {"error": {"message": f"Terlalu banyak percobaan. Coba lagi dalam {wait}s", "code": "too_many_attempts"}},
            headers={"Retry-After": str(wait)},
        )

    row = await db.find_key(body.api_key.strip())
    if row is None:
        block = auth_lock.fail(900, *locks)
        await _audit_failure("portal_session", prefix, ip)
        if block:
            raise HTTPException(
                429,
                {"error": {"message": f"Terlalu banyak percobaan. Coba lagi dalam {block}s", "code": "too_many_attempts"}},
                headers={"Retry-After": str(block)},
            )
        raise _bad("invalid_key", "API key tidak valid")

    auth_lock.reset(*locks)
    # portal is for purchasers; bansos public keys are shared, so they get no portal identity
    if not row.get("buyer_id") and row.get("role") == "admin":
        raise _bad("not_a_buyer", "Key ini bukan key pembeli", 403)

    token, exp = _issue_portal_token(row["id"], row.get("buyer_id"), row["user_id"])
    balance = await db.balance_micro(row["user_id"])
    await db.log_audit(prefix, "portal.session", row["id"], {"ip": ip})
    return {
        "token": token,
        "expires_at": exp,
        "key": {"id": row["id"], "prefix": row["prefix"], "rpm_limit": row.get("rpm_limit", 60)},
        "buyer": {"id": row.get("buyer_id"), "tg_id": None, "username": None},
        "balance_micro": balance,
    }


# ------------------------------------------------------------------ portal data

@portal.get("/me")
async def portal_me(row: dict = Depends(portal_identity)):
    balance = await _identity_balance(row)
    if row.get("buyer_id"):
        keys = await db.pool().fetch(
            """
            SELECT id, prefix, name, label, rpm_limit, status, last_used_at, created_at
            FROM api_keys WHERE buyer_id = $1 AND revoked_at IS NULL ORDER BY created_at DESC
            """,
            row["buyer_id"],
        )
    elif row.get("user_id"):
        keys = await db.pool().fetch(
            """
            SELECT id, prefix, name, label, rpm_limit, status, last_used_at, created_at
            FROM api_keys WHERE user_id = $1 AND revoked_at IS NULL ORDER BY created_at DESC
            """,
            row["user_id"],
        )
    else:
        keys = []
    spend = await db.pool().fetchrow(
        """
        SELECT count(*) AS requests, coalesce(sum(cost_micro),0) AS cost_micro,
               coalesce(sum(tokens_in),0) AS tokens_in, coalesce(sum(tokens_out),0) AS tokens_out,
               count(DISTINCT model_id) AS models_used
        FROM usage_events WHERE key_id = ANY($1::text[])
        """,
        await _scope_keys(row),
    )
    return {
        "buyer": {
            "id": row.get("buyer_id"),
            "tg_id": row.get("tg_id"),
            "username": row.get("username"),
            "name": row.get("buyer_name"),
            "status": row.get("buyer_status") or "active",
        },
        "key": None if not row.get("key_id") else {
            "id": row["key_id"],
            "prefix": row["prefix"],
            "label": row.get("label") or row.get("name"),
            "rpm_limit": row.get("rpm_limit", 60),
            "last_used_at": row["last_used_at"].isoformat() if row.get("last_used_at") else None,
            "created_at": row["created_at"].isoformat() if row.get("created_at") else None,
        },
        "balance_micro": balance,
        "lifetime": dict(spend),
        "keys": [
            {
                "id": k["id"],
                "prefix": k["prefix"],
                "label": k["label"] or k["name"],
                "rpm_limit": k["rpm_limit"],
                "status": k["status"],
                "last_used_at": k["last_used_at"].isoformat() if k["last_used_at"] else None,
            }
            for k in keys
        ],
    }


@portal.get("/usage")
async def portal_usage(days: int = 30, row: dict = Depends(portal_identity)):
    days = max(1, min(days, 365))
    keys = await _scope_keys(row)
    daily = await db.pool().fetch(
        """
        SELECT date_trunc('day', created_at) AS day,
               count(*) AS requests,
               coalesce(sum(tokens_in),0) AS tokens_in,
               coalesce(sum(tokens_out),0) AS tokens_out,
               coalesce(sum(tokens_cached),0) AS tokens_cached,
               coalesce(sum(cost_micro),0) AS cost_micro
        FROM usage_events
        WHERE key_id = ANY($1::text[]) AND created_at > now() - ($2 || ' days')::interval
        GROUP BY 1 ORDER BY 1
        """,
        keys, str(days),
    )
    totals = await db.pool().fetchrow(
        """
        SELECT count(*) AS requests, coalesce(sum(tokens_in),0) AS tokens_in,
               coalesce(sum(tokens_out),0) AS tokens_out, coalesce(sum(cost_micro),0) AS cost_micro,
               coalesce(avg(latency_ms) FILTER (WHERE latency_ms > 0), 0) AS avg_latency_ms,
               count(*) FILTER (WHERE status <> 'ok') AS errors
        FROM usage_events
        WHERE key_id = ANY($1::text[]) AND created_at > now() - ($2 || ' days')::interval
        """,
        keys, str(days),
    )
    return {
        "days": days,
        "totals": dict(totals),
        "daily": [
            {"day": r["day"].isoformat(), **{k: r[k] for k in ("requests", "tokens_in", "tokens_out", "tokens_cached", "cost_micro")}}
            for r in daily
        ],
    }


@portal.get("/models")
async def portal_models(days: int = 30, row: dict = Depends(portal_identity)):
    days = max(1, min(days, 365))
    rows = await db.pool().fetch(
        """
        SELECT coalesce(mp.public_id, split_part(e.model_id, '/', 2)) AS model_id,
               count(*) AS requests,
               coalesce(sum(e.tokens_in),0) AS tokens_in,
               coalesce(sum(e.tokens_out),0) AS tokens_out,
               coalesce(sum(e.cost_micro),0) AS cost_micro,
               max(e.created_at) AS last_used_at
        FROM usage_events e
        LEFT JOIN model_prices mp ON mp.model_id = e.model_id
        WHERE e.key_id = ANY($1::text[]) AND e.created_at > now() - ($2 || ' days')::interval
        GROUP BY 1 ORDER BY cost_micro DESC
        """,
        await _scope_keys(row), str(days),
    )
    return {
        "days": days,
        "models": [
            {
                "model_id": r["model_id"],
                "requests": r["requests"],
                "tokens_in": r["tokens_in"],
                "tokens_out": r["tokens_out"],
                "cost_micro": r["cost_micro"],
                "last_used_at": r["last_used_at"].isoformat() if r["last_used_at"] else None,
            }
            for r in rows
        ],
    }


@portal.get("/requests")
async def portal_requests(limit: int = 50, offset: int = 0, row: dict = Depends(portal_identity)):
    limit = max(1, min(limit, 200))
    offset = max(0, offset)
    rows = await db.pool().fetch(
        """
        SELECT e.request_id,
               coalesce(mp.public_id, split_part(e.model_id, '/', 2)) AS model_id,
               coalesce(smp.public_id, split_part(coalesce(e.served_model, e.model_id), '/', 2)) AS served_model,
               e.tokens_in, e.tokens_out, e.tokens_cached,
               e.cost_micro, e.latency_ms, e.status, e.http_status, e.stream, e.client_ip, e.client_ua, e.created_at
        FROM usage_events e
        LEFT JOIN model_prices mp ON mp.model_id = e.model_id
        LEFT JOIN model_prices smp ON smp.model_id = coalesce(e.served_model, e.model_id)
        WHERE e.key_id = ANY($1::text[])
        ORDER BY e.created_at DESC LIMIT $2 OFFSET $3
        """,
        await _scope_keys(row), limit, offset,
    )
    out = []
    for r in rows:
        item = dict(r)
        item["created_at"] = r["created_at"].isoformat()
        item["client_ua"] = (r["client_ua"] or "")[:80] or None
        out.append(item)
    return {"limit": limit, "offset": offset, "requests": out}


async def _rotate_now(row: dict[str, Any]) -> dict[str, Any]:
    """Revoke the wallet's live key and mint exactly one replacement.

    The balance lives on the wallet (users/balances), never on the key, so rotation
    is a credential swap: credits, orders and usage history survive it.
    """
    raw, prefix, digest = _new_key()
    new_id = db.new_id()
    async with db.pool().acquire() as con:
        async with con.transaction():
            await con.execute("UPDATE api_keys SET revoked_at = now(), status = 'revoked' WHERE id = $1", row["key_id"])
            await con.execute(
                """INSERT INTO api_keys(id, user_id, buyer_id, prefix, hash, name, label, rpm_limit, status)
                   VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'active')""",
                new_id, row["user_id"], row.get("buyer_id"), prefix, digest,
                row.get("label") or row.get("name") or "rotated", row.get("label"), row.get("rpm_limit", 60),
            )
    await db.log_audit(row.get("prefix") or row.get("buyer_id") or "portal", "portal.rotate", row["key_id"], {})
    # The old session is bound to the revoked key; hand back a session for the new one
    # so rotating does not log the buyer out of the portal.
    token, exp = _issue_portal_token(new_id, row.get("buyer_id"), row["user_id"])
    return {"api_key": raw, "prefix": prefix, "token": token, "expires_at": exp,
            "warning": "Key lama langsung mati. Saldo tidak berubah. Simpan key baru sekarang."}


@portal.post("/keys/rotate")
async def portal_rotate(row: dict = Depends(portal_identity)):
    """A browser token is not proof of identity — the Telegram account is.

    A session minted from Telegram initData (Mini App) or from the bot link flow is
    already Telegram-verified, so it may rotate directly. A session opened with an
    API key on the web is only a token: it needs a code delivered by the bot.
    """
    if row.get("kind") == "buyer":
        return await _rotate_now(row)
    raise _bad(
        "verification_required",
        "Rotasi lewat web wajib verifikasi Telegram: minta kode dulu, atau ketik /rotate di bot.",
        403,
    )


class RotateConfirmIn(BaseModel):
    code: str = Field(min_length=4, max_length=8)


@portal.post("/keys/rotate/request")
async def rotate_request(request: Request, row: dict = Depends(portal_identity)):
    if not row.get("key_id"):
        raise _bad("no_key", "Belum punya API key — selesaikan pembelian dulu", 409)
    buyer_id = row.get("buyer_id")
    if not buyer_id:
        raise _bad("telegram_required", "Hubungkan Telegram dulu", 403)
    tg_id = await db.pool().fetchval("SELECT tg_id FROM buyers WHERE id = $1", buyer_id)
    if not tg_id:
        raise _bad("telegram_required", "Hubungkan Telegram dulu", 403)

    ip = _client_ip(request)
    allowed, retry, _ = rpm_window.allow(f"rotrq:{ip}", 5, 900)
    if not allowed:
        raise HTTPException(429, {"error": {
            "message": f"Terlalu banyak permintaan kode. Coba lagi dalam {max(1, retry // 60)} menit.",
            "code": "rate_limited"}})

    code = f"{secrets.randbelow(1_000_000):06d}"
    async with db.pool().acquire() as con:
        async with con.transaction():
            await con.execute(
                "UPDATE key_rotation_codes SET used_at = now() WHERE buyer_id = $1 AND used_at IS NULL",
                buyer_id)
            await con.execute(
                """INSERT INTO key_rotation_codes(id, buyer_id, user_id, code, expires_at)
                   VALUES ($1,$2,$3,$4, now() + interval '5 minutes')""",
                db.new_id(), buyer_id, row.get("user_id"), code)

    if not await _notify_rotation_code(int(tg_id), code):
        # never leave a live code the buyer cannot read
        await db.pool().execute(
            "UPDATE key_rotation_codes SET used_at = now() WHERE buyer_id = $1 AND used_at IS NULL",
            buyer_id)
        raise _bad("telegram_delivery_failed",
                   "Bot gagal mengirim kode. Coba /rotate langsung di chat bot.", 502)
    return {"sent": True, "expires_in": 300,
            "hint": "Kode dikirim ke chat bot Aethink kamu. Berlaku 5 menit."}


@portal.post("/keys/rotate/confirm")
async def rotate_confirm(body: RotateConfirmIn, row: dict = Depends(portal_identity)):
    if not row.get("key_id"):
        raise _bad("no_key", "Belum punya API key — selesaikan pembelian dulu", 409)
    rec = await db.pool().fetchrow(
        """SELECT id, code, attempts, expires_at FROM key_rotation_codes
            WHERE buyer_id = $1 AND used_at IS NULL
            ORDER BY created_at DESC LIMIT 1""",
        row.get("buyer_id"))
    if rec is None:
        raise _bad("no_request", "Minta kode dulu sebelum rotasi.", 409)
    if rec["expires_at"] <= datetime.now(timezone.utc):
        raise _bad("code_expired", "Kode kedaluwarsa. Minta kode baru.", 410)
    if rec["attempts"] >= 5:
        raise _bad("too_many_attempts", "Terlalu banyak percobaan. Minta kode baru.", 429)
    if not hmac.compare_digest(rec["code"], body.code.strip()):
        await db.pool().execute(
            "UPDATE key_rotation_codes SET attempts = attempts + 1 WHERE id = $1", rec["id"])
        raise _bad("wrong_code", "Kode salah.", 401)

    await db.pool().execute(
        "UPDATE key_rotation_codes SET used_at = now() WHERE id = $1", rec["id"])
    return await _rotate_now(row)


async def _notify_rotation_code(tg_id: int, code: str) -> bool:
    token = _bot_token()
    if not token:
        return False
    text = ("<b>Verifikasi rotasi API key</b>\n\n"
            f"Kode: <code>{code}</code>\n\n"
            "Berlaku 5 menit. Abaikan pesan ini kalau bukan kamu yang meminta.")
    try:
        async with httpx.AsyncClient(timeout=15) as c:
            r = await c.post(f"https://api.telegram.org/bot{token}/sendMessage",
                             json={"chat_id": tg_id, "text": text, "parse_mode": "HTML",
                                   "disable_web_page_preview": True})
            return r.status_code == 200
    except Exception as exc:
        print(f"[rotate] telegram delivery failed: {exc}", flush=True)
        return False


# ------------------------------------------------------------------ telegram linking (web -> bot)

class LinkReq(BaseModel):
    code: str = Field(min_length=8, max_length=80)


class LinkIn(BaseModel):
    code: str = Field(min_length=8, max_length=80)
    tg_id: int
    username: str | None = None
    name: str | None = None


@portal.post("/telegram/start")
async def telegram_start(request: Request):
    """One-time deep link. The buyer opens the bot, the bot confirms, the browser polls."""
    ip = _client_ip(request)
    allowed, _, reset = rpm_window.allow(f"link:{ip}", 10, 600)
    if not allowed:
        raise HTTPException(429, {"error": {"message": "Terlalu banyak percobaan. Tunggu sebentar.",
                                           "code": "too_many_attempts"}},
                            headers={"Retry-After": str(int(reset))})
    code = "lnk_" + secrets.token_urlsafe(12)
    await db.pool().execute(
        "INSERT INTO link_codes(code, expires_at) VALUES ($1, now() + ($2 || ' minutes')::interval)",
        code, str(LINK_TTL_MINUTES),
    )
    return {
        "code": code,
        "deep_link": f"https://t.me/{BOT_USERNAME}?start=link_{code}",
        "bot_username": BOT_USERNAME,
        "expires_in": LINK_TTL_MINUTES * 60,
    }


@portal.get("/telegram/status")
async def telegram_status(code: str = ""):
    if not code.startswith("lnk_"):
        raise _bad("bad_code", "Kode tidak valid", 400)
    row = await db.pool().fetchrow("SELECT * FROM link_codes WHERE code = $1", code)
    if row is None:
        return {"status": "unknown"}
    if row["status"] == "pending" and row["expires_at"] < datetime.now(timezone.utc):
        await db.pool().execute("UPDATE link_codes SET status = 'expired' WHERE code = $1 AND status = 'pending'", code)
        return {"status": "expired"}
    if row["status"] != "confirmed":
        return {"status": row["status"], "deep_link": f"https://t.me/{BOT_USERNAME}?start=link_{code}"}

    buyer = await db.pool().fetchrow(
        "SELECT id, tg_id, username, name, status FROM buyers WHERE tg_id = $1", row["tg_id"]
    )
    if buyer is None:
        raise _bad("not_a_buyer", "Akun tidak ditemukan", 404)
    if row["consumed_at"] is not None:
        return {"status": "consumed", "buyer": {"id": buyer["id"], "tg_id": buyer["tg_id"],
                                                "username": buyer["username"]}}
    token, exp = _issue_buyer_token(buyer["id"])
    await db.pool().execute(
        "UPDATE link_codes SET consumed_at = now() WHERE code = $1 AND consumed_at IS NULL", code
    )
    await db.log_audit(f"bot:{row['tg_id']}", "portal.link", buyer["id"], {})
    return {
        "status": "confirmed",
        "token": token,
        "expires_at": exp,
        "buyer": {"id": buyer["id"], "tg_id": buyer["tg_id"], "username": buyer["username"],
                  "name": buyer["name"]},
    }


class OrderReq(BaseModel):
    sku: str = Field(min_length=2, max_length=40)


async def pending_order_for(buyer_id: str) -> dict[str, Any] | None:
    """One open order per buyer: the checkout must finish or be cancelled first."""
    row = await db.pool().fetchrow(
        """
        SELECT o.id, o.sku, o.price_idr, o.credits_micro, o.status, o.created_at, o.checkout_token,
               pi.status AS intent_status, pi.expires_at, pi.raw
          FROM orders o
          LEFT JOIN LATERAL (
                SELECT status, expires_at, raw FROM payment_intents
                 WHERE order_id = o.id ORDER BY created_at DESC LIMIT 1
          ) pi ON true
         WHERE o.buyer_id = $1 AND o.status = 'pending'
         ORDER BY o.created_at DESC
         LIMIT 1
        """,
        buyer_id,
    )
    return dict(row) if row else None


def _pending_public(row: dict[str, Any]) -> dict[str, Any]:
    """Buyer-safe view of an open order, QR included only while the code is live."""
    raw = row.get("raw") or {}
    if isinstance(raw, str):
        try:
            raw = json.loads(raw)
        except Exception:
            raw = {}
    expires_at = row.get("expires_at")
    live = False
    if row.get("intent_status") == "pending" and expires_at:
        ts = expires_at if expires_at.tzinfo else expires_at.replace(tzinfo=timezone.utc)
        live = ts > datetime.now(timezone.utc)
    total = int(raw.get("total_bayar") or row["price_idr"])
    return {
        "order_id": str(row["id"]),
        "sku": row["sku"],
        "price_idr": int(row["price_idr"]),
        "credits_micro": int(row["credits_micro"]),
        "status": row["status"],
        "created_at": row["created_at"].isoformat() if row.get("created_at") else None,
        "payment": {
            "status": row.get("intent_status") or "none",
            "live": live,
            "expires_at": expires_at.isoformat() if expires_at else None,
            "qr_string": raw.get("qr_string") if live else None,
            "qr_image": raw.get("qr_image") if live else None,
            "total_bayar": total if live else int(row["price_idr"]),
            "fee_idr": max(0, total - int(row["price_idr"])) if live else 0,
        },
    }


@portal.post("/order")
async def portal_order(body: OrderReq, row: dict = Depends(portal_identity)):
    """Web purchase: allowed only for a Telegram-linked buyer (that is the identity check)."""
    pkg = await package_by_sku(body.sku)
    if pkg is None:
        raise _bad("unknown_sku", "Paket tidak dikenal atau sudah tidak dijual", 400)
    buyer_id = row.get("buyer_id")
    if not buyer_id:
        raise _bad("telegram_required", "Hubungkan Telegram dulu untuk membeli", 403)
    open_order = await pending_order_for(buyer_id)
    if open_order:
        raise _bad(
            "order_pending",
            "Masih ada pembayaran yang belum selesai. Lunasi atau batalkan dulu.",
            409,
            order=_pending_public(open_order),
        )

    order_id = await unique_order_ref()
    credits = int(pkg["credits_micro"])
    await db.pool().execute(
        """INSERT INTO orders(id, buyer_id, sku, credits_micro, price_idr, payment_ref, status, rpm_limit)
           VALUES ($1,$2,$3,$4,$5,$1,'pending',$6)
           ON CONFLICT (id) DO NOTHING""",
        order_id, buyer_id, pkg["sku"], credits, int(pkg["price_idr"]), int(pkg["rpm_limit"]),
    )
    await db.log_audit(f"buyer:{buyer_id}", "portal.order", order_id,
                       {"sku": pkg["sku"], "credits_micro": credits})
    return {
        "order_id": order_id,
        "sku": pkg["sku"],
        "name": pkg["name"],
        "price_idr": int(pkg["price_idr"]),
        "credits_micro": credits,
        "rpm_limit": int(pkg["rpm_limit"]),
        "status": "pending",
        "payment": {
            "method": "manual",
            "note": "Bayar ke admin (transfer/QRIS), lalu tekan 'Saya sudah bayar' di bot atau tunggu admin konfirmasi.",
        },
    }


class TopupReq(BaseModel):
    # bounds are checked below against topup_policy so the error is friendly, not a 422
    amount_idr: int = Field(ge=1, le=1_000_000_000)


@portal.post("/topup")
async def portal_topup(body: TopupReq, row: dict = Depends(portal_identity)):
    """Free-nominal top-up: credits == nominal, RPM unchanged.

    Buying a plan raises RPM (best package ever bought); topping up only adds credit.
    That keeps the shop explainable: one number for throughput, one number for money.
    """
    policy = await topup_policy()
    if not policy.get("enabled"):
        raise _bad("topup_disabled", "Top-up nominal bebas sedang tidak dibuka", 403)
    amount = int(body.amount_idr)
    if amount < int(policy["min_idr"]):
        raise _bad("topup_too_small", f"Minimal top-up Rp{int(policy['min_idr']):,}".replace(",", "."), 400)
    if policy.get("max_idr") and amount > int(policy["max_idr"]):
        raise _bad("topup_too_large", f"Maksimal top-up Rp{int(policy['max_idr']):,}".replace(",", "."), 400)
    buyer_id = row.get("buyer_id")
    if not buyer_id:
        raise _bad("telegram_required", "Hubungkan Telegram dulu untuk top-up", 403)
    open_order = await pending_order_for(buyer_id)
    if open_order:
        raise _bad(
            "order_pending",
            "Masih ada pembayaran yang belum selesai. Lunasi atau batalkan dulu.",
            409,
            order=_pending_public(open_order),
        )

    order_id = await unique_order_ref()
    credits = amount * 1_000_000
    rpm = int(row.get("rpm_limit") or 30)
    await db.pool().execute(
        """INSERT INTO orders(id, buyer_id, sku, credits_micro, price_idr, payment_ref, status, rpm_limit)
           VALUES ($1,$2,'topup',$3,$4,$1,'pending',$5)""",
        order_id, buyer_id, credits, amount, rpm)
    await db.log_audit(f"buyer:{buyer_id}", "portal.topup", order_id,
                       {"amount_idr": amount, "credits_micro": credits})
    return {
        "order_id": order_id,
        "sku": "topup",
        "name": "Top-up saldo",
        "price_idr": amount,
        "credits_micro": credits,
        "rpm_limit": rpm,
        "status": "pending",
        "payment": {"method": "manual", "note": "Bayar QRIS/transfer, lalu admin konfirmasi."},
    }


@portal.get("/orders/{order_id}/receipt")
async def order_receipt(order_id: str, row: dict = Depends(portal_identity)):
    """One order, fully explained: what was bought, what it cost, what it left behind."""
    order = await db.pool().fetchrow(
        """SELECT o.id, o.sku, o.credits_micro, o.price_idr, o.status, o.payment_ref,
                  o.rpm_limit, o.created_at, o.granted_at, o.buyer_id,
                  b.tg_id, b.username, b.name AS buyer_name
             FROM orders o LEFT JOIN buyers b ON b.id = o.buyer_id
            WHERE o.id = $1""", order_id)
    if order is None:
        raise _bad("not_found", "Invoice tidak ada", 404)
    if row.get("buyer_id") and order["buyer_id"] != row["buyer_id"]:
        raise _bad("not_found", "Invoice tidak ada", 404)

    pkg = await package_by_sku(order["sku"], include_inactive=True) or {}
    owner = await db.pool().fetchval(
        "SELECT user_id FROM api_keys WHERE buyer_id = $1 ORDER BY created_at DESC LIMIT 1",
        order["buyer_id"])
    balance = await db.balance_micro(owner) if owner else 0

    # what this order actually consumed, so a receipt is not just a price tag
    usage = await db.pool().fetchrow(
        """SELECT count(*) AS requests,
                  coalesce(sum(tokens_in),0) AS tokens_in,
                  coalesce(sum(tokens_out),0) AS tokens_out,
                  coalesce(sum(cost_micro),0) AS cost_micro
             FROM usage_events
            WHERE ($1::text IS NULL OR user_id = $1) AND created_at >= $2
              AND ($3::timestamptz IS NULL OR created_at <= $3)""",
        owner, order["created_at"], order["granted_at"])

    return {
        "invoice_id": order["id"],
        "issued_at": order["created_at"].isoformat(),
        "paid_at": order["granted_at"].isoformat() if order["granted_at"] else None,
        "status": order["status"],
        "buyer": {"tg_id": order["tg_id"], "username": order["username"], "name": order["buyer_name"]},
        "package": {"sku": order["sku"], "name": pkg.get("name") or order["sku"],
                    "rpm_limit": order["rpm_limit"]},
        "amount": {"price_idr": order["price_idr"], "credits_micro": order["credits_micro"],
                   "credits_idr": order["credits_micro"] / 1_000_000},
        "payment_ref": order["payment_ref"],
        "balance_micro": balance,
        "usage_since_issue": {
            "requests": int(usage["requests"] or 0),
            "tokens_in": int(usage["tokens_in"] or 0),
            "tokens_out": int(usage["tokens_out"] or 0),
            "cost_micro": int(usage["cost_micro"] or 0),
        },
        "note": "Saldo tersimpan di akun, bukan di key. Invoice ini bukti pembayaran; "
                "key tetap sama selama tidak dirotasi.",
    }


@portal.get("/orders")
async def portal_orders(row: dict = Depends(portal_identity)):
    buyer_id = row.get("buyer_id")
    if not buyer_id:
        return {"orders": []}
    rows = await db.pool().fetch(
        """SELECT id, sku, credits_micro, price_idr, status, created_at, granted_at
           FROM orders WHERE buyer_id = $1 ORDER BY created_at DESC LIMIT 20""",
        buyer_id,
    )
    return {"orders": [{**dict(r), "created_at": r["created_at"].isoformat(),
                        "granted_at": r["granted_at"].isoformat() if r["granted_at"] else None} for r in rows]}


@portal.get("/pending")
async def portal_pending(row: dict = Depends(portal_identity)):
    """The single open order, if any. No provider call: this reads our tables only."""
    buyer_id = row.get("buyer_id")
    if not buyer_id:
        return {"order": None}
    open_order = await pending_order_for(buyer_id)
    return {"order": _pending_public(open_order) if open_order else None}


@portal.get("/orders/{order_id}/status")
async def portal_order_status(order_id: str, row: dict = Depends(portal_identity)):
    """Local status poll for the in-page QRIS panel. Never asks the provider."""
    buyer_id = row.get("buyer_id")
    order = await db.pool().fetchrow(
        "SELECT buyer_id, status, granted_at FROM orders WHERE id = $1", order_id)
    if order is None or order["buyer_id"] != buyer_id:
        raise _bad("order_not_found", "Order tidak ada", 404)
    intent = await db.pool().fetchrow(
        """SELECT status, expires_at FROM payment_intents
            WHERE order_id = $1 ORDER BY created_at DESC LIMIT 1""", order_id)
    expires_at = intent["expires_at"] if intent else None
    live = False
    if intent and intent["status"] == "pending" and expires_at:
        ts = expires_at if expires_at.tzinfo else expires_at.replace(tzinfo=timezone.utc)
        live = ts > datetime.now(timezone.utc)
    return {
        "order_id": order_id,
        "status": order["status"],
        "payment_status": intent["status"] if intent else "none",
        "live": live,
        "expires_at": expires_at.isoformat() if expires_at else None,
        "granted_at": order["granted_at"].isoformat() if order["granted_at"] else None,
    }


@portal.post("/orders/{order_id}/cancel")
async def portal_cancel_order(order_id: str, row: dict = Depends(portal_identity)):
    """Cancel an unpaid order so the buyer can start a new one. Local only."""
    buyer_id = row.get("buyer_id")
    order = await db.pool().fetchrow(
        "SELECT buyer_id, status FROM orders WHERE id = $1", order_id)
    if order is None or order["buyer_id"] != buyer_id:
        raise _bad("order_not_found", "Order tidak ada", 404)
    if order["status"] == "granted":
        raise _bad("already_paid", "Order ini sudah dibayar", 409)
    if order["status"] != "pending":
        return {"order_id": order_id, "status": order["status"]}
    paid = await db.pool().fetchval(
        "SELECT 1 FROM payment_intents WHERE order_id = $1 AND status = 'paid' LIMIT 1", order_id)
    if paid:
        raise _bad("already_paid", "Pembayaran order ini sudah diterima", 409)
    await db.pool().execute(
        "UPDATE orders SET status = 'cancelled' WHERE id = $1 AND status = 'pending'", order_id)
    await db.pool().execute(
        "UPDATE payment_intents SET status = 'cancelled' WHERE order_id = $1 AND status = 'pending'",
        order_id)
    await db.log_audit(f"buyer:{buyer_id}", "portal.order.cancel", order_id, {})
    return {"order_id": order_id, "status": "cancelled"}


# ------------------------------------------------------------------ Telegram Mini App

def _bot_token() -> str:
    tok = os.environ.get("AETHINK_BOT_TOKEN") or os.environ.get("BOT_TOKEN")
    if tok:
        return tok.strip()
    path = os.environ.get("AETHINK_BOT_ENV", "/root/.secrets/aethink-bot.env")
    try:
        with open(path, "r", encoding="utf-8") as fh:
            for line in fh:
                line = line.strip()
                if line.startswith("BOT_TOKEN="):
                    return line.split("=", 1)[1].strip().strip('"').strip("'")
    except OSError:
        pass
    return ""


def _verify_init_data(init_data: str, max_age: int = 86400) -> dict:
    """Telegram WebApp initData: HMAC keyed by the bot token. Never trust initDataUnsafe."""
    from urllib.parse import parse_qsl

    token = _bot_token()
    if not token:
        raise _bad("miniapp_unconfigured", "Bot token belum diset di server", 503)
    pairs = dict(parse_qsl(init_data or "", keep_blank_values=True))
    received = pairs.pop("hash", "")
    if not received:
        raise _bad("bad_init_data", "initData tanpa hash", 401)
    check_string = "\n".join(f"{k}={pairs[k]}" for k in sorted(pairs))
    secret = hmac.new(b"WebAppData", token.encode(), hashlib.sha256).digest()
    expected = hmac.new(secret, check_string.encode(), hashlib.sha256).hexdigest()
    if not hmac.compare_digest(expected, received):
        raise _bad("bad_init_data", "Signature initData tidak valid", 401)
    try:
        auth_date = int(pairs.get("auth_date", "0"))
    except ValueError:
        auth_date = 0
    if auth_date <= 0 or abs(time.time() - auth_date) > max_age:
        raise _bad("stale_init_data", "Sesi Telegram kedaluwarsa, buka ulang Mini App", 401)
    try:
        user = json.loads(pairs.get("user", "{}"))
    except json.JSONDecodeError:
        raise _bad("bad_init_data", "Payload user rusak", 401)
    if not user.get("id"):
        raise _bad("bad_init_data", "initData tanpa user", 401)
    return user


class MiniAppIn(BaseModel):
    init_data: str = Field(min_length=10, max_length=8192)


@store.post("/tg/session")
async def tg_session(body: MiniAppIn):
    """Exchange verified Telegram initData for a read-only portal session."""
    tg_user = _verify_init_data(body.init_data)
    tg_id = int(tg_user["id"])
    async with db.pool().acquire() as con:
        async with con.transaction():
            buyer_id = await _ensure_buyer(
                con, tg_id, tg_user.get("username"),
                " ".join(filter(None, [tg_user.get("first_name"), tg_user.get("last_name")])) or None,
            )
    buyer = await db.pool().fetchrow(
        "SELECT id, tg_id, username, name, status FROM buyers WHERE id = $1", buyer_id
    )
    if buyer is None or buyer["status"] != "active":
        raise _bad("buyer_inactive", "Akun tidak aktif", 403)
    token, exp = _issue_buyer_token(buyer_id)
    await db.log_audit(f"tg:{tg_id}", "miniapp.session", buyer_id, {"auth_date": tg_user.get("auth_date")})
    return {
        "token": token,
        "expires_at": exp,
        "buyer": {"id": buyer["id"], "tg_id": buyer["tg_id"], "username": buyer["username"],
                  "name": buyer["name"]},
    }


_TUNNEL_CACHE: dict[str, Any] = {"url": "", "at": 0.0}


def _miniapp_url() -> str:
    url = os.environ.get("AETHINK_MINIAPP_URL", "").strip()
    if url:
        return url.rstrip("/") + "/tg"
    now = time.time()
    if _TUNNEL_CACHE["url"] and now - float(_TUNNEL_CACHE["at"]) < 30:
        return _TUNNEL_CACHE["url"]
    import glob
    import re

    found = ""
    for path in sorted(glob.glob("/root/.pm2/logs/aethink-tunnel-*.log"), key=lambda f: -os.path.getmtime(f)):
        try:
            with open(path, "r", encoding="utf-8", errors="ignore") as fh:
                m = re.findall(r"https://[a-z0-9-]+\.trycloudflare\.com", fh.read())
            if m:
                found = m[-1] + "/tg"
                break
        except OSError:
            continue
    _TUNNEL_CACHE.update(url=found, at=now)
    return found


@store.get("/miniapp")
async def miniapp_info():
    url = _miniapp_url()
    return {"url": url, "available": bool(url)}


# ------------------------------------------------------------------ provisioning (bot -> gateway)

class GrantIn(BaseModel):
    order_id: str = Field(min_length=3, max_length=80)
    tg_id: int
    username: str | None = None
    name: str | None = None
    sku: str = "starter"
    credits_micro: int = Field(gt=0)
    price_idr: int = Field(default=0, ge=0)
    payment_ref: str | None = None
    rpm_limit: int = Field(default=60, ge=1, le=100000)
    telegram_msg_id: int | None = None


async def _internal_payload(request: Request, model=None):
    """Verify HMAC over the raw body, then parse. Signature first: no schema leak to strangers."""
    raw = await request.body()
    ip = _client_ip(request)
    ts_raw = request.headers.get("x-timestamp", "")
    sig = request.headers.get("x-signature", "")
    try:
        ts = int(ts_raw)
    except ValueError:
        ts = 0
    if abs(time.time() - ts) > MAX_CLOCK_SKEW:
        await _audit_failure("internal", None, ip)
        raise _bad("stale_request", "Timestamp di luar jendela", 401)
    expected = hmac.new(INTERNAL_SECRET.encode(), f"{ts}.".encode() + raw, hashlib.sha256).hexdigest()
    if not hmac.compare_digest(expected, sig):
        await _audit_failure("internal", None, ip)
        raise _bad("bad_signature", "Signature tidak valid", 401)
    try:
        data = json.loads(raw or b"{}")
    except Exception:
        raise _bad("bad_body", "Body tidak valid", 400)
    return model(**data) if model else data


async def _ensure_buyer(con, tg_id: int, username: str | None, name: str | None) -> str:
    buyer = await con.fetchrow("SELECT id, status FROM buyers WHERE tg_id = $1", tg_id)
    if buyer is None:
        buyer_id = db.new_id()
        await con.execute(
            "INSERT INTO buyers(id, tg_id, username, name) VALUES ($1,$2,$3,$4)",
            buyer_id, tg_id, username, name,
        )
        return buyer_id
    if buyer["status"] != "active":
        raise _bad("buyer_suspended", "Akun pembeli sedang disuspend", 403)
    await con.execute(
        "UPDATE buyers SET username = coalesce($2, username), name = coalesce($3, name) WHERE id = $1",
        buyer["id"], username, name,
    )
    return buyer["id"]


async def _ensure_user(con, tg_id: int, sku: str, name: str | None) -> str:
    email = f"tg{tg_id}@buyer.aethink"
    user = await con.fetchrow("SELECT id FROM users WHERE lower(email) = lower($1)", email)
    if user:
        return user["id"]
    user_id = db.new_id()
    await con.execute(
        """INSERT INTO users(id, email, password_hash, role, plan, status, name)
           VALUES ($1,$2,$3,'user',$4,'active',$5)""",
        user_id, email, auth.hash_password(secrets.token_hex(24)), sku, name,
    )
    return user_id


async def _active_key(con, user_id: str):
    """The single live key of a wallet (see migrations/003_one_key_per_user.sql)."""
    return await con.fetchrow(
        """SELECT id, prefix, rpm_limit, rpm_override, label FROM api_keys
            WHERE user_id = $1 AND revoked_at IS NULL AND status = 'active'
            ORDER BY created_at DESC LIMIT 1""",
        user_id,
    )


async def _key_for_grant(con, user_id: str, buyer_id: str, label: str,
                         rpm: int) -> tuple[str, str | None, str, bool]:
    """Reuse the wallet's key instead of minting a second one.

    Identity is the Telegram account: one buyer = one wallet = one key. A second
    purchase tops up the same wallet, so it must not hand out another credential
    (two keys on one wallet made 'which key is mine' unanswerable and doubled the
    credential surface for zero benefit).
    """
    row = await _active_key(con, user_id)
    if row is not None:
        # RPM belongs to the account and never drops: a Pro purchase after a Starter
        # purchase raises the existing key instead of minting a second credential.
        # Exception: an admin hand-tuned this key (rpm_override) — purchases must not
        # undo a deliberate exception.
        if not row["rpm_override"] and int(rpm or 0) > int(row["rpm_limit"] or 0):
            await con.execute("UPDATE api_keys SET rpm_limit = $2 WHERE id = $1", row["id"], int(rpm))
        await con.execute(
            """UPDATE buyers SET plan_rpm = GREATEST(plan_rpm, $2) WHERE id = $1""",
            buyer_id, int(rpm or 0))
        return row["id"], None, row["prefix"], True
    key_id, raw_key, prefix = await _mint_key(con, user_id, buyer_id, label, rpm)
    return key_id, raw_key, prefix, False


async def _mint_key(con, user_id: str, buyer_id: str, label: str, rpm: int) -> tuple[str, str, str]:
    raw, prefix, digest = _new_key()
    key_id = db.new_id()
    await con.execute(
        """INSERT INTO api_keys(id, user_id, buyer_id, prefix, hash, name, label, rpm_limit, status)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'active')""",
        key_id, user_id, buyer_id, prefix, digest, label, label, rpm,
    )
    # the first purchase also sets the account's earned RPM
    await con.execute(
        "UPDATE buyers SET plan_rpm = GREATEST(plan_rpm, $2) WHERE id = $1", buyer_id, int(rpm or 0))
    return key_id, raw, prefix


async def _credit(con, user_id: str, micro: int, order_id: str, note: str) -> int:
    await con.execute(
        """INSERT INTO balances(user_id, balance_micro) VALUES ($1,$2)
           ON CONFLICT (user_id) DO UPDATE
             SET balance_micro = balances.balance_micro + EXCLUDED.balance_micro""",
        user_id, micro,
    )
    bal = await con.fetchval("SELECT balance_micro FROM balances WHERE user_id = $1", user_id)
    await con.execute(
        """INSERT INTO ledger_entries(id, user_id, kind, amount_micro, balance_after, ref, note)
           VALUES ($1,$2,'purchase',$3,$4,$5,$6)""",
        db.new_id(), user_id, micro, bal, order_id, note,
    )
    return bal


def _grant_result(order_id: str, buyer_id: str, key: str | None, prefix: str, bal: int, rpm: int) -> dict:
    return {
        "order_id": order_id,
        "already_granted": False,
        "buyer_id": buyer_id,
        "key": key,
        "key_prefix": prefix,
        "balance_micro": bal,
        "rpm_limit": rpm,
    }


@internal.post("/grant")
async def internal_grant(request: Request):
    """Bot-only: mint a key straight away (used when the store already knows the payment is settled)."""
    body = await _internal_payload(request, GrantIn)
    ip = _client_ip(request)
    payment_ref = body.payment_ref or body.order_id
    try:
        async with db.pool().acquire() as con:
            async with con.transaction():
                # Serialize retries for one order *before* the existence check: a row
                # lock locks nothing when the row does not exist yet, and that is how
                # five parallel bot retries used to end in a UniqueViolation → 500.
                await con.execute("SELECT pg_advisory_xact_lock(hashtext($1))", body.order_id)
                existing = await con.fetchrow(
                    "SELECT id, status, key_id FROM orders WHERE id = $1 FOR UPDATE", body.order_id
                )
                if existing and existing["status"] == "granted":
                    key = await con.fetchrow(
                        "SELECT id, prefix FROM api_keys WHERE id = $1", existing["key_id"]
                    )
                    return {
                        "order_id": body.order_id,
                        "already_granted": True,
                        "key": None,
                        "key_prefix": key["prefix"] if key else None,
                        "message": "Order ini sudah pernah di-grant. Pakai /rotate di bot untuk key baru.",
                    }

                buyer_id = await _ensure_buyer(con, body.tg_id, body.username, body.name)
                user_id = await _ensure_user(con, body.tg_id, body.sku, body.name)
                key_id, raw_key, prefix, reused = await _key_for_grant(
                    con, user_id, buyer_id, body.sku, int(body.rpm_limit))
                await con.execute(
                    """INSERT INTO orders(id, buyer_id, sku, credits_micro, price_idr, payment_ref,
                                          status, key_id, telegram_msg_id, granted_at)
                       VALUES ($1,$2,$3,$4,$5,$6,'granted',$7,$8,now())
                       ON CONFLICT (id) DO UPDATE
                         SET status='granted', key_id=EXCLUDED.key_id, granted_at=now()""",
                    body.order_id, buyer_id, body.sku, body.credits_micro, body.price_idr,
                    payment_ref, key_id, body.telegram_msg_id,
                )
                bal = await _credit(con, user_id, body.credits_micro, body.order_id,
                                    f"telegram {body.sku}")
    except asyncpg.UniqueViolationError:
        # Same payment settled twice under two order ids (double tap, bot retry with a
        # new id). The money was already credited to the first order — answer with the
        # order that owns the payment instead of a 500 the bot would read as "failed".
        async with db.pool().acquire() as con:
            row = await con.fetchrow(
                """SELECT o.id, o.status, o.key_id, k.prefix
                     FROM orders o LEFT JOIN api_keys k ON k.id = o.key_id
                    WHERE o.payment_ref = $1""",
                payment_ref,
            )
        if row is None:
            raise _bad("conflict", "Order atau payment_ref bentrok", 409)
        await db.log_audit(f"bot:{body.tg_id}", "internal.grant.duplicate", row["id"],
                           {"payment_ref": payment_ref, "ip": ip})
        return {
            "order_id": row["id"],
            "already_granted": row["status"] == "granted",
            "key": None,
            "key_prefix": row["prefix"],
            "message": "payment_ref ini sudah dipakai order lain; tidak ada kredit kedua.",
        }

    await db.log_audit(f"bot:{body.tg_id}", "internal.grant", body.order_id,
                       {"sku": body.sku, "credits_micro": body.credits_micro, "ip": ip})
    result = _grant_result(body.order_id, buyer_id, raw_key, prefix, bal, body.rpm_limit)
    result["key_reused"] = reused
    return result


async def grant_order(order_id: str) -> dict:
    """Grant an order that has already been paid.

    Called by the payment module (webhook / poll / reconciler) instead of the bot
    endpoint: the buyer identity, package and price come from the `orders` row, so a
    caller can never point a payment at someone else's credits.
    """
    async with db.pool().acquire() as con:
        async with con.transaction():
            await con.execute("SELECT pg_advisory_xact_lock(hashtext($1))", order_id)
            order = await con.fetchrow(
                """SELECT o.id, o.sku, o.credits_micro, o.price_idr, o.status, o.key_id,
                          o.rpm_limit, o.buyer_id, b.tg_id, b.username, b.name
                     FROM orders o JOIN buyers b ON b.id = o.buyer_id
                    WHERE o.id = $1 FOR UPDATE OF o""",
                order_id,
            )
            if order is None:
                raise _bad("order_not_found", "Order tidak ada", 404)
            if order["status"] == "granted":
                key = await con.fetchrow(
                    "SELECT prefix FROM api_keys WHERE id = $1", order["key_id"])
                bal = await con.fetchval(
                    "SELECT coalesce((SELECT balance_micro FROM balances WHERE user_id = "
                    "(SELECT user_id FROM api_keys WHERE id = $1)), 0)", order["key_id"])
                return {"order_id": order_id, "already_granted": True, "key": None,
                        "key_prefix": key["prefix"] if key else None,
                        "balance_micro": int(bal or 0), "rpm_limit": order["rpm_limit"]}

            user_id = await _ensure_user(con, order["tg_id"], order["sku"], order["name"])
            key_id, raw_key, prefix, reused = await _key_for_grant(
                con, user_id, order["buyer_id"], order["sku"], int(order["rpm_limit"] or 60))
            await con.execute(
                """UPDATE orders SET status='granted', key_id=$2, granted_at=now() WHERE id=$1""",
                order_id, key_id,
            )
            bal = await _credit(con, user_id, int(order["credits_micro"]), order_id,
                                f"paid {order['sku']}")
    return {"order_id": order_id, "already_granted": False, "key": raw_key, "key_prefix": prefix,
            "key_reused": reused, "balance_micro": int(bal),
            "rpm_limit": int(order["rpm_limit"] or 60)}


class OrderIn(BaseModel):
    order_id: str = Field(min_length=3, max_length=80)
    tg_id: int
    username: str | None = None
    name: str | None = None
    sku: str = Field(default="starter", max_length=40)
    credits_micro: int = Field(gt=0)
    price_idr: int = Field(default=0, ge=0)
    rpm_limit: int = Field(default=60, ge=1, le=100000)
    payment_ref: str | None = None
    telegram_msg_id: int | None = None


@internal.post("/order-id")
async def internal_order_id(request: Request):
    """The bot cannot invent invoice numbers: ask the gateway, which owns the format."""
    await _internal_payload(request, None)
    return {"order_id": await unique_order_ref(), "prefix": "AETH"}


@internal.post("/order")
async def internal_order(request: Request):
    """Create a pending order (payment not settled yet). Idempotent on order_id."""
    body = await _internal_payload(request, OrderIn)
    payment_ref = body.payment_ref or body.order_id
    try:
        async with db.pool().acquire() as con:
            async with con.transaction():
                # Same reasoning as /grant: serialize before the row exists.
                await con.execute("SELECT pg_advisory_xact_lock(hashtext($1))", body.order_id)
                buyer_id = await _ensure_buyer(con, body.tg_id, body.username, body.name)
                await con.execute(
                    """INSERT INTO orders(id, buyer_id, sku, credits_micro, price_idr, payment_ref,
                                          status, telegram_msg_id, rpm_limit)
                       VALUES ($1,$2,$3,$4,$5,$6,'pending',$7,$8)
                       ON CONFLICT (id) DO UPDATE
                         SET telegram_msg_id = coalesce(EXCLUDED.telegram_msg_id, orders.telegram_msg_id),
                             rpm_limit = EXCLUDED.rpm_limit""",
                    body.order_id, buyer_id, body.sku, body.credits_micro, body.price_idr,
                    payment_ref, body.telegram_msg_id, body.rpm_limit,
                )
                row = await con.fetchrow(
                    "SELECT id, status, sku FROM orders WHERE id = $1", body.order_id
                )
    except asyncpg.UniqueViolationError:
        async with db.pool().acquire() as con:
            row = await con.fetchrow(
                "SELECT o.id, o.status, o.sku, o.buyer_id FROM orders o WHERE o.payment_ref = $1",
                payment_ref,
            )
        if row is None:
            raise _bad("conflict", "Order atau payment_ref bentrok", 409)
        return {"order_id": row["id"], "status": row["status"], "sku": row["sku"],
                "buyer_id": row["buyer_id"], "duplicate_payment_ref": True}
    return {"order_id": row["id"], "status": row["status"], "sku": row["sku"], "buyer_id": buyer_id}


@internal.get("/order/{order_id}")
async def internal_order_status(order_id: str, request: Request):
    # GET has no body; sign the empty string with a timestamp header instead
    ts_raw = request.headers.get("x-timestamp", "")
    sig = request.headers.get("x-signature", "")
    try:
        ts = int(ts_raw)
    except ValueError:
        ts = 0
    if abs(time.time() - ts) > MAX_CLOCK_SKEW:
        raise _bad("stale_request", "Timestamp di luar jendela", 401)
    expected = hmac.new(INTERNAL_SECRET.encode(), f"{ts}.{order_id}".encode(), hashlib.sha256).hexdigest()
    if not hmac.compare_digest(expected, sig):
        raise _bad("bad_signature", "Signature tidak valid", 401)
    row = await db.pool().fetchrow(
        """SELECT o.id, o.status, o.sku, o.credits_micro, o.price_idr, o.granted_at, o.telegram_msg_id,
                  b.tg_id, b.username, k.prefix
           FROM orders o LEFT JOIN buyers b ON b.id = o.buyer_id
           LEFT JOIN api_keys k ON k.id = o.key_id WHERE o.id = $1""",
        order_id,
    )
    if row is None:
        raise _bad("not_found", "Order tidak ada", 404)
    return {**dict(row), "granted_at": row["granted_at"].isoformat() if row["granted_at"] else None}


async def _signed_get(request: Request, signed_for: str) -> None:
    ts_raw = request.headers.get("x-timestamp", "")
    sig = request.headers.get("x-signature", "")
    try:
        ts = int(ts_raw)
    except ValueError:
        ts = 0
    if abs(time.time() - ts) > MAX_CLOCK_SKEW:
        raise _bad("stale_request", "Timestamp di luar jendela", 401)
    expected = hmac.new(INTERNAL_SECRET.encode(), f"{ts}.{signed_for}".encode(), hashlib.sha256).hexdigest()
    if not hmac.compare_digest(expected, sig):
        raise _bad("bad_signature", "Signature tidak valid", 401)


@internal.post("/link/confirm")
async def internal_link_confirm(request: Request):
    """Bot confirms a web login code. Signed like every other internal call."""
    body = await _internal_payload(request, LinkIn)
    async with db.pool().acquire() as con:
        async with con.transaction():
            row = await con.fetchrow("SELECT * FROM link_codes WHERE code = $1 FOR UPDATE", body.code)
            if row is None:
                raise _bad("not_found", "Kode tidak dikenal", 404)
            if row["consumed_at"] is not None:
                raise _bad("already_used", "Kode sudah dipakai, minta kode baru di web", 409)
            if row["expires_at"] < datetime.now(timezone.utc):
                await con.execute("UPDATE link_codes SET status = 'expired' WHERE code = $1", body.code)
                raise _bad("expired", "Kode kedaluwarsa, minta kode baru di web", 410)
            buyer_id = await _ensure_buyer(con, body.tg_id, body.username, body.name)
            await con.execute(
                """UPDATE link_codes SET tg_id = $2, username = $3, name = $4,
                          status = 'confirmed', confirmed_at = now() WHERE code = $1""",
                body.code, body.tg_id, body.username, body.name,
            )
    await db.log_audit(f"bot:{body.tg_id}", "internal.link_confirm", buyer_id, {})
    return {"ok": True, "buyer_id": buyer_id, "tg_id": body.tg_id}


@internal.get("/pending")
async def internal_pending(request: Request):
    """Bot admin view: orders still waiting for payment confirmation."""
    await _signed_get(request, "pending")
    rows = await db.pool().fetch(
        """SELECT o.id, o.sku, o.credits_micro, o.price_idr, o.status, o.created_at,
                  b.tg_id, b.username, b.name
           FROM orders o LEFT JOIN buyers b ON b.id = o.buyer_id
           WHERE o.status = 'pending' ORDER BY o.created_at ASC LIMIT 30"""
    )
    return {"orders": [{**dict(r), "created_at": r["created_at"].isoformat()} for r in rows]}


@internal.get("/buyers")
async def internal_buyers(request: Request):
    await _signed_get(request, "buyers")
    rows = await db.pool().fetch(
        """SELECT b.id, b.tg_id, b.username, b.name, b.status, b.created_at,
                  count(k.id) FILTER (WHERE k.revoked_at IS NULL) AS keys_active,
                  coalesce((SELECT sum(bal.balance_micro) FROM balances bal
                            WHERE bal.user_id IN (SELECT DISTINCT user_id FROM api_keys k2
                                                  WHERE k2.buyer_id = b.id AND k2.revoked_at IS NULL)),0) AS balance_micro,
                  coalesce((SELECT sum(e.cost_micro) FROM usage_events e
                            JOIN api_keys k3 ON k3.id = e.key_id
                            WHERE k3.buyer_id = b.id),0) AS spend_micro
           FROM buyers b LEFT JOIN api_keys k ON k.buyer_id = b.id
           GROUP BY b.id ORDER BY b.created_at DESC LIMIT 20"""
    )
    return {"buyers": [{**dict(r), "created_at": r["created_at"].isoformat()} for r in rows]}


@internal.get("/buyer/{tg_id}")
async def internal_buyer(tg_id: int, request: Request):
    """Bot-facing snapshot: balance, live key prefixes, usage totals, recent orders."""
    ts_raw = request.headers.get("x-timestamp", "")
    sig = request.headers.get("x-signature", "")
    try:
        ts = int(ts_raw)
    except ValueError:
        ts = 0
    if abs(time.time() - ts) > MAX_CLOCK_SKEW:
        raise _bad("stale_request", "Timestamp di luar jendela", 401)
    expected = hmac.new(INTERNAL_SECRET.encode(), f"{ts}.buyer:{tg_id}".encode(), hashlib.sha256).hexdigest()
    if not hmac.compare_digest(expected, sig):
        raise _bad("bad_signature", "Signature tidak valid", 401)

    buyer = await db.pool().fetchrow("SELECT id, tg_id, username, name, status, created_at FROM buyers WHERE tg_id = $1", tg_id)
    if buyer is None:
        raise _bad("not_a_buyer", "Belum ada pembelian untuk akun ini", 404)
    keys = await db.pool().fetch(
        """SELECT id, prefix, user_id, rpm_limit, status, last_used_at, created_at
           FROM api_keys WHERE buyer_id = $1 AND revoked_at IS NULL ORDER BY created_at DESC""",
        buyer["id"],
    )
    user_ids = [k["user_id"] for k in keys]
    bal = 0
    usage = {"requests": 0, "tokens_in": 0, "tokens_out": 0, "cost_micro": 0}
    if user_ids:
        bal = int(await db.pool().fetchval(
            "SELECT coalesce(sum(balance_micro),0) FROM balances WHERE user_id = ANY($1::text[])", user_ids) or 0)
        key_ids = [k["id"] for k in keys]
        row = await db.pool().fetchrow(
            """SELECT count(*) AS requests, coalesce(sum(tokens_in),0) AS tokens_in,
                      coalesce(sum(tokens_out),0) AS tokens_out, coalesce(sum(cost_micro),0) AS cost_micro,
                      count(*) FILTER (WHERE created_at > now() - interval '24 hours') AS requests_24h,
                      count(*) FILTER (WHERE created_at > now() - interval '7 days') AS requests_7d,
                      coalesce(sum(cost_micro) FILTER (WHERE created_at > now() - interval '24 hours'),0) AS spend_24h_micro
               FROM usage_events WHERE key_id = ANY($1::text[])""",
            key_ids)
        usage = dict(row)
    orders = await db.pool().fetch(
        "SELECT id, sku, credits_micro, price_idr, status, created_at FROM orders WHERE buyer_id = $1 ORDER BY created_at DESC LIMIT 5",
        buyer["id"])
    return {
        "buyer": {**dict(buyer), "created_at": buyer["created_at"].isoformat()},
        "balance_micro": bal,
        "usage": usage,
        "keys": [{**dict(k), "last_used_at": k["last_used_at"].isoformat() if k["last_used_at"] else None,
                  "created_at": k["created_at"].isoformat()} for k in keys],
        "orders": [{**dict(o), "created_at": o["created_at"].isoformat()} for o in orders],
    }


@internal.post("/order/{order_id}/grant")
async def internal_grant_order(order_id: str, request: Request):
    """Settle a pending order using the amounts stored server-side (never re-sent by the bot)."""
    await _internal_payload(request)
    ip = _client_ip(request)
    async with db.pool().acquire() as con:
        async with con.transaction():
            order = await con.fetchrow("SELECT * FROM orders WHERE id = $1 FOR UPDATE", order_id)
            if order is None:
                raise _bad("not_found", "Order tidak ada", 404)
            if order["status"] == "granted":
                key = await con.fetchrow("SELECT prefix FROM api_keys WHERE id = $1", order["key_id"])
                return {"order_id": order_id, "already_granted": True, "key": None,
                        "key_prefix": key["prefix"] if key else None}
            if order["status"] not in ("pending", "paid"):
                raise _bad("bad_status", f"Order berstatus {order['status']}", 409)

            buyer = await con.fetchrow("SELECT tg_id, username, name FROM buyers WHERE id = $1", order["buyer_id"])
            if buyer is None:
                raise _bad("not_found", "Buyer hilang", 404)
            user_id = await _ensure_user(con, buyer["tg_id"], order["sku"], buyer["name"])
            label = order["sku"]
            # same rule as the paid-webhook path (grant_order): the package decides the RPM;
            # _key_for_grant only ever raises an existing key, and respects admin overrides
            rpm = order["rpm_limit"] or 60
            key_id, raw_key, prefix, reused = await _key_for_grant(
                con, user_id, order["buyer_id"], label, int(rpm or 60))
            await con.execute("UPDATE orders SET status='granted', key_id=$2, granted_at=now() WHERE id=$1",
                              order_id, key_id)
            bal = await _credit(con, user_id, order["credits_micro"], order_id, f"telegram {order['sku']}")

    await db.log_audit(f"bot:{buyer['tg_id']}", "internal.grant_order", order_id,
                       {"sku": order["sku"], "credits_micro": order["credits_micro"], "ip": ip})
    result = _grant_result(order_id, order["buyer_id"], raw_key, prefix, bal, int(rpm or 60))
    result["key_reused"] = reused
    result["tg_id"] = buyer["tg_id"]
    result["telegram_msg_id"] = order["telegram_msg_id"]
    return result


class RotateIn(BaseModel):
    tg_id: int


@internal.post("/rotate")
async def internal_rotate(request: Request):
    """Buyer lost the key: revoke every live key of that Telegram account and mint one new."""
    body = await _internal_payload(request, RotateIn)
    async with db.pool().acquire() as con:
        async with con.transaction():
            buyer = await con.fetchrow("SELECT id, name FROM buyers WHERE tg_id = $1", body.tg_id)
            if buyer is None:
                raise _bad("not_a_buyer", "Belum ada pembelian untuk akun ini", 404)
            live = await con.fetch(
                "SELECT id, user_id, rpm_limit, label FROM api_keys WHERE buyer_id = $1 AND revoked_at IS NULL",
                buyer["id"],
            )
            if not live:
                raise _bad("no_key", "Tidak ada key aktif", 404)
            label = live[0]["label"] or "starter"
            rpm = live[0]["rpm_limit"] or 60
            await con.execute(
                "UPDATE api_keys SET revoked_at = now(), status = 'revoked' "
                "WHERE user_id = $1 AND revoked_at IS NULL",
                live[0]["user_id"],
            )
            key_id, raw_key, prefix = await _mint_key(con, live[0]["user_id"], buyer["id"], label, rpm)
    await db.log_audit(f"bot:{body.tg_id}", "internal.rotate", key_id, {})
    return {"api_key": raw_key, "prefix": prefix, "rpm_limit": rpm, "buyer_id": buyer["id"]}


# ------------------------------------------------------------------ admin: access management

class KeyPatch(BaseModel):
    rpm_limit: int | None = Field(default=None, ge=1, le=100000)
    status: str | None = Field(default=None, pattern="^(active|suspended|revoked)$")
    label: str | None = Field(default=None, max_length=60)


class CreditIn(BaseModel):
    amount_idr: float = Field(gt=0, le=1_000_000_000)
    note: str = Field(default="manual credit", max_length=120)


@admin_ops.get("/buyers")
async def admin_buyers(q: str = "", limit: int = 100, _: dict = Depends(auth.require_admin)):
    limit = max(1, min(limit, 500))
    rows = await db.pool().fetch(
        """
        SELECT b.id, b.tg_id, b.username, b.name, b.status, b.created_at,
               count(k.id) FILTER (WHERE k.revoked_at IS NULL) AS keys_active,
               coalesce(sum(k2.spend_micro),0) AS spend_micro
        FROM buyers b
        LEFT JOIN api_keys k ON k.buyer_id = b.id
        LEFT JOIN LATERAL (
            SELECT coalesce(sum(cost_micro),0) AS spend_micro FROM usage_events u
            WHERE u.user_id = k.user_id AND u.created_at > now() - interval '30 days'
        ) k2 ON true
        WHERE ($1 = '' OR b.username ILIKE '%' || $1 || '%' OR b.name ILIKE '%' || $1 || '%' OR b.tg_id::text = $1)
        GROUP BY b.id ORDER BY b.created_at DESC LIMIT $2
        """,
        q, limit,
    )
    out = []
    for r in rows:
        bal = await db.pool().fetchval(
            "SELECT coalesce(sum(bal.balance_micro),0) FROM api_keys k JOIN balances bal ON bal.user_id = k.user_id WHERE k.buyer_id = $1",
            r["id"],
        )
        out.append({
            "id": r["id"], "tg_id": r["tg_id"], "username": r["username"], "name": r["name"],
            "status": r["status"], "created_at": r["created_at"].isoformat(),
            "keys_active": r["keys_active"], "spend_micro": int(r["spend_micro"] or 0),
            "balance_micro": int(bal or 0),
        })
    return {"buyers": out}


@admin_ops.get("/buyers/{buyer_id}")
async def admin_buyer_detail(buyer_id: str, _: dict = Depends(auth.require_admin)):
    buyer = await db.pool().fetchrow("SELECT * FROM buyers WHERE id = $1", buyer_id)
    if buyer is None:
        raise _bad("not_found", "Buyer tidak ada", 404)
    keys = await db.pool().fetch(
        """
        SELECT id, user_id, prefix, name, label, rpm_limit, status, last_used_at, created_at, revoked_at
        FROM api_keys WHERE buyer_id = $1 ORDER BY created_at DESC
        """,
        buyer_id,
    )
    orders = await db.pool().fetch(
        """SELECT id, sku, credits_micro, price_idr, status, key_id, created_at, granted_at
           FROM orders WHERE buyer_id = $1 ORDER BY created_at DESC LIMIT 50""",
        buyer_id,
    )
    usage = await db.pool().fetchrow(
        """SELECT count(*) requests, coalesce(sum(tokens_in),0) tokens_in,
                  coalesce(sum(tokens_out),0) tokens_out, coalesce(sum(cost_micro),0) cost_micro
           FROM usage_events WHERE key_id = ANY($1::text[]) AND created_at > now() - interval '30 days'""",
        [k["id"] for k in keys] or [""],
    )
    bal = await db.pool().fetchval(
        "SELECT coalesce(sum(balance_micro),0) FROM balances WHERE user_id = ANY($1::text[])",
        [k["user_id"] for k in keys] or [""],
    )
    return {
        "buyer": {**dict(buyer), "created_at": buyer["created_at"].isoformat()},
        "balance_micro": int(bal or 0),
        "usage_30d": dict(usage),
        "keys": [{**dict(k), "last_used_at": k["last_used_at"].isoformat() if k["last_used_at"] else None,
                  "created_at": k["created_at"].isoformat(),
                  "revoked_at": k["revoked_at"].isoformat() if k["revoked_at"] else None} for k in keys],
        "orders": [{**dict(o), "created_at": o["created_at"].isoformat(),
                    "granted_at": o["granted_at"].isoformat() if o["granted_at"] else None} for o in orders],
    }


@admin_ops.get("/keys")
async def admin_keys(status: str = "", q: str = "", limit: int = 200, _: dict = Depends(auth.require_admin)):
    limit = max(1, min(limit, 500))
    rows = await db.pool().fetch(
        """
        SELECT k.id, k.prefix, k.name, k.label, k.rpm_limit, k.rpm_override, k.status, k.last_used_at, k.created_at,
               k.revoked_at, k.buyer_id, b.tg_id, b.username, b.name AS buyer_name, u.email, u.id AS user_id,
               coalesce((SELECT sum(cost_micro) FROM usage_events e WHERE e.key_id = k.id),0) AS spend_micro,
               coalesce((SELECT count(*) FROM usage_events e WHERE e.key_id = k.id),0) AS requests
        FROM api_keys k
        LEFT JOIN buyers b ON b.id = k.buyer_id
        JOIN users u ON u.id = k.user_id
        WHERE ($1 = '' OR k.status = $1)
          AND ($2 = '' OR k.prefix ILIKE '%' || $2 || '%' OR b.username ILIKE '%' || $2 || '%' OR u.email ILIKE '%' || $2 || '%')
        ORDER BY k.created_at DESC LIMIT $3
        """,
        status, q, limit,
    )
    out = []
    for r in rows:
        item = dict(r)
        for field in ("last_used_at", "created_at", "revoked_at"):
            item[field] = r[field].isoformat() if r[field] else None
        bal = await db.pool().fetchval("SELECT coalesce(balance_micro,0) FROM balances WHERE user_id = $1", r["user_id"])
        item["balance_micro"] = int(bal or 0)
        out.append(item)
    return {"keys": out}


@admin_ops.patch("/keys/{key_id}")
async def admin_patch_key(key_id: str, body: KeyPatch, admin: dict = Depends(auth.require_admin)):
    row = await db.pool().fetchrow("SELECT id, prefix FROM api_keys WHERE id = $1", key_id)
    if row is None:
        raise _bad("not_found", "Key tidak ada", 404)
    sets, args = [], [key_id]
    if body.rpm_limit is not None:
        args.append(body.rpm_limit); sets.append(f"rpm_limit = ${len(args)}")
        sets.append("rpm_override = true")
    if body.status is not None:
        args.append(body.status); sets.append(f"status = ${len(args)}")
        if body.status == "active":
            sets.append("revoked_at = NULL")
    if body.label is not None:
        args.append(body.label); sets.append(f"label = ${len(args)}")
    if not sets:
        raise _bad("no_changes", "Tidak ada perubahan", 400)
    await db.pool().execute(f"UPDATE api_keys SET {', '.join(sets)} WHERE id = $1", *args)
    await db.log_audit(admin["email"], "admin.key_patch", key_id, body.dict(exclude_none=True))
    fresh = await db.pool().fetchrow(
        "SELECT id, prefix, rpm_limit, rpm_override, status, label FROM api_keys WHERE id = $1", key_id
    )
    return {"key": dict(fresh)}


@admin_ops.post("/keys/{key_id}/rotate")
async def admin_rotate_key(key_id: str, admin: dict = Depends(auth.require_admin)):
    row = await db.pool().fetchrow(
        "SELECT id, user_id, buyer_id, rpm_limit, label, name, prefix FROM api_keys WHERE id = $1", key_id
    )
    if row is None:
        raise _bad("not_found", "Key tidak ada", 404)
    raw, prefix, digest = _new_key()
    new_id = db.new_id()
    async with db.pool().acquire() as con:
        async with con.transaction():
            await con.execute("UPDATE api_keys SET revoked_at = now(), status = 'revoked' WHERE id = $1", key_id)
            await con.execute(
                """INSERT INTO api_keys(id, user_id, buyer_id, prefix, hash, name, label, rpm_limit, status)
                   VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'active')""",
                new_id, row["user_id"], row["buyer_id"], prefix, digest,
                row["name"], row["label"], row["rpm_limit"],
            )
    await db.log_audit(admin["email"], "admin.key_rotate", key_id, {"new": new_id})
    return {"api_key": raw, "prefix": prefix, "id": new_id}


@admin_ops.get("/orders")
async def admin_orders(limit: int = 100, _: dict = Depends(auth.require_admin)):
    limit = max(1, min(limit, 500))
    rows = await db.pool().fetch(
        """
        SELECT o.id, o.sku, o.credits_micro, o.price_idr, o.status, o.key_id, o.created_at, o.granted_at,
               b.tg_id, b.username, b.name AS buyer_name
        FROM orders o LEFT JOIN buyers b ON b.id = o.buyer_id
        ORDER BY o.created_at DESC LIMIT $1
        """,
        limit,
    )
    return {"orders": [{**dict(r), "created_at": r["created_at"].isoformat(),
                        "granted_at": r["granted_at"].isoformat() if r["granted_at"] else None} for r in rows]}


@admin_ops.post("/buyers/{buyer_id}/credit")
async def admin_credit_buyer(buyer_id: str, body: CreditIn, admin: dict = Depends(auth.require_admin)):
    keys = await db.pool().fetch("SELECT DISTINCT user_id FROM api_keys WHERE buyer_id = $1", buyer_id)
    if not keys:
        raise _bad("not_found", "Buyer belum punya key", 404)
    user_id = keys[0]["user_id"]
    micro = int(round(body.amount_idr * 1_000_000))
    await db.credit_user(user_id, micro, kind="manual", note=body.note, ref=f"admin:{admin['id']}")
    await db.log_audit(admin["email"], "admin.credit", buyer_id, {"amount_micro": micro, "note": body.note})
    return {"buyer_id": buyer_id, "balance_micro": await db.balance_micro(user_id)}


@admin_ops.get("/auth-failures")
async def admin_auth_failures(limit: int = 100, _: dict = Depends(auth.require_admin)):
    limit = max(1, min(limit, 500))
    rows = await db.pool().fetch(
        "SELECT scope, ident, ip, at FROM auth_failures ORDER BY at DESC LIMIT $1", limit
    )
    return {"failures": [{**dict(r), "at": r["at"].isoformat()} for r in rows]}
