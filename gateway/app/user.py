"""User-facing API: login, balance, usage, API keys."""

import hashlib
import secrets
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel, Field

from . import auth, db
from .ratelimit import auth_lock, signup as signup_window

router = APIRouter(prefix="/api", tags=["user"])


class LoginIn(BaseModel):
    email: str
    password: str


class KeyIn(BaseModel):
    name: str = Field(default="default", max_length=40)


def _new_key() -> tuple[str, str, str]:
    raw = "sk-aeth_" + secrets.token_hex(24)
    return raw, raw[:16], hashlib.sha256(raw.encode()).hexdigest()


@router.post("/auth/login")
async def login(body: LoginIn, request: Request):
    ip = (request.headers.get("cf-connecting-ip") or request.headers.get("x-real-ip")
          or (request.headers.get("x-forwarded-for") or "").split(",")[0].strip()
          or (request.client.host if request.client else "unknown"))
    email = body.email.strip().lower()
    # scoped per (email, ip): no global email lock, so one attacker cannot lock the admin out
    locks = (f"ip:login:{ip}", f"login_email:{email}:{ip}")
    wait = auth_lock.check(*locks)
    if wait:
        raise HTTPException(
            429,
            {"error": {"message": f"Terlalu banyak percobaan. Coba lagi dalam {wait}s",
                       "code": "too_many_attempts"}},
            headers={"Retry-After": str(wait)},
        )

    row = await db.pool().fetchrow(
        "SELECT id, email, password_hash, role, status FROM users WHERE lower(email) = lower($1)",
        body.email.strip(),
    )
    if row is None or not auth.verify_password(body.password, row["password_hash"]):
        block = auth_lock.fail(900, *locks)
        try:
            await db.pool().execute(
                "INSERT INTO auth_failures(scope, ident, ip) VALUES ('admin_login',$1,$2)", email[:60], ip
            )
        except Exception:
            pass
        if block:
            raise HTTPException(
                429,
                {"error": {"message": f"Terlalu banyak percobaan. Coba lagi dalam {block}s",
                           "code": "too_many_attempts"}},
                headers={"Retry-After": str(block)},
            )
        raise HTTPException(401, {"error": {"message": "Email atau password salah", "code": "invalid_credentials"}})
    if row["status"] != "active":
        raise HTTPException(403, {"error": {"message": "Akun tidak aktif", "code": "account_suspended"}})
    auth_lock.reset(*locks)
    token = auth.issue_token(str(row["id"]), row["role"])
    await db.log_audit(row["email"], "auth.login", str(row["id"]), None)
    return {"token": token, "user": {"id": str(row["id"]), "email": row["email"], "role": row["role"]}}


@router.get("/me")
async def me(user: dict = Depends(auth.current_user)):
    balance = await db.balance_micro(str(user["id"]))
    return {"user": user, "balance_micro": balance, "balance_idr": balance / 1_000_000}


@router.get("/me/usage")
async def my_usage(days: int = 7, user: dict = Depends(auth.current_user)):
    rows = await db.pool().fetch(
        """
        SELECT date_trunc('day', created_at) AS day, model_id,
               count(*) AS requests,
               coalesce(sum(tokens_in),0) AS tokens_in,
               coalesce(sum(tokens_out),0) AS tokens_out,
               coalesce(sum(cost_micro),0) AS cost_micro
        FROM usage_events
        WHERE user_id = $1 AND created_at > now() - ($2 || ' days')::interval
        GROUP BY 1, 2 ORDER BY 1 DESC
        """,
        str(user["id"]), str(days),
    )
    totals = await db.pool().fetchrow(
        """
        SELECT count(*) AS requests, coalesce(sum(cost_micro),0) AS cost_micro,
               coalesce(sum(tokens_in),0) AS tokens_in, coalesce(sum(tokens_out),0) AS tokens_out
        FROM usage_events WHERE user_id = $1 AND created_at > now() - ($2 || ' days')::interval
        """,
        str(user["id"]), str(days),
    )
    return {"days": days, "total": dict(totals), "by_day_model": [dict(r) for r in rows]}


@router.get("/keys")
async def list_keys(user: dict = Depends(auth.current_user)):
    rows = await db.pool().fetch(
        """
        SELECT id, prefix, name, created_at, last_used_at, revoked_at
        FROM api_keys WHERE user_id = $1 ORDER BY created_at DESC
        """,
        str(user["id"]),
    )
    return {"keys": [dict(r) for r in rows]}


@router.post("/keys", status_code=201)
async def create_key(body: KeyIn, user: dict = Depends(auth.current_user)):
    active = await db.pool().fetchval(
        "SELECT count(*) FROM api_keys WHERE user_id = $1 AND revoked_at IS NULL", str(user["id"])
    )
    if int(active) >= 10:
        raise HTTPException(409, {"error": {"message": "Maksimal 10 API key aktif", "code": "key_limit"}})
    raw, prefix, digest = _new_key()
    row = await db.pool().fetchrow(
        """
        INSERT INTO api_keys(id, user_id, prefix, hash, name)
        VALUES ($1,$2,$3,$4,$5) RETURNING id, prefix, name, created_at
        """,
        db.new_id(), str(user["id"]), prefix, digest, body.name,
    )
    await db.log_audit(user["email"], "key.create", row["id"], {"name": body.name})
    return {"key": raw, "meta": dict(row), "notice": "Simpan sekarang — key tidak ditampilkan lagi."}


@router.delete("/keys/{key_id}")
async def revoke_key(key_id: str, user: dict = Depends(auth.current_user)):
    row = await db.pool().fetchrow(
        "UPDATE api_keys SET revoked_at = now() WHERE id = $1 AND user_id = $2 RETURNING id",
        key_id, str(user["id"]),
    )
    if row is None:
        raise HTTPException(404, {"error": {"message": "Key tidak ditemukan", "code": "not_found"}})
    await db.log_audit(user["email"], "key.revoke", key_id, None)
    return {"revoked": key_id}

class RenameIn(BaseModel):
    name: str


@router.patch("/keys/{key_id}")
async def rename_key(key_id: str, body: RenameIn, user: dict = Depends(auth.current_user)):
    name = body.name.strip()
    if len(name) < 3:
        raise HTTPException(422, {"error": {"message": "Nama minimal 3 karakter", "code": "invalid_name"}})
    row = await db.pool().fetchrow(
        "UPDATE api_keys SET name = $1 WHERE id = $2 AND user_id = $3 RETURNING id, name",
        name, key_id, str(user["id"]),
    )
    if row is None:
        raise HTTPException(404, {"error": {"message": "Key tidak ditemukan", "code": "not_found"}})
    await db.log_audit(user["email"], "key.rename", key_id, {"name": name})
    return dict(row)

class SignupIn(BaseModel):
    email: str = Field(min_length=5)
    password: str = Field(min_length=8)
    name: str | None = None


@router.post("/auth/signup", status_code=201)
async def signup(body: SignupIn, request: Request):
    # signups auto-grant bansos credit, so they are capped per IP to stop credit farming
    ip = (request.headers.get("cf-connecting-ip") or request.headers.get("x-real-ip")
          or (request.headers.get("x-forwarded-for") or "").split(",")[0].strip()
          or (request.client.host if request.client else "unknown"))
    ok, _, reset = signup_window.allow(f"signup:{ip}", 5, 3600)
    if not ok:
        raise HTTPException(
            429,
            {"error": {"message": f"Terlalu banyak pendaftaran dari jaringan ini. Coba lagi dalam {int(reset)}s",
                       "code": "signup_rate_limited"}},
            headers={"Retry-After": str(int(reset))},
        )
    email = body.email.strip().lower()
    if "@" not in email:
        raise HTTPException(422, {"error": {"message": "Email tidak valid", "code": "invalid_email"}})
    exists = await db.pool().fetchval("SELECT 1 FROM users WHERE lower(email) = $1", email)
    if exists:
        raise HTTPException(409, {"error": {"message": "Email sudah terdaftar", "code": "email_taken"}})
    user_id = db.new_id()
    await db.pool().execute(
        """
        INSERT INTO users(id, email, password_hash, role, plan, status, name)
        VALUES ($1, $2, $3, 'customer', 'starter', 'active', $4)
        """,
        user_id, email, auth.hash_password(body.password), body.name,
    )
    await db.credit_user(user_id, 0, kind="opening", note="akun baru")
    await db.log_audit(email, "auth.signup", user_id, None)
    # public bansos: auto-grant new signups when a program asks for it
    from .extras import grant_auto
    await grant_auto(user_id)
    return {"user": {"id": user_id, "email": email, "role": "customer"}}


@router.get("/me/ledger")
async def my_ledger(limit: int = 50, user: dict = Depends(auth.current_user)):
    rows = await db.list_ledger(str(user["id"]), min(max(limit, 1), 200))
    return {"ledger": rows}


@router.get("/me/summary")
async def my_summary(user: dict = Depends(auth.current_user)):
    uid = str(user["id"])
    balance = await db.balance_micro(uid)
    row = await db.pool().fetchrow(
        """
        SELECT
          coalesce(sum(cost_micro) FILTER (WHERE created_at > now() - interval '30 days'), 0) AS spend_30d,
          coalesce(sum(cost_micro) FILTER (WHERE created_at::date = now()::date), 0)          AS spend_today,
          count(*) FILTER (WHERE created_at > now() - interval '30 days')                     AS requests_30d,
          max(created_at)                                                                      AS last_request
        FROM usage_events WHERE user_id = $1
        """,
        uid,
    )
    return {"balance_micro": balance, "balance_idr": balance / 1_000_000, **dict(row)}

@router.get("/me/requests")
async def my_requests(limit: int = 50, days: int = 7, user: dict = Depends(auth.current_user)):
    rows = await db.pool().fetch(
        """
        SELECT e.id, e.model_id, e.tokens_in, e.tokens_out, e.cost_micro,
               e.latency_ms, e.status, e.created_at, k.name AS key_name,
               coalesce(p.display_name, e.model_id) AS display_name
        FROM usage_events e
        LEFT JOIN api_keys k ON k.id = e.key_id
        LEFT JOIN model_prices p ON p.model_id = e.model_id
        WHERE e.user_id = $1 AND e.created_at > now() - ($2 || ' days')::interval
        ORDER BY e.created_at DESC
        LIMIT $3
        """,
        str(user["id"]), str(max(days, 1)), min(max(limit, 1), 500),
    )
    return {"requests": [dict(r) for r in rows]}

