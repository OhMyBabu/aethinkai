"""Unit tests for payments.settle_order across several provider refs of one order.

No database, no network: the pool, provider and portal are stubbed.

Run: python -m pytest gateway/tests/test_settle_refs.py
"""
from __future__ import annotations

import asyncio
import sys
import types
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

fake_portal = types.ModuleType("app.portal")
fake_portal._bad = lambda code, msg, status=400, **kw: RuntimeError(code)
fake_portal._bot_token = lambda: ""
fake_portal.portal_identity = lambda: None
fake_portal.grant_calls = []


async def _grant(order_id):
    fake_portal.grant_calls.append(order_id)
    return {"order_id": order_id, "already_granted": False, "key": None}


fake_portal.grant_order = _grant
sys.modules["app.portal"] = fake_portal

from app import db, payments  # noqa: E402


class FakePool:
    def __init__(self, refs):
        self.refs = refs
        self.executed: list[str] = []

    async def fetch(self, q, *a):
        if "provider_ref" in q and "payment_intents" in q:
            return [{"provider_ref": r, "order_id": a[0]} for r in self.refs]
        return []

    async def fetchrow(self, q, *a):
        if "FROM payment_intents" in q and self.refs:
            return {"provider_ref": self.refs[0]}
        return None

    async def execute(self, q, *a):
        self.executed.append(" ".join(q.split()))

    async def fetchval(self, q, *a):
        return None


def run(refs, states):
    """refs are newest-first; states maps provider_ref -> provider_status result."""
    pool = FakePool(refs)
    calls: list[str] = []

    async def fake_status(ref):
        calls.append(ref)
        return states[ref]

    db.pool = lambda: pool
    payments.provider_status = fake_status
    payments.notify_buyer = lambda *a, **k: asyncio.sleep(0)

    async def audit(*a, **k):
        return None

    db.log_audit = audit
    fake_portal.grant_calls.clear()
    result = asyncio.run(payments.settle_order("ORD", source="test"))
    return result, pool, calls


def paid():
    return {"state": "paid", "data": {"trx_reference": "T1", "total_bayar": 5000}, "raw": {}}


def pending():
    return {"state": "pending", "data": {}, "raw": {}}


def expired():
    return {"state": "expired", "data": {}, "raw": {}}


def test_payment_on_older_ref_is_settled():
    result, _, calls = run(["ORD-2", "ORD"], {"ORD-2": pending(), "ORD": paid()})
    assert result["settled"] is True
    assert fake_portal.grant_calls == ["ORD"]
    assert set(calls) == {"ORD-2", "ORD"}


def test_payment_on_newest_ref_still_settled():
    result, _, _ = run(["ORD-2", "ORD"], {"ORD-2": paid(), "ORD": expired()})
    assert result["settled"] is True


def test_older_ref_expired_newer_pending_is_not_expired():
    result, pool, _ = run(["ORD-2", "ORD"], {"ORD-2": pending(), "ORD": expired()})
    assert result == {"settled": False, "reason": "pending"}
    assert not any("status='expired'" in q.replace(" ", "") or "status = 'expired'" in q
                   for q in pool.executed)


def test_all_refs_expired_closes_the_order():
    result, pool, _ = run(["ORD-2", "ORD"], {"ORD-2": expired(), "ORD": expired()})
    assert result == {"settled": False, "reason": "expired"}
    assert any(q.startswith("UPDATE orders SET status='expired'") for q in pool.executed)


def test_unreachable_provider_never_expires_or_grants():
    result, pool, _ = run(["ORD-2", "ORD"], {"ORD-2": None, "ORD": expired()})
    assert result == {"settled": False, "reason": "provider_unreachable"}
    assert fake_portal.grant_calls == []
    assert pool.executed == []


def test_single_ref_behaviour_unchanged():
    result, _, calls = run(["ORD"], {"ORD": paid()})
    assert result["settled"] is True and calls == ["ORD"]


def test_no_intent_falls_back_to_order_id():
    result, _, calls = run([], {"ORD": pending()})
    assert result == {"settled": False, "reason": "pending"}
    assert calls == ["ORD"]
