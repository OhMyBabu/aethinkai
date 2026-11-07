"""TOTP (RFC 6238) — second factor for dashboard logins.

Deliberately dependency-free: HMAC-SHA1, 30 s step, 6 digits, one step of drift.
The counter that produced a valid code is stored on the user row so the same code
cannot be replayed inside its window (a stolen 6-digit code would otherwise be
usable for up to ~90 s).
"""
from __future__ import annotations

import base64
import hashlib
import hmac
import os
import struct
import time

STEP = 30
DIGITS = 6
ISSUER = "AethinkAI"


def new_secret() -> str:
    """160-bit base32 secret, no padding (what authenticator apps expect)."""
    return base64.b32encode(os.urandom(20)).decode().rstrip("=")


def _key(secret: str) -> bytes:
    pad = "=" * (-len(secret) % 8)
    return base64.b32decode(secret.upper() + pad)


def code_at(secret: str, counter: int) -> str:
    digest = hmac.new(_key(secret), struct.pack(">Q", counter), hashlib.sha1).digest()
    offset = digest[-1] & 0x0F
    value = struct.unpack(">I", digest[offset:offset + 4])[0] & 0x7FFFFFFF
    return f"{value % 10 ** DIGITS:0{DIGITS}d}"


def verify(secret: str, code: str, *, window: int = 1, now: float | None = None) -> int | None:
    """Return the matching counter, or None. `window=1` accepts ±30 s of clock drift."""
    code = (code or "").strip().replace(" ", "")
    if len(code) != DIGITS or not code.isdigit():
        return None
    current = int((now if now is not None else time.time()) // STEP)
    for delta in range(-window, window + 1):
        if hmac.compare_digest(code_at(secret, current + delta), code):
            return current + delta
    return None


def provisioning_uri(secret: str, email: str) -> str:
    from urllib.parse import quote
    label = quote(f"{ISSUER}:{email}", safe="")
    return (f"otpauth://totp/{label}?secret={secret}&issuer={quote(ISSUER)}"
            f"&algorithm=SHA1&digits={DIGITS}&period={STEP}")
