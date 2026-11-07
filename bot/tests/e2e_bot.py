#!/usr/bin/env python3
"""E2E for the store bot's gateway wiring (no Telegram traffic: tg() is stubbed).

Covers order creation -> pending list -> grant -> buyer snapshot -> rotate, plus a real
/v1 chat with the minted key and a 401 for the rotated-away key.
"""
from __future__ import annotations

import json
import os
import sys
import time
from pathlib import Path

os.environ.setdefault("BOT_TOKEN", "0:test")
os.environ.setdefault("AETHINK_GATEWAY", "http://127.0.0.1:8080")
os.environ.setdefault("AETHINK_ADMINS", "541900896")
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import bot  # noqa: E402

SENT: list[tuple[int, str]] = []
bot.send = lambda chat_id, text, keyboard=None: SENT.append((chat_id, text)) or {}
bot.edit = lambda *a, **k: None
bot.tg = lambda *a, **k: {}

# A fresh Telegram id per run: the buyer's balance is cumulative, so a fixed id
# makes the "saldo Rp5.000" assertion fail on the second run.
TG = 555_000_000 + int(time.time()) % 100_000
results: list[tuple[bool, str, str]] = []


def check(ok: bool, name: str, detail: str = "") -> None:
    results.append((ok, name, detail))
    print(f"{'PASS' if ok else 'FAIL'}  {name}" + (f"  [{detail}]" if detail else ""))


def main() -> int:
    user = {"id": TG, "username": "botbuyer", "first_name": "Bot", "last_name": "Buyer"}

    order = bot.create_order(user, "starter")
    check(bool(order) and order[0].startswith(f"TG{TG}-"), "order dibuat (pending)",
          order[0] if order else "none")
    if not order:
        return 1
    order_id, created = order
    check(created.get("status") == "pending", "status order pending", str(created.get("status")))

    s, pending = bot.get_internal("/api/internal/pending", "pending")
    check(s == 200 and any(o["id"] == order_id for o in pending["orders"]),
          "order muncul di /pending", f"{s} {len(pending.get('orders', []))}")

    ok, note = bot.do_grant(order_id)
    check(ok, "grant order lewat bot", note[:90])
    key_msg = next((t for cid, t in SENT if cid == TG and "sk-aeth_" in t), "")
    key = ""
    if "<code>sk-aeth_" in key_msg:
        key = key_msg.split("<code>sk-aeth_", 1)[1].split("</code>", 1)[0]
        key = "sk-aeth_" + key
    check(bool(key), "key dikirim ke chat pembeli", f"{key[:14]}…")

    s, snap = bot.get_internal(f"/api/internal/buyer/{TG}", f"buyer:{TG}")
    check(s == 200 and snap["balance_micro"] == 5_000_000_000,
          "snapshot saldo Rp5.000", str(snap.get("balance_micro")))

    ok2, note2 = bot.do_grant(order_id)
    check(ok2 and "sudah pernah" in note2, "grant kedua idempoten", note2[:60])

    # chat with the minted key
    r = bot.client.post("http://127.0.0.1:8080/v1/chat/completions",
                        headers={"Authorization": f"Bearer {key}"},
                        json={"model": "deepseek-v4.1-flash-1017",
                              "messages": [{"role": "user", "content": "bot e2e"}], "max_tokens": 8},
                        timeout=90)
    check(r.status_code == 200, "chat pakai key dari bot", str(r.status_code))

    # rotate
    s, rot = bot.post_internal("/api/internal/rotate", {"tg_id": TG})
    check(s == 200 and rot.get("api_key", "").startswith("sk-aeth_"), "rotate via bot", str(s))
    r = bot.client.post("http://127.0.0.1:8080/v1/chat/completions",
                        headers={"Authorization": f"Bearer {key}"},
                        json={"model": "deepseek-v4.1-flash-1017",
                              "messages": [{"role": "user", "content": "old"}], "max_tokens": 4}, timeout=60)
    check(r.status_code == 401, "key lama mati setelah rotate", str(r.status_code))
    r = bot.client.post("http://127.0.0.1:8080/v1/chat/completions",
                        headers={"Authorization": f"Bearer {rot['api_key']}"},
                        json={"model": "deepseek-v4.1-flash-1017",
                              "messages": [{"role": "user", "content": "new"}], "max_tokens": 4}, timeout=90)
    check(r.status_code == 200, "key baru jalan", str(r.status_code))

    s, buyers = bot.get_internal("/api/internal/buyers", "buyers")
    check(s == 200 and any(b["tg_id"] == TG for b in buyers["buyers"]), "admin /buyers memuat pembeli")

    bad = [n for ok_, n, _ in results if not ok_]
    print(f"\n{len(results) - len(bad)}/{len(results)} passed")
    if bad:
        print("FAILED: " + ", ".join(bad))
    return 0 if not bad else 1


if __name__ == "__main__":
    sys.exit(main())
