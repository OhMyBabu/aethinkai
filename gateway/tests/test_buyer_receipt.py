"""Buyer receipts after a payment, and the RPM a manual grant applies.

No database, no network, no Telegram: pool, provider and bot token are stubbed.

Run: python -m pytest gateway/tests/test_buyer_receipt.py
"""
from __future__ import annotations

import asyncio
import importlib.util
from pathlib import Path

from test_settle_refs import FakePool, fake_portal, paid

from app import db, payments

APP = Path(__file__).resolve().parent.parent / "app"


def settle_with(grant_result: dict) -> list[tuple[str, dict]]:
    """Settle one paid order whose grant returns `grant_result`; return the receipts sent."""
    sent: list[tuple[str, dict]] = []

    async def grant(order_id):
        return grant_result

    async def notify(order_id, granted):
        sent.append((order_id, granted))

    async def status(ref):
        return paid()

    async def audit(*a, **k):
        return None

    pool = FakePool(["ORD"])
    db.pool = lambda: pool
    db.log_audit = audit
    payments.provider_status = status
    payments.notify_buyer = notify
    original = fake_portal.grant_order
    fake_portal.grant_order = grant
    try:
        asyncio.run(payments.settle_order("ORD", source="test"))
    finally:
        fake_portal.grant_order = original
    return sent


def test_top_up_with_existing_key_still_notifies_the_buyer():
    sent = settle_with({"order_id": "ORD", "already_granted": False, "key": None,
                        "key_reused": True, "key_prefix": "sk-aeth_ab12", "balance_micro": 30_000_000_000})
    assert [order for order, _ in sent] == ["ORD"]


def test_first_purchase_notifies_with_the_key():
    sent = settle_with({"order_id": "ORD", "already_granted": False, "key": "sk-aeth_full",
                        "key_reused": False, "key_prefix": "sk-aeth_full", "balance_micro": 5_000_000_000})
    assert sent and sent[0][1]["key"] == "sk-aeth_full"


def test_replayed_settlement_does_not_notify_twice():
    sent = settle_with({"order_id": "ORD", "already_granted": True, "key": None, "key_prefix": "sk-aeth_ab12"})
    assert sent == []


ROW = {"sku": "pro", "package": "Pro", "credits_micro": 25_000_000_000, "key_rpm": 180}


def test_receipt_for_top_up_names_the_kept_key_and_uses_rupiah_dots():
    text = payments.notify_text("AETH-1", ROW, {"key": None, "key_prefix": "sk-aeth_ab12",
                                                "balance_micro": 72_000_000_000})
    assert "+Rp25.000" in text and "Rp72.000" in text
    assert "sk-aeth_ab12…" in text and "tidak ada key baru" in text
    assert "180 request/menit" in text and "Pro" in text
    assert "," not in text.split("Saldo")[1].split("\n")[0]


def test_receipt_for_first_purchase_shows_the_key_once():
    text = payments.notify_text("AETH-1", ROW, {"key": "sk-aeth_<full>", "balance_micro": 25_000_000_000})
    assert "<code>sk-aeth_&lt;full&gt;</code>" in text
    assert "hanya dikirim sekali" in text


# ------------------------------------------------------------------ manual grant RPM
def load_real_portal():
    spec = importlib.util.spec_from_file_location("app._portal_under_test", APP / "portal.py")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


class _Ctx:
    def __init__(self, value):
        self.value = value

    async def __aenter__(self):
        return self.value

    async def __aexit__(self, *exc):
        return False


class GrantConn:
    """Answers the queries internal_grant_order makes. Existing keys report 60 RPM."""

    def __init__(self, order):
        self.order = order

    def transaction(self):
        return _Ctx(None)

    async def fetchrow(self, q, *a):
        if "FROM orders" in q:
            return self.order
        if "FROM buyers" in q:
            return {"tg_id": 42, "username": "u", "name": "U"}
        return None

    async def fetchval(self, q, *a):
        return 60

    async def execute(self, q, *a):
        return None


def test_manual_grant_applies_the_package_rpm():
    portal = load_real_portal()
    order = {"id": "ORD", "status": "pending", "buyer_id": "b1", "sku": "pro",
             "credits_micro": 25_000_000_000, "rpm_limit": 180, "telegram_msg_id": None, "key_id": None}
    seen: dict[str, int] = {}

    async def payload(request, model=None):
        return None

    async def ensure_user(con, tg_id, sku, name):
        return "u1"

    async def key_for_grant(con, user_id, buyer_id, label, rpm):
        seen["rpm"] = rpm
        return "k1", "sk-aeth_new", "sk-aeth_new", False

    async def credit(*a):
        return 25_000_000_000

    async def audit(*a, **k):
        return None

    class Pool:
        def acquire(self):
            return _Ctx(GrantConn(order))

    portal._internal_payload = payload
    portal._client_ip = lambda request: "127.0.0.1"
    portal._ensure_user = ensure_user
    portal._key_for_grant = key_for_grant
    portal._credit = credit
    portal._grant_result = lambda *a: {"order_id": "ORD", "rpm_limit": a[-1]}
    db.pool = lambda: Pool()
    db.log_audit = audit

    result = asyncio.run(portal.internal_grant_order("ORD", request=None))
    assert seen["rpm"] == 180
    assert result["rpm_limit"] == 180
