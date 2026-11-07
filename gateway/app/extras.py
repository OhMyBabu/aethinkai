"""Bansos (free public credit), model fallback chains, and live model monitor."""

from __future__ import annotations

import hashlib
import json
import secrets
import uuid
from datetime import datetime, timezone
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel, Field

from . import auth, db, upstream

PUBLIC_EMAIL = "bansos@aethink.ai"
MAX_PUBLIC_KEYS = 40

router = APIRouter(tags=["extras"])


def _id(prefix: str) -> str:
    return f"{prefix}_{uuid.uuid4().hex[:16]}"


def _ip(request: Request) -> str:
    for header in ("cf-connecting-ip", "x-real-ip", "x-forwarded-for"):
        value = request.headers.get(header)
        if value:
            return value.split(",")[0].strip()
    return request.client.host if request.client else "unknown"


def _norm_models(value: Any) -> list[str]:
    """asyncpg hands jsonb back as text; frontend needs a real array."""
    if isinstance(value, list):
        return value
    if isinstance(value, str):
        try:
            parsed = json.loads(value)
            return parsed if isinstance(parsed, list) else []
        except Exception:
            return []
    return []


def _program_out(row: dict) -> dict:
    out = dict(row)
    out["models"] = _norm_models(out.get("models"))
    return out


# --------------------------------------------------------------------- bansos
async def bansos_programs(active_only: bool = False) -> list[dict]:
    sql = "SELECT * FROM bansos_programs"
    if active_only:
        sql += " WHERE active"
    sql += " ORDER BY created_at DESC"
    return [_program_out(r) for r in await db.pool().fetch(sql)]


async def bansos_for(user_id: str, public_id: str | None) -> dict | None:
    """A grant the user can spend on this model right now (if wallet is dry)."""
    row = await db.pool().fetchrow(
        """
        SELECT g.id, g.program_id, g.amount_micro - g.used_micro AS remaining_micro, p.models, p.name
        FROM bansos_grants g
        JOIN bansos_programs p ON p.id = g.program_id
        WHERE g.user_id = $1 AND g.status = 'active' AND p.active
          AND g.amount_micro > g.used_micro
        ORDER BY g.created_at
        LIMIT 1
        """,
        user_id,
    )
    if row is None:
        return None
    models = _norm_models(row["models"])
    if models and public_id not in models:
        return None
    return dict(row)


async def bansos_charge(grant_id: str, amount_micro: int) -> None:
    await db.pool().execute(
        """
        UPDATE bansos_grants
        SET used_micro = least(amount_micro, used_micro + $2),
            status = CASE WHEN used_micro + $2 >= amount_micro THEN 'exhausted' ELSE status END,
            updated_at = now()
        WHERE id = $1
        """,
        grant_id, int(amount_micro),
    )


async def grant_auto(user_id: str) -> None:
    """Give a fresh signup whatever the active auto-grant programs allow."""
    progs = await db.pool().fetch(
        "SELECT id, credit_micro, per_user_limit FROM bansos_programs WHERE active AND auto_grant AND credit_micro > 0"
    )
    for prog in progs:
        used = await db.pool().fetchval(
            "SELECT count(*) FROM bansos_grants WHERE program_id = $1 AND user_id = $2",
            prog["id"], user_id,
        )
        if int(used or 0) >= int(prog["per_user_limit"] or 1):
            continue
        await db.pool().execute(
            """
            INSERT INTO bansos_grants(id, program_id, user_id, amount_micro, note)
            VALUES ($1,$2,$3,$4,'auto grant saat signup')
            """,
            _id("bg"), prog["id"], user_id, int(prog["credit_micro"]),
        )


class ProgramIn(BaseModel):
    name: str
    credit_idr: float = Field(ge=0)
    models: list[str] = Field(default_factory=list)
    auto_grant: bool = False
    per_user_limit: int = Field(default=1, ge=1, le=50)
    note: str | None = None
    active: bool = True


class ProgramPatch(BaseModel):
    name: str | None = None
    credit_idr: float | None = Field(default=None, ge=0)
    models: list[str] | None = None
    auto_grant: bool | None = None
    per_user_limit: int | None = Field(default=None, ge=1, le=50)
    note: str | None = None
    active: bool | None = None


class GrantsIn(BaseModel):
    program_id: str
    emails: list[str] = Field(default_factory=list)
    user_ids: list[str] = Field(default_factory=list)
    amount_idr: float | None = None
    note: str | None = None


class PublicKeyIn(BaseModel):
    program_id: str | None = None
    label: str | None = Field(default=None, max_length=40)


def _mask(key: str) -> str:
    return f"{key[:10]}••••••••{key[-4:]}" if len(key) > 20 else "sk-•••"


async def _public_user() -> str:
    row = await db.pool().fetchrow("SELECT id FROM users WHERE lower(email) = lower($1)", PUBLIC_EMAIL)
    if row:
        return str(row["id"])
    uid = db.new_id()
    await db.pool().execute(
        """
        INSERT INTO users(id, email, password_hash, role, plan, status, name)
        VALUES ($1, $2, $3, 'customer', 'bansos', 'active', 'Bansos Publik')
        """,
        uid, PUBLIC_EMAIL, auth.hash_password(secrets.token_hex(24)),
    )
    return uid


async def _public_grant(program_id: str) -> tuple[str, dict]:
    """One shared grant per program; every public key spends from it."""
    uid = await _public_user()
    row = await db.pool().fetchrow(
        """
        SELECT g.* FROM bansos_grants g
        WHERE g.program_id = $1 AND g.user_id = $2 AND g.status <> 'revoked'
        ORDER BY g.created_at LIMIT 1
        """,
        program_id, uid,
    )
    if row is None:
        credit = await db.pool().fetchval("SELECT credit_micro FROM bansos_programs WHERE id = $1", program_id)
        row = await db.pool().fetchrow(
            """
            INSERT INTO bansos_grants(id, program_id, user_id, amount_micro, note)
            VALUES ($1,$2,$3,$4,'grant publik') RETURNING *
            """,
            _id("bg"), program_id, uid, int(credit or 0),
        )
    return uid, dict(row)


def _key_out(row: dict) -> dict:
    raw = row["key_plain"]
    return {
        "id": row["id"],
        "masked": _mask(raw),
        "key": raw,
        "label": row.get("label"),
        "created_at": row.get("created_at"),
        "last_used_at": row.get("last_used_at"),
    }


async def ensure_program_key(program_id: str, rotate: bool = False) -> dict:
    """Exactly one shared key per program — everyone piles onto it and burns the same credit."""
    if not rotate:
        row = await db.pool().fetchrow(
            """
            SELECT p.id, p.key_plain, p.label, p.created_at, k.last_used_at
            FROM public_keys p JOIN api_keys k ON k.id = p.api_key_id
            WHERE p.program_id = $1 AND p.revoked_at IS NULL AND k.revoked_at IS NULL
            ORDER BY p.created_at DESC LIMIT 1
            """,
            program_id,
        )
        if row is not None:
            return _key_out(dict(row))

    olds = await db.pool().fetch(
        "SELECT api_key_id FROM public_keys WHERE program_id = $1 AND revoked_at IS NULL", program_id
    )
    for old in olds:
        await db.pool().execute("UPDATE api_keys SET revoked_at = now() WHERE id = $1", old["api_key_id"])
    await db.pool().execute(
        "UPDATE public_keys SET revoked_at = now() WHERE program_id = $1 AND revoked_at IS NULL", program_id
    )

    uid, _grant = await _public_grant(program_id)
    raw = "sk-bansos_" + secrets.token_hex(18)
    key_id = db.new_id()
    await db.pool().execute(
        "INSERT INTO api_keys(id, user_id, prefix, hash, name) VALUES ($1,$2,$3,$4,$5)",
        key_id, uid, raw[:16], hashlib.sha256(raw.encode()).hexdigest(), "bansos publik",
    )
    row = await db.pool().fetchrow(
        """
        INSERT INTO public_keys(id, program_id, api_key_id, key_plain, label)
        VALUES ($1,$2,$3,$4,'key bersama')
        RETURNING id, key_plain, label, created_at
        """,
        _id("pk"), program_id, key_id, raw,
    )
    out = dict(row)
    out["last_used_at"] = None
    return _key_out(out)


async def _bansos_snapshot(program: dict) -> dict:
    uid = await _public_user()
    grant = await db.pool().fetchrow(
        """
        SELECT id, amount_micro, used_micro FROM bansos_grants
        WHERE program_id = $1 AND user_id = $2 AND status <> 'revoked'
        ORDER BY created_at LIMIT 1
        """,
        program["id"], uid,
    )
    shared = await ensure_program_key(program["id"])
    stats = await db.pool().fetchrow(
        """
        SELECT count(*) AS requests,
               coalesce(sum(tokens_in), 0) AS tokens_in,
               coalesce(sum(tokens_out), 0) AS tokens_out
        FROM usage_events WHERE user_id = $1
        """,
        uid,
    )
    total = int(grant["amount_micro"]) if grant else 0
    used = int(grant["used_micro"]) if grant else 0
    return {
        "total_micro": total,
        "used_micro": used,
        "remaining_micro": max(total - used, 0),
        "shared_key": shared,
        "keys": [shared],
        "stats": {
            "requests": int(stats["requests"] or 0),
            "tokens_in": int(stats["tokens_in"] or 0),
            "tokens_out": int(stats["tokens_out"] or 0),
        },
    }


@router.get("/api/bansos")
async def public_bansos():
    programs = await bansos_programs(active_only=True)
    if not programs:
        return {"program": None, "total_micro": 0, "used_micro": 0, "remaining_micro": 0, "keys": [],
                "stats": {"requests": 0, "tokens_in": 0, "tokens_out": 0}, "base_url": "/v1"}
    primary = next((p for p in programs if p.get("models")), programs[0])
    snap = await _bansos_snapshot(primary)
    return {
        "program": {
            "id": primary["id"],
            "name": primary["name"],
            "models": primary["models"],
            "credit_idr": int(primary["credit_micro"]) / 1_000_000,
        },
        "programs": len(programs),
        **snap,
    }


@router.post("/api/admin/bansos/programs/{program_id}/rotate-key")
async def rotate_program_key(program_id: str, admin: dict = Depends(auth.require_admin)):
    program = await db.pool().fetchrow("SELECT * FROM bansos_programs WHERE id = $1", program_id)
    if program is None:
        raise HTTPException(404, {"error": {"message": "Program not found", "code": "not_found"}})
    key = await ensure_program_key(program_id, rotate=True)
    await db.log_audit(admin["email"], "bansos.key.rotate", program_id, {})
    return {"shared_key": key}


# ------------------------------------------------------- admin bansos programs
@router.get("/api/admin/bansos/programs")
async def list_programs(admin: dict = Depends(auth.require_admin)):
    progs = await bansos_programs()
    stats = await db.pool().fetch(
        """
        SELECT program_id,
               count(*) AS grants,
               count(*) FILTER (WHERE status = 'active') AS active_grants,
               coalesce(sum(amount_micro), 0) AS granted_micro,
               coalesce(sum(used_micro), 0) AS used_micro
        FROM bansos_grants GROUP BY program_id
        """
    )
    by_id = {r["program_id"]: dict(r) for r in stats}
    for p in progs:
        s = by_id.get(p["id"], {})
        p["grants"] = int(s.get("grants", 0))
        p["active_grants"] = int(s.get("active_grants", 0))
        p["granted_idr"] = int(s.get("granted_micro", 0)) / 1_000_000
        p["used_idr"] = int(s.get("used_micro", 0)) / 1_000_000
        p["shared_key"] = await ensure_program_key(p["id"])
    return {"programs": progs}


@router.post("/api/admin/bansos/programs", status_code=201)
async def create_program(body: ProgramIn, admin: dict = Depends(auth.require_admin)):
    pid = _id("bp")
    row = await db.pool().fetchrow(
        """
        INSERT INTO bansos_programs(id, name, active, credit_micro, models, auto_grant, per_user_limit, note, created_by)
        VALUES ($1,$2,$3,$4,$5::jsonb,$6,$7,$8,$9) RETURNING *
        """,
        pid, body.name.strip(), body.active, int(round(body.credit_idr * 1_000_000)),
        json.dumps(body.models), body.auto_grant, body.per_user_limit, body.note, admin["email"],
    )
    await db.log_audit(admin["email"], "bansos.program.create", body.name, {"id": pid})
    out = _program_out(row)
    out["shared_key"] = await ensure_program_key(pid)
    return {"program": out}


@router.patch("/api/admin/bansos/programs/{program_id}")
async def patch_program(program_id: str, body: ProgramPatch, admin: dict = Depends(auth.require_admin)):
    sets, args = [], [program_id]
    for key, value in body.model_dump(exclude_none=True).items():
        if key == "credit_idr":
            args.append(int(round(float(value) * 1_000_000)))
            sets.append(f"credit_micro = ${len(args)}")
        elif key == "models":
            args.append(json.dumps(value))
            sets.append(f"models = ${len(args)}::jsonb")
        else:
            args.append(value)
            sets.append(f"{key} = ${len(args)}")
    if not sets:
        raise HTTPException(400, {"error": {"message": "Nothing to update", "code": "empty_patch"}})
    row = await db.pool().fetchrow(
        f"UPDATE bansos_programs SET {', '.join(sets)} WHERE id = $1 RETURNING *", *args
    )
    if row is None:
        raise HTTPException(404, {"error": {"message": "Program not found", "code": "not_found"}})
    await db.log_audit(admin["email"], "bansos.program.update", program_id, {})
    return {"program": _program_out(row)}


@router.delete("/api/admin/bansos/programs/{program_id}")
async def delete_program(program_id: str, admin: dict = Depends(auth.require_admin)):
    await db.pool().execute("DELETE FROM bansos_programs WHERE id = $1", program_id)
    await db.log_audit(admin["email"], "bansos.program.delete", program_id, {})
    return {"ok": True}


# --------------------------------------------------------- admin bansos grants
@router.get("/api/admin/bansos/grants")
async def list_grants(program_id: str | None = None, limit: int = 100, admin: dict = Depends(auth.require_admin)):
    rows = await db.pool().fetch(
        """
        SELECT g.id, g.program_id, p.name AS program_name, g.user_id, u.email,
               g.amount_micro, g.used_micro, g.status, g.note, g.created_at,
               g.amount_micro - g.used_micro AS remaining_micro
        FROM bansos_grants g
        JOIN users u ON u.id = g.user_id
        JOIN bansos_programs p ON p.id = g.program_id
        WHERE ($1::text IS NULL OR g.program_id = $1)
        ORDER BY g.created_at DESC LIMIT $2
        """,
        program_id, min(max(limit, 1), 500),
    )
    return {"grants": [dict(r) for r in rows]}


@router.post("/api/admin/bansos/grants", status_code=201)
async def create_grants(body: GrantsIn, admin: dict = Depends(auth.require_admin)):
    program = await db.pool().fetchrow("SELECT * FROM bansos_programs WHERE id = $1", body.program_id)
    if program is None:
        raise HTTPException(404, {"error": {"message": "Program not found", "code": "not_found"}})

    targets: list[str] = list(body.user_ids)
    if body.emails:
        rows = await db.pool().fetch("SELECT id FROM users WHERE email = ANY($1::text[])", body.emails)
        targets += [r["id"] for r in rows]
    targets = list(dict.fromkeys(targets))
    if not targets:
        raise HTTPException(400, {"error": {"message": "No matching users", "code": "no_targets"}})

    amount = int(round((body.amount_idr if body.amount_idr is not None else program["credit_micro"] / 1_000_000) * 1_000_000))
    created = []
    for uid in targets:
        row = await db.pool().fetchrow(
            """
            INSERT INTO bansos_grants(id, program_id, user_id, amount_micro, note)
            VALUES ($1,$2,$3,$4,$5) RETURNING id, user_id, amount_micro
            """,
            _id("bg"), body.program_id, uid, amount, body.note,
        )
        created.append(dict(row))
    await db.log_audit(admin["email"], "bansos.grant.create", body.program_id, {"count": len(created)})
    return {"created": created}


@router.post("/api/admin/bansos/grants/{grant_id}/revoke")
async def revoke_grant(grant_id: str, admin: dict = Depends(auth.require_admin)):
    await db.pool().execute(
        "UPDATE bansos_grants SET status = 'revoked', updated_at = now() WHERE id = $1", grant_id
    )
    await db.log_audit(admin["email"], "bansos.grant.revoke", grant_id, {})
    return {"ok": True}


# ------------------------------------------------------------------ fallbacks
class FallbackIn(BaseModel):
    model_id: str
    fallback_model_id: str
    provider_label: str | None = None
    priority: int = 10
    active: bool = True


class FallbackPatch(BaseModel):
    fallback_model_id: str | None = None
    provider_label: str | None = None
    priority: int | None = None
    active: bool | None = None


async def fallbacks_for(route_model: str) -> list[str]:
    rows = await db.pool().fetch(
        """
        SELECT fallback_model_id FROM model_fallbacks
        WHERE model_id = $1 AND active ORDER BY priority, created_at
        """,
        route_model,
    )
    return [r["fallback_model_id"] for r in rows]


@router.get("/api/admin/fallbacks")
async def list_fallbacks(admin: dict = Depends(auth.require_admin)):
    rows = await db.pool().fetch(
        """
        SELECT f.*, coalesce(p.display_name, f.model_id) AS model_name,
               coalesce(p.public_id, split_part(f.model_id,'/',2)) AS public_id,
               coalesce(pf.display_name, f.fallback_model_id) AS fallback_name
        FROM model_fallbacks f
        LEFT JOIN model_prices p ON p.model_id = f.model_id
        LEFT JOIN model_prices pf ON pf.model_id = f.fallback_model_id
        ORDER BY f.model_id, f.priority
        """
    )
    return {"fallbacks": [dict(r) for r in rows]}


@router.post("/api/admin/fallbacks", status_code=201)
async def create_fallback(body: FallbackIn, admin: dict = Depends(auth.require_admin)):
    if body.model_id == body.fallback_model_id:
        raise HTTPException(400, {"error": {"message": "Fallback must differ from source", "code": "same_model"}})
    row = await db.pool().fetchrow(
        """
        INSERT INTO model_fallbacks(id, model_id, fallback_model_id, provider_label, priority, active)
        VALUES ($1,$2,$3,$4,$5,$6) RETURNING *
        """,
        _id("fb"), body.model_id, body.fallback_model_id, body.provider_label, body.priority, body.active,
    )
    await db.log_audit(admin["email"], "fallback.create", body.model_id, {"to": body.fallback_model_id})
    return {"fallback": dict(row)}


@router.patch("/api/admin/fallbacks/{fallback_id}")
async def patch_fallback(fallback_id: str, body: FallbackPatch, admin: dict = Depends(auth.require_admin)):
    sets, args = [], [fallback_id]
    for key, value in body.model_dump(exclude_none=True).items():
        args.append(value)
        sets.append(f"{key} = ${len(args)}")
    if not sets:
        raise HTTPException(400, {"error": {"message": "Nothing to update", "code": "empty_patch"}})
    row = await db.pool().fetchrow(
        f"UPDATE model_fallbacks SET {', '.join(sets)} WHERE id = $1 RETURNING *", *args
    )
    if row is None:
        raise HTTPException(404, {"error": {"message": "Fallback not found", "code": "not_found"}})
    return {"fallback": dict(row)}


@router.delete("/api/admin/fallbacks/{fallback_id}")
async def delete_fallback(fallback_id: str, admin: dict = Depends(auth.require_admin)):
    await db.pool().execute("DELETE FROM model_fallbacks WHERE id = $1", fallback_id)
    await db.log_audit(admin["email"], "fallback.delete", fallback_id, {})
    return {"ok": True}


@router.get("/api/admin/upstream/models")
async def upstream_models(admin: dict = Depends(auth.require_admin)):
    try:
        models = await upstream.list_models()
    except Exception as exc:
        raise HTTPException(502, {"error": {"message": f"Upstream unreachable: {exc}", "code": "upstream_error"}})
    data = models.get("data") if isinstance(models, dict) else models
    ids = sorted({m.get("id") for m in (data or []) if isinstance(m, dict) and m.get("id")})
    return {"models": ids}


# --------------------------------------------------------------- model monitor
@router.get("/api/admin/model-usage")
async def model_usage(days: int = 7, limit: int = 500, admin: dict = Depends(auth.require_admin)):
    """Model -> user -> IP breakdown of live traffic."""
    rows = await db.pool().fetch(
        """
        SELECT e.model_id,
               coalesce(p.display_name, e.model_id) AS display_name,
               coalesce(p.public_id, split_part(e.model_id, '/', 2)) AS public_id,
               coalesce(nullif(p.provider_label, ''), '') AS provider,
               u.id AS user_id, u.email,
               coalesce(e.client_ip, 'unknown') AS ip,
               coalesce(nullif(e.client_ua, ''), 'unknown') AS user_agent,
               count(*) AS requests,
               coalesce(sum(e.tokens_in), 0) AS tokens_in,
               coalesce(sum(e.tokens_out), 0) AS tokens_out,
               coalesce(sum(e.cost_micro), 0) AS cost_micro,
               max(e.created_at) AS last_seen
        FROM usage_events e
        JOIN users u ON u.id = e.user_id
        LEFT JOIN model_prices p ON p.model_id = e.model_id
        WHERE e.created_at > now() - ($1 || ' days')::interval
        GROUP BY e.model_id, p.display_name, p.public_id, p.provider_label, u.id, u.email, 7, 8
        ORDER BY requests DESC
        """,
        str(max(days, 1)),
    )

    models: dict[str, dict] = {}
    for row in rows:
        item = dict(row)
        m = models.setdefault(
            item["model_id"],
            {
                "model_id": item["model_id"],
                "display_name": item["display_name"],
                "public_id": item["public_id"],
                "provider": item["provider"] or _brand(item["model_id"]),
                "requests": 0, "tokens_in": 0, "tokens_out": 0, "cost_micro": 0,
                "users": {}, "last_seen": item["last_seen"],
            },
        )
        m["requests"] += int(item["requests"])
        m["tokens_in"] += int(item["tokens_in"])
        m["tokens_out"] += int(item["tokens_out"])
        m["cost_micro"] += int(item["cost_micro"])
        if str(item["last_seen"]) > str(m["last_seen"]):
            m["last_seen"] = item["last_seen"]

        u = m["users"].setdefault(
            item["user_id"],
            {
                "user_id": item["user_id"], "email": item["email"],
                "requests": 0, "tokens_in": 0, "tokens_out": 0, "cost_micro": 0, "ips": [],
            },
        )
        u["requests"] += int(item["requests"])
        u["tokens_in"] += int(item["tokens_in"])
        u["tokens_out"] += int(item["tokens_out"])
        u["cost_micro"] += int(item["cost_micro"])
        u["ips"].append(
            {
                "ip": item["ip"], "user_agent": item["user_agent"],
                "requests": int(item["requests"]),
                "tokens_in": int(item["tokens_in"]),
                "tokens_out": int(item["tokens_out"]),
                "last_seen": item["last_seen"],
            }
        )

    out = []
    for m in models.values():
        users = sorted(m["users"].values(), key=lambda u: u["requests"], reverse=True)
        for u in users:
            u["ips"].sort(key=lambda ip: ip["requests"], reverse=True)
            u["ip_count"] = len({ip["ip"] for ip in u["ips"]})
        m["users"] = users
        m["user_count"] = len(users)
        m["ip_count"] = len({ip["ip"] for u in users for ip in u["ips"]})
        out.append(m)
    out.sort(key=lambda m: m["requests"], reverse=True)
    return {"days": int(days), "models": out[: min(max(limit, 1), 200)]}


_BRANDS = [
    ("claude", "Anthropic"), ("deepseek", "DeepSeek"), ("glm", "Zhipu"),
    ("kimi", "Moonshot"), ("qwen", "Alibaba"), ("gemini", "Google"),
    ("mistral", "Mistral"), ("grok", "xAI"), ("gpt", "OpenAI"), ("minimax", "MiniMax"),
]


def _brand(model_id: str) -> str:
    low = (model_id or "").lower()
    for token, name in _BRANDS:
        if token in low:
            return name
    return "—"


# ------------------------------------------------------------------ provider routes
# A catalogue model is one promise; where it is served is a chain the operator owns.
class RouteIn(BaseModel):
    upstream_model: str
    provider_label: str | None = None
    priority: int = 10
    active: bool = True
    note: str | None = None


class RoutePatch(BaseModel):
    upstream_model: str | None = None
    provider_label: str | None = None
    priority: int | None = None
    active: bool | None = None
    note: str | None = None


class FallbackToggle(BaseModel):
    enabled: bool


def _route_id() -> str:
    return "rt_" + uuid.uuid4().hex[:16]


@router.get("/api/admin/routes")
async def list_routes(admin: dict = Depends(auth.require_admin)):
    rows = await db.pool().fetch(
        """
        SELECT r.*, coalesce(p.public_id, split_part(r.model_id,'/',2)) AS public_id,
               coalesce(p.display_name, r.model_id) AS display_name,
               p.fallback_enabled, p.context_window, p.max_output, p.active AS model_active
          FROM model_routes r
          LEFT JOIN model_prices p ON p.model_id = r.model_id
         ORDER BY r.model_id, r.priority, r.created_at
        """
    )
    return {"routes": [dict(r) for r in rows]}


@router.get("/api/admin/model-routes")
async def routes_for_model(model_id: str, admin: dict = Depends(auth.require_admin)):
    """One catalogue model's provider chain. model_id is a query param on purpose:
    a catalogue id contains a slash ('mr/glm-5.3') and path params mangle it."""
    rows = await db.pool().fetch(
        """SELECT * FROM model_routes WHERE model_id = $1 ORDER BY priority, created_at""",
        model_id,
    )
    meta = await db.pool().fetchrow(
        "SELECT public_id, display_name, fallback_enabled, context_window, max_output "
        "FROM model_prices WHERE model_id = $1", model_id)
    return {"model_id": model_id,
            "model": dict(meta) if meta else None,
            "routes": [dict(r) for r in rows]}


class NewRouteIn(RouteIn):
    model_id: str


@router.post("/api/admin/model-routes", status_code=201)
async def add_route(body: NewRouteIn, admin: dict = Depends(auth.require_admin)):
    exists = await db.pool().fetchval("SELECT 1 FROM model_prices WHERE model_id = $1", body.model_id)
    if not exists:
        raise HTTPException(404, {"error": {"message": "Model katalog tidak ada",
                                            "code": "model_not_found"}})
    label = body.provider_label or body.upstream_model.split("/")[0].split(":")[0]
    try:
        row = await db.pool().fetchrow(
            """INSERT INTO model_routes(id, model_id, upstream_model, provider_label,
                                        priority, active, note)
               VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *""",
            _route_id(), body.model_id, body.upstream_model, label, body.priority,
            body.active, body.note,
        )
    except Exception:
        raise HTTPException(409, {"error": {"message": "Route itu sudah terdaftar untuk model ini",
                                            "code": "duplicate_route"}})
    await db.log_audit(admin["email"], "route.create", body.model_id,
                       {"upstream": body.upstream_model, "priority": body.priority})
    return {"route": dict(row)}


@router.patch("/api/admin/model-fallback")
async def toggle_fallback(body: FallbackToggle, model_id: str,
                          admin: dict = Depends(auth.require_admin)):
    row = await db.pool().fetchrow(
        "UPDATE model_prices SET fallback_enabled = $2 WHERE model_id = $1 "
        "RETURNING model_id, fallback_enabled", model_id, body.enabled)
    if row is None:
        raise HTTPException(404, {"error": {"message": "Model katalog tidak ada",
                                            "code": "model_not_found"}})
    await db.log_audit(admin["email"], "model.fallback", model_id, {"enabled": body.enabled})
    return {"model_id": row["model_id"], "fallback_enabled": row["fallback_enabled"]}


@router.get("/api/admin/upstream/catalogue")
async def upstream_catalogue(q: str = "", limit: int = 60,
                             admin: dict = Depends(auth.require_admin)):
    """Router catalogue with the facts needed to pick a route: provider, ctx, max out."""
    try:
        data = (await upstream.list_models()).get("data", [])
    except Exception as exc:
        raise HTTPException(502, {"error": {"message": f"Router tidak terjangkau: {exc}",
                                            "code": "upstream_error"}})
    used = {r["upstream_model"] for r in await db.pool().fetch("SELECT upstream_model FROM model_routes")}
    needle = q.strip().lower()
    out = []
    for m in data:
        mid = m.get("id") or ""
        if needle and needle not in mid.lower():
            continue
        caps = m.get("capabilities") or {}
        out.append({
            "id": mid,
            "provider": mid.split("/")[0].split(":")[0],
            "context_window": m.get("context_length") or caps.get("contextWindow"),
            "max_output": m.get("max_completion_tokens") or caps.get("maxOutput"),
            "in_use": mid in used,
        })
    out.sort(key=lambda r: r["id"])
    return {"count": len(out), "models": out[:max(1, min(limit, 500))]}
