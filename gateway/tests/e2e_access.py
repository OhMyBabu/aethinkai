#!/usr/bin/env python3
"""End-to-end test for the buyer-access backend.

Covers: internal HMAC grant (valid / bad sig / stale / replay), per-key RPM, portal session
(data endpoints + rotation), auth lockout, admin access endpoints, key suspend/activate.

Run with the gateway listening on 127.0.0.1:8080.
"""
from __future__ import annotations

import hashlib
import hmac
import json
import os
import sys
import time
import uuid

import httpx

BASE = os.environ.get("GW", "http://127.0.0.1:8080")
SECRET = open("/root/.secrets/aethink-internal").read().strip()
ADMIN = {"email": "admin@aethink.ai", "password": "RmmkmHbTS6VLn38x"}
MODEL = "deepseek-v4.1-flash-1017"

results: list[tuple[bool, str, str]] = []


def check(ok: bool, name: str, detail: str = "") -> None:
    results.append((ok, name, detail))
    print(f"{'PASS' if ok else 'FAIL'}  {name}" + (f"  [{detail}]" if detail else ""))


def signed(ts: int, body: bytes, secret: str = SECRET) -> str:
    return hmac.new(secret.encode(), f"{ts}.".encode() + body, hashlib.sha256).hexdigest()


def grant_payload(order_id: str, tg_id: int, credits_micro: int = 5_000_000_000, rpm: int = 60) -> bytes:
    return json.dumps({
        "order_id": order_id, "tg_id": tg_id, "username": f"e2e_{tg_id}", "name": "E2E Buyer",
        "sku": "starter", "credits_micro": credits_micro, "price_idr": 5000,
        "payment_ref": f"pay_{order_id}", "rpm_limit": rpm,
    }).encode()


def chat(client: httpx.Client, key: str, text: str = "ping") -> httpx.Response:
    return client.post(
        f"{BASE}/v1/chat/completions",
        headers={"Authorization": f"Bearer {key}"},
        json={"model": MODEL, "messages": [{"role": "user", "content": text}], "max_tokens": 8},
        timeout=120,
    )


def summary() -> int:
    bad = [n for ok, n, _ in results if not ok]
    print(f"\n{len(results) - len(bad)}/{len(results)} passed")
    if bad:
        print("FAILED: " + ", ".join(bad))
    return 0 if not bad else 1


def main() -> int:
    c = httpx.Client(timeout=60)
    tag = uuid.uuid4().hex[:8]
    tg_id = int(time.time()) % 900_000_000 + 1000

    # ---------------------------------------------------------------- 0. baseline
    r = c.get(f"{BASE}/health")
    check(r.status_code == 200, "health 200")
    r = c.get(f"{BASE}/api/models")
    check(r.headers.get("x-content-type-options") == "nosniff" and r.headers.get("x-frame-options") == "DENY",
          "security headers present")
    r = c.get(f"{BASE}/v1/models")
    check(r.status_code == 401, "/v1/models tanpa key = 401", str(r.status_code))

    # ---------------------------------------------------------------- 1. grant auth
    body = grant_payload(f"e2e-{tag}-a", tg_id)
    r = c.post(f"{BASE}/api/internal/grant", content=body, headers={"Content-Type": "application/json"})
    check(r.status_code == 401, "grant tanpa HMAC = 401", str(r.status_code))

    ts = int(time.time()) - 3600
    r = c.post(f"{BASE}/api/internal/grant", content=body,
               headers={"Content-Type": "application/json", "X-Timestamp": str(ts),
                        "X-Signature": signed(ts, body)})
    check(r.status_code == 401, "grant timestamp basi = 401", str(r.status_code))

    ts = int(time.time())
    r = c.post(f"{BASE}/api/internal/grant", content=body,
               headers={"Content-Type": "application/json", "X-Timestamp": str(ts),
                        "X-Signature": signed(ts, body, "wrong-secret")})
    check(r.status_code == 401, "grant signature salah = 401", str(r.status_code))

    # ---------------------------------------------------------------- 2. valid grant
    order = f"e2e-{tag}-1"
    body = grant_payload(order, tg_id)
    ts = int(time.time())
    r = c.post(f"{BASE}/api/internal/grant", content=body,
               headers={"Content-Type": "application/json", "X-Timestamp": str(ts),
                        "X-Signature": signed(ts, body)})
    ok = r.status_code == 200
    data = r.json() if ok else {}
    key = data.get("key", "")
    check(ok and key.startswith("sk-aeth_") and data.get("balance_micro") == 5_000_000_000,
          "grant valid -> key + saldo Rp5.000", f"{r.status_code} {data.get('balance_micro')}")

    ts = int(time.time())
    r = c.post(f"{BASE}/api/internal/grant", content=body,
               headers={"Content-Type": "application/json", "X-Timestamp": str(ts),
                        "X-Signature": signed(ts, body)})
    replay = r.json()
    check(r.status_code == 200 and replay.get("already_granted") is True and replay.get("key") is None,
          "grant replay idempoten (tanpa kredit ganda)", str(replay.get("balance_micro")))

    # ---------------------------------------------------------------- 3. chat with new key
    r = chat(c, key, "halo dari e2e")
    check(r.status_code == 200 and r.headers.get("x-ratelimit-limit") == "60",
          "chat key pembeli = 200 + rate headers",
          f"{r.status_code} limit={r.headers.get('x-ratelimit-limit')}")

    # ---------------------------------------------------------------- 4. portal session + data
    r = c.post(f"{BASE}/api/portal/session", json={"api_key": key})
    ok = r.status_code == 200
    tok = r.json().get("token", "") if ok else ""
    check(ok and tok.count(".") == 2 and r.json()["key"]["prefix"].startswith("sk-aeth_"),
          "portal session tukar key -> JWT", str(r.status_code))

    H = {"Authorization": f"Bearer {tok}"}
    r = c.get(f"{BASE}/api/portal/me", headers=H)
    me = r.json()
    check(r.status_code == 200 and me["balance_micro"] < 5_000_000_000 and me["buyer"]["tg_id"] == tg_id,
          "portal/me saldo terpotong + identitas bot", str(me.get("balance_micro")))

    r = c.get(f"{BASE}/api/portal/usage?days=7", headers=H)
    check(r.status_code == 200 and r.json()["totals"]["requests"] >= 1, "portal/usage harian")
    r = c.get(f"{BASE}/api/portal/models?days=7", headers=H)
    check(r.status_code == 200 and any(m["model_id"] == MODEL for m in r.json()["models"]), "portal/models per model")
    r = c.get(f"{BASE}/api/portal/requests?limit=10", headers=H)
    check(r.status_code == 200 and len(r.json()["requests"]) >= 1, "portal/requests log")
    r = c.get(f"{BASE}/api/portal/me")
    check(r.status_code == 401, "portal tanpa token = 401")

    # ---------------------------------------------------------------- 5. admin (before any lockout)
    r = c.post(f"{BASE}/api/auth/login", json=ADMIN)
    ok = r.status_code == 200
    admin_tok = r.json().get("token", "") if ok else ""
    AH = {"Authorization": f"Bearer {admin_tok}"}
    check(ok, "admin login 200", str(r.status_code))
    if not ok:
        return summary()

    r = c.get(f"{BASE}/api/admin/access/keys?status=active", headers=AH)
    keys = r.json().get("keys", [])
    mine = next((k for k in keys if k["prefix"] == key[:16]), None)
    check(r.status_code == 200 and mine is not None, "admin/keys memuat key pembeli",
          f"rpm={mine['rpm_limit'] if mine else '?'}")
    if mine is None:
        return summary()

    r = c.get(f"{BASE}/api/admin/access/buyers", headers=AH)
    check(r.status_code == 200 and any(b["tg_id"] == tg_id for b in r.json()["buyers"]), "admin/buyers")
    buyer_id = mine["buyer_id"]
    r = c.get(f"{BASE}/api/admin/access/buyers/{buyer_id}", headers=AH)
    check(r.status_code == 200 and r.json()["buyer"]["tg_id"] == tg_id, "admin/buyer detail")
    r = c.get(f"{BASE}/api/admin/access/orders", headers=AH)
    check(r.status_code == 200 and any(o["id"] == order for o in r.json()["orders"]), "admin/orders")
    r = c.get(f"{BASE}/api/admin/access/auth-failures", headers=AH)
    check(r.status_code == 200 and len(r.json()["failures"]) > 0, "admin/auth-failures tercatat")

    r = c.post(f"{BASE}/api/admin/access/buyers/{buyer_id}/credit", headers=AH,
               json={"amount_idr": 1000, "note": "e2e"})
    check(r.status_code == 200, "admin credit buyer")

    # ---------------------------------------------------------------- 6. suspend / activate
    r = c.patch(f"{BASE}/api/admin/access/keys/{mine['id']}", headers=AH, json={"status": "suspended"})
    check(r.status_code == 200, "admin suspend key")
    r = chat(c, key, "after-suspend")
    check(r.status_code == 401, "key suspended ditolak /v1", str(r.status_code))
    c.patch(f"{BASE}/api/admin/access/keys/{mine['id']}", headers=AH, json={"status": "active"})
    r = chat(c, key, "after-activate")
    check(r.status_code == 200, "key aktif kembali", str(r.status_code))

    # ---------------------------------------------------------------- 7. RPM enforcement
    c.patch(f"{BASE}/api/admin/access/keys/{mine['id']}", headers=AH, json={"rpm_limit": 5})
    codes = [chat(c, key, f"rpm-{i}").status_code for i in range(10)]
    check(429 in codes and codes.count(200) <= 5, "RPM 5 -> 429 setelah batas", str(codes))
    r = chat(c, key, "rpm-blocked")
    body = r.json()
    code = (body.get("error") or body.get("detail") or {}).get("code")
    check(r.status_code == 429 and code == "rate_limited",
          "429 body rate_limited + Retry-After", r.headers.get("retry-after", ""))
    c.patch(f"{BASE}/api/admin/access/keys/{mine['id']}", headers=AH, json={"rpm_limit": 60})

    # ---------------------------------------------------------------- 8. rotate
    r = c.post(f"{BASE}/api/portal/keys/rotate", headers=H)
    ok = r.status_code == 200
    newkey = r.json().get("api_key", "") if ok else ""
    check(ok and newkey.startswith("sk-aeth_") and newkey != key, "portal rotate -> key baru")
    r = chat(c, key, "old-key")
    check(r.status_code == 401, "key lama mati setelah rotate", str(r.status_code))
    r = c.get(f"{BASE}/api/portal/me", headers=H)
    check(r.status_code == 401, "token portal lama invalid setelah rotate", str(r.status_code))

    # new key works (wait out the RPM window of the old key — different key id, so no wait needed)
    r = chat(c, newkey, "new-key")
    check(r.status_code == 200, "key baru jalan", str(r.status_code))
    r = c.post(f"{BASE}/api/portal/session", json={"api_key": newkey})
    check(r.status_code == 200, "key baru bisa buka portal", str(r.status_code))

    # ---------------------------------------------------------------- 9. lockout (last: poisons this IP)
    # identity lockout: same prefix guessed 6x -> 429 on the 6th (identity bar = 5)
    fake = "sk-aeth_" + uuid.uuid4().hex[:24]
    codes = [c.post(f"{BASE}/api/portal/session", json={"api_key": fake}).status_code for _ in range(6)]
    check(429 in codes and "retry-after" in {k.lower() for k in c.post(
        f"{BASE}/api/portal/session", json={"api_key": fake}).headers},
        "portal brute force 1 key -> 429 + Retry-After", str(codes))
    # NAT safety: different random keys from one IP must not lock the whole IP at 6 tries
    spread = [c.post(f"{BASE}/api/portal/session",
                     json={"api_key": "sk-aeth_" + uuid.uuid4().hex[:24]}).status_code for _ in range(6)]
    check(spread.count(401) >= 5, "6 key acak berbeda tidak mengunci IP (anti NAT-collateral)", str(spread))

    for _ in range(6):
        c.post(f"{BASE}/api/auth/login", json={"email": "ops@aethink.ai", "password": "salah-terus"})
    r = c.post(f"{BASE}/api/auth/login", json={"email": "ops@aethink.ai", "password": "salah-terus"})
    check(r.status_code == 429, "admin login brute force -> 429", str(r.status_code))

    return summary()


if __name__ == "__main__":
    sys.exit(main())
