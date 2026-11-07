#!/usr/bin/env python3
"""Payment tests — the parts that must not rely on a real bank transfer.

Covers: create (live provider if configured), status lookup, forged webhook rejected,
paid path grants exactly once, expiry, and the ledger staying balanced.

Run: ./gateway/.venv/bin/python gateway/tests/test_payments.py
"""
from __future__ import annotations

import asyncio
import hashlib
import hmac
import json
import os
import sys
import time
import uuid
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

import httpx  # noqa: E402

BASE = os.environ.get("GW", "http://127.0.0.1:8080")
SECRET = open("/root/.secrets/aethink-internal").read().strip()
DB_URL = [l.split("=", 1)[1].strip() for l in open("/root/.secrets/aethink-db.env")
          if l.startswith("DATABASE_URL=")][0]

results: list[tuple[bool, str, str]] = []


def check(ok: bool, name: str, detail: str = "") -> None:
    results.append((ok, name, detail))
    print(f"{'PASS' if ok else 'FAIL'}  {name}" + (f"  [{detail}]" if detail else ""))


def sql(q: str) -> str:
    import subprocess
    return subprocess.run(["psql", DB_URL, "-tAc", q], capture_output=True, text=True).stdout.strip()


def signed(method: str, path: str, payload: dict | None = None) -> httpx.Response:
    body = json.dumps(payload).encode() if payload is not None else b""
    ts = int(time.time())
    sig = hmac.new(SECRET.encode(), f"{ts}.".encode() + body, hashlib.sha256).hexdigest()
    headers = {"x-timestamp": str(ts), "x-signature": sig}
    if payload is not None:
        headers["content-type"] = "application/json"
    return httpx.request(method, BASE + path, content=body if payload is not None else None,
                         headers=headers, timeout=60)


def new_order(price_idr: int = 5000) -> tuple[str, int]:
    tg = int(time.time()) % 700_000_000 + 555
    oid = f"PAYT-{uuid.uuid4().hex[:10]}"
    r = signed("POST", "/api/internal/order", {
        "order_id": oid, "tg_id": tg, "username": "paytest", "name": "Pay Test",
        "sku": "starter", "credits_micro": price_idr * 1_000_000, "price_idr": price_idr,
        "rpm_limit": 60, "payment_ref": oid,
    })
    assert r.status_code == 200, r.text[:200]
    return oid, tg


def main() -> int:
    oid, tg = new_order()

    # Live provider calls are opt-in ONLY (PAY_TEST_LIVE=1): every create is a real
    # transaction on the merchant account — never hammer the provider from a test run.
    live_ok = (os.environ.get("PAY_TEST_LIVE") or "").strip() in {"1", "true", "yes"}
    r = signed("POST", "/api/internal/pay/create", {"order_id": oid}) if live_ok else None
    live = bool(r is not None and r.status_code == 200)
    if not live_ok:
        check(True, "live provider create skipped (set PAY_TEST_LIVE=1 to run it)")
    else:
        check(r.status_code in (200, 503), "pay/create answered", str(r.status_code))
    if live:
        j = r.json()
        check(bool(j.get("qr_string")), "QRIS payload present")
        check(j["total_bayar"] >= j["amount_idr"], "buyer total covers the amount",
              f"{j['amount_idr']} + fee {j['fee_idr']}")
        check(bool(j.get("checkout_token")), "checkout token minted")
        check(bool(j.get("expires_at")), "expiry set", str(j.get("expires_at")))
        tok = j["checkout_token"]
        # reuse must not create a second payable code
        same = signed("POST", "/api/internal/pay/create", {"order_id": oid}).json()
        check(same.get("trx_reference") in (None, j.get("trx_reference")),
              "second create reuses the live QR", str(same.get("trx_reference")))

        # ------------------------------------------------------------ 2. status
        s = httpx.get(f"{BASE}/api/pay/status", params={"order_id": oid, "t": tok}, timeout=60)
        check(s.status_code == 200 and s.json()["status"] in ("pending", "paid"), "status readable",
              str(s.status_code))
        bad = httpx.get(f"{BASE}/api/pay/status", params={"order_id": oid, "t": "x"}, timeout=30)
        check(bad.status_code == 404, "wrong checkout token refused", str(bad.status_code))

        # ------------------------------------------------------------ 3. forged webhook
        before = int(sql(f"select count(*) from api_keys k join buyers b on b.id=k.buyer_id where b.tg_id={tg}"))
        w = httpx.post(f"{BASE}/api/pay/webhook/wijayapay",
                       json={"status": "paid", "data": {"ref_id": oid, "total_dibayar": 5000,
                                                        "trx_reference": "FORGED"}}, timeout=60)
        after = int(sql(f"select count(*) from api_keys k join buyers b on b.id=k.buyer_id where b.tg_id={tg}"))
        check(w.status_code == 200 and not w.json().get("settled"), "forged 'paid' webhook does not settle",
              w.text[:90])
        check(before == after, "no key minted by the forged callback")

    # ---------------------------------------------------------------- 4. paid path (provider stubbed)
    from app import db as _db, payments  # noqa: E402

    async def run_paid_path() -> None:
        await _db.init_pool()
        oid2, tg2 = new_order(1000)
        if live_ok:
            signed("POST", "/api/internal/pay/create", {"order_id": oid2})

        async def fake_status(ref: str):
            return {"state": "paid", "data": {"total_bayar": 1000, "trx_reference": "WPTEST",
                                              "ref_id": ref}, "raw": {}}
        async def no_notify(*a, **k):
            return None

        payments.provider_status = fake_status
        payments.notify_buyer = no_notify
        first = await payments.settle_order(oid2, source="test")
        check(first.get("settled") is True, "paid order settles", json.dumps(first)[:80])
        check(bool(first.get("key")), "key minted on settle")
        credits = 1000 * 1_000_000          # price_idr * 1e6 micro
        bal = int(sql("select coalesce(sum(b.balance_micro),0) from balances b where b.user_id in ("
                      "select k.user_id from api_keys k join buyers y on y.id=k.buyer_id "
                      f"where y.tg_id={tg2})"))
        check(bal == credits, "wallet credited exactly once", f"{bal}")
        second = await payments.settle_order(oid2, source="test")
        check(second.get("already_granted") is True, "second settle is a no-op", json.dumps(second)[:70])
        bal2 = int(sql("select coalesce(sum(b.balance_micro),0) from balances b where b.user_id in ("
                       "select k.user_id from api_keys k join buyers y on y.id=k.buyer_id "
                       f"where y.tg_id={tg2})"))
        check(bal2 == credits, "no double credit on retry", f"{bal2}")
        drift = int(sql("select (select coalesce(sum(balance_micro),0) from balances)"
                        " + (select coalesce(sum(amount_micro),0) from holds where state='held')"
                        " - (select coalesce(sum(amount_micro),0) from ledger_entries)"))
        check(drift == 0, "ledger still balanced", f"drift={drift}")

        # ------------------------------------------------------------ 5. expired path
        oid3, _ = new_order(1000)
        if live_ok:
            signed("POST", "/api/internal/pay/create", {"order_id": oid3})

        async def fake_expired(ref: str):
            return {"state": "expired", "data": {}, "raw": {}}
        payments.provider_status = fake_expired
        res = await payments.settle_order(oid3, source="test")
        check(res.get("settled") is False, "expired transaction does not grant", json.dumps(res)[:70])
        check(sql(f"select status from orders where id='{oid3}'") == "expired", "order marked expired")
        await _db.close_pool()

    asyncio.run(run_paid_path())

    bad = [n for ok, n, _ in results if not ok]
    print(f"\n{len(results) - len(bad)}/{len(results)} passed")
    if bad:
        print("FAILED: " + ", ".join(bad))
    return 0 if not bad else 1


if __name__ == "__main__":
    sys.exit(main())
