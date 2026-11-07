#!/usr/bin/env python3
"""Adversarial suite — money integrity + authorization boundaries.

Not a happy-path test: every case here tries to *take* something (free credits,
another tenant's data, admin power) or to break an invariant (wallet never
negative, Σledger == Σwallet, no stale holds, no 5xx from hostile input).

Run against a live gateway on 127.0.0.1:8080:
    ./gateway/.venv/bin/python gateway/tests/adversarial.py
"""
from __future__ import annotations

import hashlib
import hmac
import json
import os
import subprocess
import sys
import time
import uuid
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

import httpx

BASE = os.environ.get("GW", "http://127.0.0.1:8080")
SECRET = open(os.environ.get("AETHINK_INTERNAL_FILE", "/root/.secrets/aethink-internal")).read().strip()
DB_URL = [l.split("=", 1)[1].strip() for l in open("/root/.secrets/aethink-db.env")
          if l.startswith("DATABASE_URL=")][0]

CHEAP = "deepseek-v4.1-flash-1017"   # 2.400 / 9.750 IDR per 1M — ~80 micro per tiny reply
results: list[tuple[bool, str, str]] = []


def check(ok: bool, name: str, detail: str = "") -> None:
    results.append((ok, name, detail))
    print(f"{'PASS' if ok else 'FAIL'}  {name}" + (f"  [{detail}]" if detail else ""))


def sql(q: str) -> str:
    return subprocess.run(["psql", DB_URL, "-tAc", q], capture_output=True, text=True).stdout.strip()


def signed(ts: int, body: bytes) -> str:
    return hmac.new(SECRET.encode(), f"{ts}.".encode() + body, hashlib.sha256).hexdigest()


def admin_token(c: httpx.Client) -> str:
    f = Path(__file__).resolve().parent.parent / ".admin"
    creds = {"email": "admin@aethink.ai", "password": os.environ.get("AETHINK_ADMIN_PASSWORD", "")}
    if f.exists():
        for line in f.read_text().splitlines():
            p = line.split()
            if len(p) == 3 and p[0] == "admin":
                creds = {"email": p[1], "password": p[2]}
    r = c.post(f"{BASE}/api/auth/login", json=creds)
    assert r.status_code == 200, f"admin login {r.status_code} {r.text[:120]}"
    j = r.json()
    return j.get("token") or j.get("access_token")


def grant(c: httpx.Client, tg_id: int, credits_micro: int, rpm: int = 60) -> str:
    """Provision a buyer through the bot→gateway HMAC path; returns the API key."""
    order_id = f"adv-{uuid.uuid4().hex[:10]}"
    body = json.dumps({
        "order_id": order_id, "tg_id": tg_id, "username": f"adv_{tg_id}", "name": "Adv",
        "sku": "starter", "credits_micro": credits_micro, "price_idr": 1,
        "payment_ref": f"p_{order_id}", "rpm_limit": rpm,
    }).encode()
    ts = int(time.time())
    r = c.post(f"{BASE}/api/internal/grant", content=body,
               headers={"content-type": "application/json", "x-timestamp": str(ts),
                        "x-signature": signed(ts, body)})
    assert r.status_code == 200, f"grant {r.status_code} {r.text[:200]}"
    j = r.json()
    return j.get("api_key") or j["key"]


def chat(c: httpx.Client, key: str, model: str = CHEAP, max_tokens: int = 8) -> httpx.Response:
    return c.post(f"{BASE}/v1/chat/completions",
                  headers={"Authorization": f"Bearer {key}"},
                  json={"model": model, "messages": [{"role": "user", "content": "say ok"}],
                        "max_tokens": max_tokens}, timeout=120)


def main() -> int:
    c = httpx.Client(timeout=120)
    tg = int(time.time()) % 800_000_000 + 1000

    # ---------------------------------------------------------------- 1. double spend
    key = grant(c, tg, credits_micro=6_000, rpm=600)   # ~enough for a couple of tiny replies
    with ThreadPoolExecutor(max_workers=8) as ex:
        rs = list(ex.map(lambda _: chat(c, key), range(8)))
    codes = [r.status_code for r in rs]
    ok = [x for x in codes if x == 200]
    broke = [x for x in codes if x == 402]
    def wallet(tg_id: int) -> int:
        """One buyer can hold several keys; all of them debit the same wallet."""
        return int(sql("select coalesce(sum(b.balance_micro),0) from balances b where b.user_id in ("
                       "select distinct k.user_id from api_keys k join buyers y on y.id=k.buyer_id "
                       f"where y.tg_id={tg_id})"))

    bal = wallet(tg)
    check(bal >= 0, "wallet never negative after 8 parallel calls", f"balance={bal} micro, 200s={len(ok)}, 402s={len(broke)}")
    check(len(ok) >= 1, "at least one call served with tiny credit", f"{len(ok)}/8")
    check(len(ok) * 1000 <= 6_000 + 1000, "charged no more than credit granted", f"{len(ok)} x ~80 micro")

    # ---------------------------------------------------------------- 2. scope escalation
    buyer = c.post(f"{BASE}/api/tg/session", json={"initData": "x"})  # expected 401, just probing shape
    portal = c.post(f"{BASE}/api/tg/session", headers={"x-test": "1"})
    # real buyer JWT: mint through the internal identity path used by the bot panel
    me = c.get(f"{BASE}/api/portal/me", headers={"Authorization": f"Bearer {key}"})
    check(me.status_code in (400, 401), "API key cannot read portal", str(me.status_code))
    check(buyer.status_code in (400, 401, 422), "bad initData rejected", str(buyer.status_code))
    tok = admin_token(c)
    r = c.get(f"{BASE}/api/admin/summary", headers={"Authorization": f"Bearer {key}"})
    check(r.status_code in (401, 403), "buyer key cannot touch admin API", str(r.status_code))
    r = c.get(f"{BASE}/api/admin/summary", headers={"Authorization": f"Bearer {tok}"})
    check(r.status_code == 200, "admin token works", str(r.status_code))

    # ---------------------------------------------------------------- 3. pricing bypass
    r = chat(c, key, model="mr/does-not-exist")
    check(r.status_code == 403 and "model_not_allowed" in r.text, "unpriced model refused", str(r.status_code))
    r = chat(c, key, model="mr/glm-5.3")   # real upstream route must not be addressable
    check(r.status_code == 403, "internal route name refused for customers", str(r.status_code))

    # ---------------------------------------------------------------- 4. hostile input
    rich = grant(c, tg + 3, credits_micro=5_000_000, rpm=600)
    r = chat(c, rich, max_tokens=10**9)
    check(r.status_code in (200, 400, 402), "absurd max_tokens handled, no 5xx", str(r.status_code))
    r = chat(c, rich, max_tokens=-5)
    check(r.status_code in (400, 402), "negative max_tokens rejected", str(r.status_code))
    r = c.post(f"{BASE}/v1/chat/completions", headers={"Authorization": f"Bearer {rich}"},
               json={"model": "glm-5.3-flash\r\nX-Injected: 1", "messages": [{"role": "user", "content": "x"}]})
    check(r.status_code in (400, 403), "CRLF in model refused", str(r.status_code))
    r = c.post(f"{BASE}/v1/chat/completions", headers={"Authorization": f"Bearer {rich}"},
               json={"model": CHEAP, "messages": "not-a-list"})
    check(r.status_code in (400, 422), "malformed body refused (no 5xx)", str(r.status_code))
    r = c.post(f"{BASE}/api/auth/login", json={"email": "a' OR '1'='1' --", "password": "x"})
    check(r.status_code == 401 and "syntax" not in r.text.lower(), "SQLi in login → clean 401", str(r.status_code))

    # ---------------------------------------------------------------- 5. per-key RPM
    k2 = grant(c, tg + 1, credits_micro=100_000_000, rpm=3)
    with ThreadPoolExecutor(max_workers=8) as ex:
        rs = list(ex.map(lambda _: chat(c, k2), range(8)))
    limited = [r for r in rs if r.status_code == 429]
    check(len(limited) >= 3, "per-key RPM enforced", f"{len(limited)}/8 → 429")

    # ---------------------------------------------------------------- 6. grant idempotency
    order_id = f"adv-dup-{uuid.uuid4().hex[:8]}"
    body = json.dumps({"order_id": order_id, "tg_id": tg + 2, "username": "dup", "name": "Dup",
                       "sku": "starter", "credits_micro": 1_000_000, "price_idr": 1,
                       "payment_ref": f"p_dup_{order_id}", "rpm_limit": 60}).encode()
    ts = int(time.time())
    hdr = {"content-type": "application/json", "x-timestamp": str(ts), "x-signature": signed(ts, body)}
    with ThreadPoolExecutor(max_workers=5) as ex:
        rs = list(ex.map(lambda _: c.post(f"{BASE}/api/internal/grant", content=body, headers=hdr), range(5)))
    bal = wallet(tg + 2)
    check(bal == 1_000_000, "5 concurrent grants for one order credit once", f"balance={bal}")
    check(all(r.status_code == 200 for r in rs), "duplicate grant answers 200 (idempotent)",
          ",".join(str(r.status_code) for r in rs))

    # ---------------------------------------------------------------- 7. invariants
    # A hold is debited from the wallet before it is posted, so open holds must be
    # counted on the wallet side for the books to balance mid-flight.
    drift = int(sql("select (select coalesce(sum(balance_micro),0) from balances)"
                    " + (select coalesce(sum(amount_micro),0) from holds where state='held')"
                    " - (select coalesce(sum(amount_micro),0) from ledger_entries)"))
    neg = int(sql("select count(*) from balances where balance_micro < 0"))
    stale = int(sql("select count(*) from holds where state = 'held' and expires_at < now()"))
    check(drift == 0, "ledger invariant Σbalance == Σledger", f"drift={drift}")
    check(neg == 0, "no negative wallet row", str(neg))
    check(stale == 0, "no expired holds left open", str(stale))

    bad = [n for ok, n, _ in results if not ok]
    print(f"\n{len(results) - len(bad)}/{len(results)} passed")
    if bad:
        print("FAILED: " + ", ".join(bad))
    return 0 if not bad else 1


if __name__ == "__main__":
    sys.exit(main())
