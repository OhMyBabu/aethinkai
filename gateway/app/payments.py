"""WijayaPay (QRIS) — create a transaction, verify it, settle the order, deliver the key.

Flow
----
1. Buyer picks a package (bot button or web portal) → an `orders` row exists (pending).
2. `create_for_order()` calls WijayaPay `POST /transaction/create` with `ref_id = order_id`
   and stores the QR + expiry in `payment_intents`.
3. Payment lands three ways, all idempotent and all ending in `settle_order()`:
   * the webhook (`POST /api/pay/webhook/wijayapay`),
   * the "Cek status" button in the bot (`GET /api/pay/status`),
   * the reconciler loop (every 30 s) for anything we missed.
4. `settle_order()` NEVER trusts the callback body: it re-asks WijayaPay `get-status`,
   and only then marks the intent paid + grants the order + sends the key to Telegram.

Why the re-check matters: the webhook endpoint is public. A forged `{"status":"paid"}`
with a guessed `ref_id` must not mint keys — and it doesn't, because the amount and
status come from the provider, not from the caller.
"""
from __future__ import annotations

import asyncio
import hashlib
import json
import os
import secrets
from typing import Any

import httpx
from fastapi import APIRouter, Depends, Request
from pydantic import BaseModel, Field

from . import db, portal

BASE_URL = (os.environ.get("WIJAYAPAY_BASE_URL") or "https://gateway.wijayapay.com/api").rstrip("/")
MERCHANT = (os.environ.get("WIJAYAPAY_MERCHANT") or "").strip()
API_KEY = (os.environ.get("WIJAYAPAY_API_KEY") or "").strip()
CALLBACK_URL = (os.environ.get("PAY_CALLBACK_URL")
                or "https://router.aethink.ai.id/api/pay/webhook/wijayapay").strip()
PROVIDER = "wijayapay"
PAID_STATES = {"paid", "success", "completed", "settled"}
DEAD_STATES = {"expired", "failed", "cancelled", "canceled"}

router = APIRouter()


# ------------------------------------------------------------------ provider
def signature(ref_id: str) -> str:
    """md5(code_merchant + api_key + ref_id) — no separators, per WijayaPay docs."""
    return hashlib.md5(f"{MERCHANT}{API_KEY}{ref_id}".encode()).hexdigest()


def configured() -> bool:
    return bool(MERCHANT and API_KEY)


async def provider_create(ref_id: str, nominal_idr: int) -> dict[str, Any]:
    """Ask WijayaPay for a QRIS transaction. Returns their `data` object."""
    if not configured():
        raise RuntimeError("WijayaPay belum dikonfigurasi (WIJAYAPAY_MERCHANT / WIJAYAPAY_API_KEY)")
    form = {
        "code_merchant": MERCHANT,
        "api_key": API_KEY,
        "ref_id": ref_id,
        "code_payment": "QRIS",
        "nominal": str(int(nominal_idr)),
        "callback_url": CALLBACK_URL,
    }
    async with httpx.AsyncClient(timeout=30) as c:
        r = await c.post(f"{BASE_URL}/transaction/create", data=form,
                         headers={"X-Signature": signature(ref_id),
                                  "Content-Type": "application/x-www-form-urlencoded"})
    try:
        body = r.json()
    except Exception:
        body = {"success": False, "message": f"HTTP {r.status_code}"}
    if r.status_code != 200 or not body.get("success") or not (body.get("data") or {}).get("qr_string"):
        msg = body.get("message") or body.get("error") or f"HTTP {r.status_code}"
        raise RuntimeError(str(msg))
    return body["data"]


async def provider_status(ref_id: str) -> dict[str, Any] | None:
    """Authoritative status. None = could not read (network/parse)."""
    if not configured():
        return None
    params = {"code_merchant": MERCHANT, "api_key": API_KEY, "ref_id": ref_id}
    try:
        async with httpx.AsyncClient(timeout=20) as c:
            r = await c.get(f"{BASE_URL}/get-status", params=params)
        body = r.json()
    except Exception:
        return None
    data = body.get("data") if isinstance(body.get("data"), dict) else body
    raw = (body.get("status_pembayaran") or body.get("status")
           or (data or {}).get("status_pembayaran") or (data or {}).get("status") or "")
    state = str(raw).strip().lower()
    if state in PAID_STATES:
        return {"state": "paid", "data": data or {}, "raw": body}
    if state in DEAD_STATES:
        return {"state": "expired", "data": data or {}, "raw": body}
    if "ref_id tidak ditemukan" in json.dumps(body).lower():
        return {"state": "unknown", "data": {}, "raw": body}
    return {"state": "pending", "data": data or {}, "raw": body}


# ------------------------------------------------------------------ store
async def _intent_row(order_id: str) -> dict[str, Any] | None:
    row = await db.pool().fetchrow(
        """SELECT * FROM payment_intents WHERE order_id = $1 AND provider = $2
            ORDER BY created_at DESC LIMIT 1""",
        order_id, PROVIDER,
    )
    return dict(row) if row else None


def _checkout_token() -> str:
    return secrets.token_urlsafe(18)


async def create_for_order(order_id: str) -> dict[str, Any]:
    """Create (or return) the QRIS transaction for an existing pending order."""
    order = await db.pool().fetchrow(
        """SELECT o.id, o.sku, o.price_idr, o.status, o.checkout_token,
                  b.id AS buyer_id, b.tg_id, b.name
             FROM orders o JOIN buyers b ON b.id = o.buyer_id WHERE o.id = $1""",
        order_id,
    )
    if order is None:
        raise portal._bad("order_not_found", "Order tidak ada", 404)
    if order["status"] == "granted":
        raise portal._bad("already_paid", "Order ini sudah dibayar", 409)
    if order["status"] in ("expired", "cancelled"):
        raise portal._bad("order_closed", "Order ini sudah ditutup", 409)
    if not configured():
        raise portal._bad("payment_disabled", "Pembayaran otomatis belum aktif", 503)

    token = order["checkout_token"]
    if not token:
        token = _checkout_token()
        await db.pool().execute("UPDATE orders SET checkout_token = $2 WHERE id = $1", order_id, token)

    existing = await _intent_row(order_id)
    if existing and existing["status"] == "pending" and existing["expires_at"] and not _expired(existing["expires_at"]):
        # reuse the live QR: never create a second payable code for one order
        return _public_payload(existing, order, token)

    # WijayaPay refuses to reuse a ref_id forever ("Ref ID merchant sudah pernah
    # digunakan"), so a retry after expiry needs a new one. The webhook maps
    # provider_ref -> order through payment_intents, never by parsing the string.
    attempts = await db.pool().fetchval(
        "SELECT count(*) FROM payment_intents WHERE order_id = $1", order_id) or 0
    ref_id = order_id if attempts == 0 else f"{order_id}-{attempts + 1}"
    try:
        data = await provider_create(ref_id, int(order["price_idr"]))
    except RuntimeError as exc:
        if "sudah pernah digunakan" not in str(exc):
            raise
        st = await provider_status(ref_id)
        if st is None or st["state"] == "unknown":
            raise portal._bad("payment_conflict", "Ref pembayaran bentrok, coba lagi", 409)
        data = st.get("data") or {}
        if not data.get("qr_string"):
            raise portal._bad("payment_conflict", "Ref pembayaran bentrok, coba lagi", 409)
    # payment_intents.user_id is a FK into users: the buyer's user row must exist
    # before the first payment, otherwise the insert fails and the QR is orphaned.
    async with db.pool().acquire() as con:
        async with con.transaction():
            user_id = await portal._ensure_user(con, order["tg_id"], order["sku"], order["name"])
    intent_id = db.new_id()
    row = await db.pool().fetchrow(
        """INSERT INTO payment_intents(id, user_id, order_id, provider, provider_ref, amount_idr,
                                       status, expires_at, trx_reference, raw)
           VALUES ($1, $2, $3, $4, $5, $6, 'pending',
                   coalesce((select nullif($7,'')::timestamptz), now() + interval '30 minutes'),
                   $8, $9)
           ON CONFLICT (provider, provider_ref) WHERE provider_ref IS NOT NULL
           DO UPDATE SET raw = EXCLUDED.raw
           RETURNING *""",
        intent_id, user_id, order_id, PROVIDER, data.get("ref_id") or order_id,
        int(data.get("total_diterima") or order["price_idr"]),
        _parse_expired(data.get("expired")), data.get("trx_reference"),
        json.dumps(data)[:20000],
    )
    return _public_payload(dict(row), order, token)


def _parse_expired(raw: Any) -> str:
    """WijayaPay sends 'YYYY-MM-DD HH:MM:SS' in WIB (UTC+7), with no offset."""
    if not raw:
        return ""
    import datetime as _dt
    try:
        naive = _dt.datetime.strptime(str(raw).strip()[:19], "%Y-%m-%d %H:%M:%S")
    except Exception:
        return ""
    wib = naive.replace(tzinfo=_dt.timezone(_dt.timedelta(hours=7)))
    return wib.astimezone(_dt.timezone.utc).isoformat()


def _expired(ts) -> bool:
    import datetime as _dt
    now = _dt.datetime.now(_dt.timezone.utc)
    if ts.tzinfo is None:
        ts = ts.replace(tzinfo=_dt.timezone.utc)
    return ts < now


def _public_payload(intent: dict[str, Any], order: dict[str, Any], token: str) -> dict[str, Any]:
    raw = intent.get("raw") or {}
    if isinstance(raw, str):
        try:
            raw = json.loads(raw)
        except Exception:
            raw = {}
    nominal = int(order["price_idr"])
    total = int(raw.get("total_bayar") or intent.get("amount_idr") or nominal)
    return {
        "order_id": order["id"],
        "sku": order["sku"],
        "status": intent.get("status") or "pending",
        "provider": PROVIDER,
        "amount_idr": nominal,                     # what we credit
        "total_bayar": total,                      # what the buyer sends (incl. QRIS fee)
        "fee_idr": max(0, total - nominal),
        "qr_string": raw.get("qr_string"),
        "qr_image": raw.get("qr_image"),
        "trx_reference": intent.get("trx_reference"),
        "expires_at": intent["expires_at"].isoformat() if intent.get("expires_at") else None,
        "tutorial": raw.get("tutorial_pembayaran"),
        "checkout_token": token,
        "pay_url": f"/pay/{order['id']}?t={token}",
    }


# ------------------------------------------------------------------ settle
async def _provider_refs(order_id: str) -> list[str]:
    """Every provider ref ever issued for the order, newest first.

    A retry mints `<order_id>-<n>`, but the buyer may still pay the earlier QR, so
    settling has to look at all of them, not just the latest."""
    rows = await db.pool().fetch(
        """SELECT provider_ref FROM payment_intents
            WHERE order_id = $1 AND provider = $2 AND provider_ref IS NOT NULL
            ORDER BY created_at DESC""",
        order_id, PROVIDER,
    )
    refs = list(dict.fromkeys(r["provider_ref"] for r in rows))
    return refs or [order_id]


async def _resolve_provider_state(order_id: str) -> tuple[dict[str, Any] | None, str]:
    """Ask the provider about each ref of the order.

    Returns (paid_status, "paid") when any ref is paid; otherwise (None, reason) where
    reason is pending / provider_unreachable / expired / unknown. The order only counts
    as expired when every ref answered and none of them is still payable."""
    states: list[str | None] = []
    for ref in await _provider_refs(order_id):
        st = await provider_status(ref)
        if st is not None and st["state"] == "paid":
            return st, "paid"
        states.append(None if st is None else st["state"])
    if "pending" in states:
        return None, "pending"
    if None in states:
        return None, "provider_unreachable"
    if "expired" in states:
        return None, "expired"
    return None, states[0] if states else "unknown"


async def settle_order(order_id: str, source: str, raw: Any = None) -> dict[str, Any]:
    """Verify with the provider, then grant. Safe to call any number of times."""
    st, reason = await _resolve_provider_state(order_id)
    if st is None:
        if reason == "expired":
            await db.pool().execute(
                "UPDATE payment_intents SET status='expired' WHERE order_id=$1 AND status='pending'", order_id)
            await db.pool().execute(
                "UPDATE orders SET status='expired', expired_at=now() WHERE id=$1 AND status='pending'", order_id)
        return {"settled": False, "reason": reason}

    data = st.get("data") or {}
    paid_total = int(data.get("total_bayar") or data.get("total_dibayar") or 0)
    await db.pool().execute(
        """UPDATE payment_intents SET status='paid', paid_at=now(),
                 trx_reference=coalesce($2, trx_reference), raw=$3
           WHERE order_id=$1 AND status <> 'paid'""",
        order_id, data.get("trx_reference"), json.dumps(st.get("raw") or {})[:20000],
    )
    try:
        granted = await portal.grant_order(order_id)
    except Exception as exc:            # order vanished / race: log, never 500 the webhook
        print(f"[pay] grant failed for {order_id}: {exc}", flush=True)
        return {"settled": False, "reason": "grant_failed", "detail": str(exc)[:160]}
    await db.log_audit(f"pay:{source}", "payment.paid", order_id,
                       {"paid_total": paid_total, "trx": data.get("trx_reference")})
    if granted.get("key"):
        await notify_buyer(order_id, granted)
    return {"settled": True, "granted": granted.get("already_granted") is False, **granted}


async def notify_buyer(order_id: str, granted: dict[str, Any]) -> None:
    """Deliver the key over Telegram — the bot may be offline, the token is the same."""
    token = portal._bot_token()
    if not token:
        print(f"[pay] no bot token, key for {order_id} not delivered", flush=True)
        return
    row = await db.pool().fetchrow(
        """SELECT o.sku, o.credits_micro, o.rpm_limit, b.tg_id
             FROM orders o JOIN buyers b ON b.id = o.buyer_id WHERE o.id = $1""", order_id)
    if row is None or not row["tg_id"]:
        return
    key = granted.get("key") or ""
    balance = int(granted.get("balance_micro") or 0)
    head = (f"✅ <b>Pembayaran diterima</b>\n\n"
            f"Order <code>{order_id}</code> · paket <b>{row['sku']}</b>\n"
            f"Saldo: <b>Rp{balance/1_000_000:,.0f}</b> · limit <b>{row['rpm_limit']} req/menit</b>\n\n")
    if key:
        text = head + (f"<b>API key</b>\n<code>{key}</code>\n\n"
                       "Simpan sekarang — key hanya ditampilkan sekali di chat ini.")
    else:
        # one wallet = one key: a repeat purchase tops up, it does not mint a credential
        text = head + (f"Saldo ditambahkan ke akun yang sudah ada.\n"
                       f"Key kamu tetap: <code>{granted.get('key_prefix') or ''}…</code>\n\n"
                       "Pakai key yang sama — tidak ada key baru yang dibuat.")
    kb = {"inline_keyboard": [[{"text": "🌐 Buka portal", "url": "https://router.aethink.ai.id/portal"}]]}
    try:
        async with httpx.AsyncClient(timeout=20) as c:
            await c.post(f"https://api.telegram.org/bot{token}/sendMessage",
                         json={"chat_id": row["tg_id"], "text": text,
                               "parse_mode": "HTML", "reply_markup": kb,
                               "disable_web_page_preview": True})
    except Exception as exc:
        print(f"[pay] telegram notify failed for {order_id}: {exc}", flush=True)


# ------------------------------------------------------------------ routes
class PayCreateIn(BaseModel):
    order_id: str = Field(min_length=3, max_length=80)


@router.post("/api/internal/pay/create")
async def internal_pay_create(request: Request):
    """Bot → gateway (HMAC-signed). Returns the QR payload."""
    body = await portal._internal_payload(request, PayCreateIn)
    return await create_for_order(body.order_id)


@router.post("/api/portal/pay/create")
async def portal_pay_create(body: PayCreateIn, row: dict = Depends(portal.portal_identity)):
    """Web portal → gateway (buyer JWT). Only the buyer's own order."""
    buyer_id = row.get("buyer_id")
    if not buyer_id:
        raise portal._bad("telegram_required", "Hubungkan Telegram dulu", 403)
    owner = await db.pool().fetchval("SELECT buyer_id FROM orders WHERE id = $1", body.order_id)
    if owner is None:
        raise portal._bad("order_not_found", "Order tidak ada", 404)
    if owner != buyer_id:
        raise portal._bad("not_your_order", "Order ini bukan milik akun ini", 403)
    if await db.pool().fetchval("SELECT status FROM orders WHERE id = $1", body.order_id) == "granted":
        raise portal._bad("already_paid", "Order ini sudah dibayar", 409)

    # One live payable QR per buyer. A second order cannot open its own code while
    # another is still payable: the buyer pays or cancels that one first.
    conflict = await db.pool().fetchrow(
        """SELECT o.id FROM payment_intents pi
             JOIN orders o ON o.id = pi.order_id
            WHERE o.buyer_id = $1 AND o.status = 'pending'
              AND pi.status = 'pending' AND pi.expires_at > now()
              AND pi.order_id <> $2
            ORDER BY pi.created_at DESC LIMIT 1""",
        buyer_id, body.order_id,
    )
    if conflict:
        raise portal._bad(
            "payment_pending",
            "Masih ada QRIS yang belum dibayar. Lunasi atau batalkan dulu.",
            409,
            pending_order_id=str(conflict["id"]),
        )
    return await create_for_order(body.order_id)


@router.get("/api/pay/status")
async def pay_status(order_id: str, t: str = ""):
    """Public status for the checkout page; `t` is the unguessable checkout token."""
    row = await db.pool().fetchrow(
        "SELECT id, checkout_token, status FROM orders WHERE id = $1", order_id
    )
    if row is None or not t or not secrets.compare_digest(row["checkout_token"] or "", t):
        raise portal._bad("not_found", "Order tidak ditemukan", 404)
    if row["status"] != "granted":
        await settle_order(order_id, source="poll")
    intent = await _intent_row(order_id)
    order = await db.pool().fetchrow("SELECT id, sku, price_idr, status FROM orders WHERE id = $1", order_id)
    if intent is None:
        return {"order_id": order_id, "status": order["status"], "provider": None}
    payload = _public_payload(intent, order, row["checkout_token"])
    payload["status"] = "paid" if order["status"] == "granted" else (intent["status"] or "pending")
    return payload


@router.get("/api/internal/pay/status/{order_id}")
async def internal_pay_status(order_id: str, request: Request):
    """Bot → gateway (HMAC-signed GET) for the 'Cek status' button."""
    await portal._signed_get(request, order_id)
    if (await db.pool().fetchval("SELECT status FROM orders WHERE id = $1", order_id)) != "granted":
        await settle_order(order_id, source="bot")
    order = await db.pool().fetchrow(
        "SELECT o.id, o.sku, o.status, o.price_idr, k.prefix FROM orders o "
        "LEFT JOIN api_keys k ON k.id = o.key_id WHERE o.id = $1", order_id)
    intent = await _intent_row(order_id)
    raw = (intent or {}).get("raw") or {}
    if isinstance(raw, str):
        try:
            raw = json.loads(raw)
        except Exception:
            raw = {}
    return {
        "order_id": order["id"], "sku": order["sku"], "status": order["status"],
        "price_idr": order["price_idr"], "key_prefix": order["prefix"],
        "total_bayar": raw.get("total_bayar"),
        "qr_image": raw.get("qr_image"),
        "qr_string": raw.get("qr_string"),
        "expires_at": intent["expires_at"].isoformat() if intent and intent.get("expires_at") else None,
    }


@router.post("/api/pay/webhook/wijayapay")
async def wijayapay_webhook(request: Request):
    """Public callback. The body is only a hint — `settle_order` re-checks the provider."""
    try:
        body = await request.json()
    except Exception:
        body = {}
    data = body.get("data") if isinstance(body.get("data"), dict) else body
    ref_id = str((data or {}).get("ref_id") or "").strip()
    if not ref_id:
        return {"ok": False, "reason": "no ref_id"}
    # retries use "<order_id>-<n>"; resolve through the intent, never by parsing
    order_id = await db.pool().fetchval(
        "SELECT order_id FROM payment_intents WHERE provider = $1 AND provider_ref = $2",
        PROVIDER, ref_id) or ref_id
    result = await settle_order(order_id, source="webhook", raw=body)
    return {"ok": True, **result}


# ------------------------------------------------------------------ expiry sweeper
async def expiry_sweeper(interval_seconds: int = 60) -> None:
    """Expire QRIS that are past their own deadline. Local only: the provider is
    never called, so a stale checkout cannot keep a buyer locked out or spam
    WijayaPay. A late webhook still settles, because settle_order re-checks the
    provider and grants a paid order whatever its local status was."""
    while True:
        try:
            expired = await db.pool().fetch(
                """UPDATE payment_intents SET status = 'expired'
                    WHERE status = 'pending' AND expires_at IS NOT NULL AND expires_at < now()
                    RETURNING order_id"""
            )
            for row in expired:
                if row["order_id"]:
                    await db.pool().execute(
                        """UPDATE orders SET status = 'expired', expired_at = now()
                            WHERE id = $1 AND status = 'pending'""",
                        row["order_id"],
                    )
            # An order whose QR was never requested has no provider deadline, so
            # give it a short grace period instead of blocking the buyer forever.
            ttl = int(os.environ.get("UNPAID_ORDER_TTL_MINUTES", "30"))
            await db.pool().execute(
                """UPDATE orders SET status = 'expired', expired_at = now()
                    WHERE status = 'pending'
                      AND created_at < now() - make_interval(mins => $1)
                      AND NOT EXISTS (
                            SELECT 1 FROM payment_intents pi
                             WHERE pi.order_id = orders.id AND pi.status IN ('pending', 'paid')
                      )""",
                ttl,
            )
        except Exception as exc:
            print(f"[pay] expiry sweeper: {exc}", flush=True)
        await asyncio.sleep(interval_seconds)


# ------------------------------------------------------------------ reconciler
async def reconciler(interval_seconds: int = 30) -> None:
    """Sweep pending intents: grant the paid ones, close the expired ones."""
    while True:
        try:
            rows = await db.pool().fetch(
                """SELECT order_id FROM payment_intents
                    WHERE provider = $1 AND status = 'pending'
                      AND created_at > now() - interval '2 hours'
                    ORDER BY created_at LIMIT 20""",
                PROVIDER,
            )
            for r in rows:
                try:
                    await settle_order(r["order_id"], source="reconciler")
                except Exception as exc:
                    print(f"[pay] reconciler {r['order_id']}: {exc}", flush=True)
        except Exception as exc:
            print(f"[pay] reconciler loop error: {exc}", flush=True)
        await asyncio.sleep(interval_seconds)
