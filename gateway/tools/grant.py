#!/usr/bin/env python3
"""Bot-side client for POST /api/internal/grant.

The Telegram store calls this after a payment is confirmed. It is idempotent on --order, so a
retried webhook can never mint a second key or double-credit the buyer.

    python tools/grant.py --order TG-8842 --tg 541900896 --username aldi \
        --sku starter --idr 5000 --rpm 60

Prints the gateway JSON (contains the one-time `key`). Exit codes: 0 ok, 2 gateway error.
"""
from __future__ import annotations

import argparse
import hashlib
import hmac
import json
import os
import sys
import time
import urllib.error
import urllib.request

GATEWAY = os.environ.get("AETHINK_GATEWAY", "http://127.0.0.1:8080")
SECRET_FILE = os.environ.get("AETHINK_INTERNAL_FILE", "/root/.secrets/aethink-internal")


def secret() -> str:
    env = os.environ.get("AETHINK_INTERNAL_SECRET")
    if env:
        return env.strip()
    with open(SECRET_FILE) as fh:
        return fh.read().strip()


def grant(payload: dict, timeout: float = 30) -> tuple[int, dict]:
    body = json.dumps(payload, separators=(",", ":")).encode()
    ts = int(time.time())
    sig = hmac.new(secret().encode(), f"{ts}.".encode() + body, hashlib.sha256).hexdigest()
    req = urllib.request.Request(
        f"{GATEWAY}/api/internal/grant",
        data=body,
        method="POST",
        headers={
            "Content-Type": "application/json",
            "X-Timestamp": str(ts),
            "X-Signature": sig,
        },
    )
    try:
        with urllib.request.urlopen(req, timeout=timeout) as res:
            return res.status, json.load(res)
    except urllib.error.HTTPError as err:
        try:
            return err.code, json.load(err)
        except Exception:
            return err.code, {"error": err.read().decode()[:300]}


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--order", required=True, help="unique order id from the store")
    ap.add_argument("--tg", required=True, type=int, help="telegram user id")
    ap.add_argument("--username", default=None)
    ap.add_argument("--name", default=None)
    ap.add_argument("--sku", default="starter")
    ap.add_argument("--idr", type=int, default=5000, help="price paid in IDR (bookkeeping)")
    ap.add_argument("--credits-micro", type=int, default=None,
                    help="override credit amount; default = idr * 1_000_000")
    ap.add_argument("--rpm", type=int, default=60)
    args = ap.parse_args()

    credits = args.credits_micro if args.credits_micro is not None else args.idr * 1_000_000
    payload = {
        "order_id": args.order,
        "tg_id": args.tg,
        "username": args.username,
        "name": args.name,
        "sku": args.sku,
        "credits_micro": credits,
        "price_idr": args.idr,
        "payment_ref": args.order,
        "rpm_limit": args.rpm,
    }
    status, data = grant(payload)
    print(json.dumps({"status": status, **data}, indent=2))
    return 0 if status == 200 else 2


if __name__ == "__main__":
    sys.exit(main())
