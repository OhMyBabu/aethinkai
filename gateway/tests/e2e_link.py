#!/usr/bin/env python3
"""E2E: Telegram account linking + web purchase (no email, no password).

Flow under test: web asks for a code -> bot confirms it (HMAC) -> browser polls and gets a
read-only portal session -> buyer orders from the web -> admin grants -> key lands in the bot.
"""
import hashlib
import hmac
import json
import os
import sys
import time

import httpx

B = "http://127.0.0.1:8080"
SEC = open("/root/.secrets/aethink-internal").read().strip()
TG = 541900896
c = httpx.Client(timeout=30)
passed = failed = 0


def check(name: str, cond: bool, detail: str = "") -> None:
    global passed, failed
    if cond:
        passed += 1
        print(f"PASS {name}")
    else:
        failed += 1
        print(f"FAIL {name} {detail}")


def post(path: str, payload: dict) -> httpx.Response:
    body = json.dumps(payload, separators=(",", ":")).encode()
    ts = int(time.time())
    sig = hmac.new(SEC.encode(), f"{ts}.".encode() + body, hashlib.sha256).hexdigest()
    return c.post(B + path, content=body,
                  headers={"Content-Type": "application/json", "X-Timestamp": str(ts), "X-Signature": sig})


def sget(path: str, what: str) -> httpx.Response:
    ts = int(time.time())
    sig = hmac.new(SEC.encode(), f"{ts}.{what}".encode(), hashlib.sha256).hexdigest()
    return c.get(B + path, headers={"X-Timestamp": str(ts), "X-Signature": sig})


# 1. catalogue is public and shared with the bot
r = c.get(B + "/api/packages")
pkgs = r.json().get("packages", [])
check("packages public", r.status_code == 200 and len(pkgs) >= 3)
check("package shape", all({"sku", "idr", "rpm", "credits_micro"} <= set(p) for p in pkgs))
sku = pkgs[0]["sku"]
price = pkgs[0]["idr"]

# 2. start -> pending
r = c.post(B + "/api/portal/telegram/start")
d = r.json()
check("start 200", r.status_code == 200)
check("deep link shape", d["deep_link"].startswith("https://t.me/") and "start=link_" in d["deep_link"])
code = d["code"]
check("status pending", c.get(B + "/api/portal/telegram/status", params={"code": code}).json()["status"] == "pending")

# 3. unsigned confirm rejected
r = c.post(B + "/api/internal/link/confirm", json={"code": code, "tg_id": TG})
check("confirm without hmac 401", r.status_code == 401, str(r.status_code))

# 4. bot confirms
r = post("/api/internal/link/confirm", {"code": code, "tg_id": TG, "username": "aldi", "name": "Aldi"})
check("confirm 200", r.status_code == 200, r.text[:120])
buyer_id = r.json().get("buyer_id")
check("buyer id", bool(buyer_id))

# 5. first poll issues exactly one session, second poll says consumed
st = c.get(B + "/api/portal/telegram/status", params={"code": code}).json()
check("status confirmed", st["status"] == "confirmed")
check("token issued", bool(st.get("token")))
check("buyer echoed", (st.get("buyer") or {}).get("tg_id") == TG)
again = c.get(B + "/api/portal/telegram/status", params={"code": code}).json()
check("code single use", again["status"] == "consumed", str(again["status"]))
check("reuse confirm 409", post("/api/internal/link/confirm", {"code": code, "tg_id": TG}).status_code == 409)

H = {"Authorization": f"Bearer {st['token']}"}

# 6. session reads buyer data (key may be absent for a fresh buyer)
me = c.get(B + "/api/portal/me", headers=H)
check("me 200", me.status_code == 200, me.text[:120])
body = me.json()
check("me buyer", (body.get("buyer") or {}).get("tg_id") == TG)
before = int(body.get("balance_micro") or 0)
check("me has keys list", isinstance(body.get("keys"), list))

# 7. order from the web
r = c.post(B + "/api/portal/order", headers=H, json={"sku": sku})
check("order 200", r.status_code == 200, r.text[:120])
order_id = r.json().get("order_id")
check("order price", r.json().get("price_idr") == price)
check("order starts pending", c.get(B + "/api/portal/orders", headers=H).json()["orders"][0]["status"] == "pending")

# 8. it lands in the bot's admin queue
pend = sget("/api/internal/pending", "pending").json()["orders"]
check("visible in bot pending", any(o["id"] == order_id for o in pend))
check("pending carries tg_id", any(o["id"] == order_id and o["tg_id"] == TG for o in pend))

# 9. grant once, idempotent on repeat
g1 = post(f"/api/internal/order/{order_id}/grant", {})
g2 = post(f"/api/internal/order/{order_id}/grant", {})
check("grant 200", g1.status_code == 200, g1.text[:120])
check("grant idempotent", g2.status_code == 200)
after = int(c.get(B + "/api/portal/me", headers=H).json()["balance_micro"])
credits = pkgs[0]["credits_micro"]
check("balance credited once", after - before == credits, f"{after - before} vs {credits}")
orders = c.get(B + "/api/portal/orders", headers=H).json()["orders"]
check("order granted", orders[0]["status"] == "granted")
check("grant timestamp set", bool(orders[0]["granted_at"]))

# 10. usage endpoints still answer for a buyer session
check("usage 200", c.get(B + "/api/portal/usage?days=7", headers=H).status_code == 200)
check("models 200", c.get(B + "/api/portal/models?days=7", headers=H).status_code == 200)
check("requests 200", c.get(B + "/api/portal/requests?limit=5", headers=H).status_code == 200)

# 11. unknown sku + bad token
check("unknown sku 400", c.post(B + "/api/portal/order", headers=H, json={"sku": "nope"}).status_code == 400)
check("bad token 401", c.get(B + "/api/portal/me", headers={"Authorization": "Bearer junk"}).status_code == 401)
check("expired/unknown code", c.get(B + "/api/portal/telegram/status", params={"code": "lnk_missing"}).json()["status"] == "unknown")

print(f"\n{passed} passed, {failed} failed")
sys.exit(0 if failed == 0 else 1)
