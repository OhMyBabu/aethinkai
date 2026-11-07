"""Password hashing (PBKDF2-SHA256) + JWT sessions."""

import hashlib
import hmac
import os
import secrets
from datetime import datetime, timedelta, timezone
from typing import Any, Optional

import jwt
from fastapi import Depends, Header, HTTPException

from . import db

ALGO = "pbkdf2_sha256"
ITERATIONS = 120_000


def _load_secret() -> str:
    path = "/root/.secrets/aethink-jwt"
    try:
        return open(path).read().strip()
    except FileNotFoundError:
        os.makedirs("/root/.secrets", exist_ok=True)
        val = secrets.token_hex(32)
        with open(path, "w") as fh:
            fh.write(val)
        os.chmod(path, 0o600)
        return val


JWT_SECRET = _load_secret()
JWT_ALG = "HS256"
TTL_HOURS = 24


def hash_password(password: str, salt: Optional[str] = None) -> str:
    salt = salt or secrets.token_hex(16)
    digest = hashlib.pbkdf2_hmac("sha256", password.encode(), bytes.fromhex(salt), ITERATIONS).hex()
    return f"{ALGO}${ITERATIONS}${salt}${digest}"


def verify_password(password: str, stored: str) -> bool:
    try:
        algo, iters, salt, digest = stored.split("$", 3)
        if algo != ALGO:
            return False
        calc = hashlib.pbkdf2_hmac("sha256", password.encode(), bytes.fromhex(salt), int(iters)).hex()
        return hmac.compare_digest(calc, digest)
    except Exception:
        return False


def issue_token(user_id: str, role: str) -> str:
    payload = {
        "sub": user_id,
        "role": role,
        "iat": datetime.now(timezone.utc),
        "exp": datetime.now(timezone.utc) + timedelta(hours=TTL_HOURS),
    }
    return jwt.encode(payload, JWT_SECRET, algorithm=JWT_ALG)


async def current_user(authorization: str | None = Header(default=None)) -> dict[str, Any]:
    if not authorization or not authorization.lower().startswith("bearer "):
        raise HTTPException(401, {"error": {"message": "Missing session", "code": "missing_session"}})
    token = authorization.split(" ", 1)[1].strip()
    try:
        payload = jwt.decode(token, JWT_SECRET, algorithms=[JWT_ALG])
    except Exception:
        raise HTTPException(401, {"error": {"message": "Invalid session", "code": "invalid_session"}})
    row = await db.pool().fetchrow(
        "SELECT id, email, role, plan, status FROM users WHERE id = $1", payload.get("sub")
    )
    if row is None or row["status"] != "active":
        raise HTTPException(401, {"error": {"message": "Account unavailable", "code": "account_unavailable"}})
    return dict(row)


async def require_admin(user: dict = Depends(current_user)) -> dict[str, Any]:
    if user["role"] != "admin":
        raise HTTPException(403, {"error": {"message": "Admin only", "code": "forbidden"}})
    return user
