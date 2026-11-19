"""Bot screens and flows against a fake Telegram + fake gateway (HTTP-level, no network).

Every Telegram call and every gateway call goes through `bot.client`, which is
swapped for an httpx.MockTransport, so the real request/response code paths run.

Run: python -m pytest bot/tests/test_bot_flow.py
"""
from __future__ import annotations

import json
import os
import re
import sys
from html.parser import HTMLParser
from pathlib import Path
from urllib.parse import urlparse

import httpx
import pytest

os.environ.update({
    "BOT_TOKEN": "0:test",
    "BOT_ENV_FILE": "/nonexistent",
    "AETHINK_INTERNAL_SECRET": "test-secret",
    "AETHINK_GATEWAY": "http://gw.test",
    "AETHINK_ADMINS": "1",
    "PORTAL_URL": "https://router.aethink.ai.id",
    "STORE_TEST_MODE": "0",
})
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import bot  # noqa: E402

BUYER, NEWBIE, ADMIN = 100, 200, 1

MODELS = [
    {"id": "deepseek-v4-pro", "display_name": "DeepSeek V4 Pro", "status": "on", "context_length": 1_000_000,
     "pricing_idr_per_1m": {"input": 2900, "output": 5800, "cached_input": 290}},
    {"id": "deepseek-v4-flash", "display_name": "DeepSeek V4 Flash", "status": "on", "context_length": 128_000,
     "pricing_idr_per_1m": {"input": 1200, "output": 2400}},
    {"id": "glm-5.1", "display_name": "GLM 5.1", "status": "on", "context_length": 200_000,
     "pricing_idr_per_1m": {"input": 9600, "output": 38400}},
    {"id": "kimi-k2.6", "display_name": "Kimi K2.6", "status": "maintenance", "context_length": 256_000,
     "pricing_idr_per_1m": {"input": 9600, "output": 40000}},
    {"id": "qwen3.6-plus", "display_name": "Qwen 3.6 Plus", "status": "on", "context_length": 1_000_000,
     "pricing_idr_per_1m": {"input": 6400, "output": 19200}},
    {"id": "minimax-m3", "display_name": "MiniMax M3", "status": "on", "context_length": 1_000_000,
     "pricing_idr_per_1m": {"input": 4800, "output": 19200}},
]
PACKAGES = [
    {"sku": "starter", "name": "Starter", "idr": 5000, "price_idr": 5000, "rpm": 60, "rpm_limit": 60,
     "credits_micro": 5_000_000_000, "blurb": "cocok buat coba-coba & bot pribadi", "sort": 1},
    {"sku": "pro", "name": "Pro", "idr": 25000, "price_idr": 25000, "rpm": 180, "rpm_limit": 180,
     "credits_micro": 25_000_000_000, "blurb": "buat produk kecil & automation harian", "sort": 2},
    {"sku": "max", "name": "Max", "idr": 100000, "price_idr": 100000, "rpm": 600, "rpm_limit": 600,
     "credits_micro": 100_000_000_000, "blurb": "traffic tinggi, parallel request", "sort": 3},
]


def snapshot(pending: bool = True) -> dict:
    orders = [{"id": "AETH-20261112-K2M9", "sku": "pro", "credits_micro": 25_000_000_000, "price_idr": 25000,
               "status": "granted", "created_at": "2026-11-12T03:10:00+00:00"},
              {"id": "AETH-20261101-Q7TT", "sku": "starter", "credits_micro": 5_000_000_000, "price_idr": 5000,
               "status": "expired", "created_at": "2026-11-01T10:00:00+00:00"}]
    if pending:
        orders.insert(0, {"id": "AETH-20261119-AB12", "sku": "starter", "credits_micro": 5_000_000_000,
                          "price_idr": 5000, "status": "pending", "created_at": "2026-11-19T07:40:00+00:00"})
    return {
        "buyer": {"id": "b1", "tg_id": BUYER, "username": "alya_dev", "name": "Alya", "status": "active",
                  "created_at": "2026-10-10T02:00:00+00:00"},
        "balance_micro": 72_000_000_000,
        "usage": {"requests": 18400, "tokens_in": 38_000_000, "tokens_out": 6_200_000,
                  "cost_micro": 41_800_000_000, "requests_24h": 34, "requests_7d": 815,
                  "spend_24h_micro": 1_240_000_000},
        "keys": [{"id": "k1", "prefix": "sk-aeth_9f2c", "user_id": "u1", "rpm_limit": 180, "status": "active",
                  "last_used_at": "2026-11-19T07:30:00+00:00", "created_at": "2026-10-10T02:00:00+00:00"}],
        "orders": orders,
    }


class World:
    """Fake Telegram + fake gateway. Tests tweak the attributes, then read `calls`."""

    def __init__(self):
        self.calls: list[tuple[str, dict]] = []      # (telegram method, params)
        self.gw: list[tuple[str, str, dict]] = []    # (verb, path, json body)
        self.next_id = 500
        self.snap = {BUYER: snapshot(), ADMIN: snapshot(pending=False)}
        self.models = list(MODELS)
        self.pay_status = "pending"
        self.grant = {"order_id": "AETH-20261119-AB12", "already_granted": False, "key": None,
                      "key_reused": True, "key_prefix": "sk-aeth_9f2c", "balance_micro": 77_000_000_000,
                      "rpm_limit": 180, "tg_id": BUYER, "telegram_msg_id": None}
        self.pay_create = {"order_id": "AETH-20261119-ZZ99", "status": "pending", "amount_idr": 25000,
                           "total_bayar": 25170, "fee_idr": 170, "qr_image": "https://qr.test/ZZ99.png",
                           "expires_at": "2026-11-19T08:30:00+00:00", "checkout_token": "tok",
                           "trx_reference": "WP-1"}
        self.tg_fail: dict[str, dict] = {}            # method -> error payload, consumed once

    # ------------------------------------------------------------- transport
    def handle(self, request: httpx.Request) -> httpx.Response:
        url = urlparse(str(request.url))
        body = json.loads(request.content or b"{}") if request.method == "POST" else {}
        if url.netloc == "api.telegram.org":
            method = url.path.rsplit("/", 1)[-1]
            self.calls.append((method, body))
            if method in self.tg_fail:
                return httpx.Response(200, json=self.tg_fail.pop(method))
            if method in ("sendMessage", "sendPhoto"):
                self.next_id += 1
                return httpx.Response(200, json={"ok": True, "result": {"message_id": self.next_id}})
            if method == "getMe":
                return httpx.Response(200, json={"ok": True, "result": {"id": 9, "username": "aethinkai_bot"}})
            return httpx.Response(200, json={"ok": True, "result": True})
        self.gw.append((request.method, url.path, body))
        return self.gateway(request.method, url.path, body)

    def gateway(self, verb: str, path: str, body: dict) -> httpx.Response:
        ok = lambda data: httpx.Response(200, json=data)  # noqa: E731
        if path == "/api/models":
            return ok({"data": self.models})
        if path == "/api/packages":
            return ok({"packages": PACKAGES})
        if path == "/api/miniapp":
            return ok({"available": True, "url": "https://router.aethink.ai.id/tg"})
        if path == "/api/status":
            return ok({})
        if path.startswith("/api/internal/buyer/"):
            snap = self.snap.get(int(path.rsplit("/", 1)[-1]))
            return ok(snap) if snap else httpx.Response(404, json={"error": {"code": "not_a_buyer"}})
        if path.startswith("/api/internal/pay/status/"):
            order_id = path.rsplit("/", 1)[-1]
            return ok({"order_id": order_id, "sku": "starter", "status": self.pay_status, "price_idr": 5000,
                       "total_bayar": 5070, "expires_at": "2026-11-19T08:30:00+00:00"})
        if path == "/api/internal/order-id":
            return ok({"order_id": "AETH-20261119-ZZ99"})
        if path == "/api/internal/order":
            return ok({"order_id": body.get("order_id"), "status": "pending"})
        if path == "/api/internal/pay/create":
            return ok(self.pay_create) if self.pay_create else httpx.Response(503, json={"error": "off"})
        if path.endswith("/grant"):
            return ok(self.grant)
        if path.startswith("/api/internal/order/"):
            return ok({"id": path.rsplit("/", 1)[-1], "sku": "pro", "tg_id": BUYER, "telegram_msg_id": None})
        if path == "/api/internal/rotate":
            return ok({"api_key": "sk-aeth_NEWKEY123", "prefix": "sk-aeth_NEWK", "rpm_limit": 180})
        if path == "/api/internal/pending":
            return ok({"orders": [{"id": "AETH-20261119-AB12", "tg_id": BUYER, "username": "alya_dev",
                                   "sku": "starter", "price_idr": 5000,
                                   "created_at": "2026-11-19T07:40:00+00:00"}]})
        if path == "/api/internal/buyers":
            return ok({"buyers": [{"tg_id": BUYER, "username": "alya_dev", "name": "Alya",
                                   "balance_micro": 72_000_000_000, "spend_micro": 41_800_000_000,
                                   "keys_active": 1}]})
        return httpx.Response(404, json={"error": f"no fake for {path}"})

    # ------------------------------------------------------------- helpers
    def screens(self) -> list[dict]:
        """Every message the bot showed: sent, edited, or photo captions."""
        out = []
        for method, p in self.calls:
            if method in ("sendMessage", "editMessageText", "sendPhoto", "editMessageCaption"):
                out.append({"method": method, "text": p.get("text") or p.get("caption") or "",
                            "kb": (p.get("reply_markup") or {}).get("inline_keyboard") or [],
                            "chat_id": p.get("chat_id"), "message_id": p.get("message_id"), "params": p})
        return out

    def last(self) -> dict:
        return self.screens()[-1]

    def toasts(self) -> list[str]:
        return [p.get("text", "") for m, p in self.calls if m == "answerCallbackQuery"]


@pytest.fixture()
def world(tmp_path, monkeypatch):
    w = World()
    monkeypatch.setattr(bot, "client", httpx.Client(transport=httpx.MockTransport(w.handle)))
    monkeypatch.setattr(bot, "STATE", tmp_path / "state.json")
    monkeypatch.setattr(bot.time, "sleep", lambda s: w.calls.append(("__sleep__", {"seconds": s})))
    bot._CACHE.clear()
    bot.hits.clear()
    bot.rotations.clear()
    bot.pings.clear()
    bot.refresh_packages()
    return w


def chat(uid: int, kind: str = "private") -> dict:
    return {"id": uid if kind == "private" else -1000 - uid, "type": kind}


def user(uid: int) -> dict:
    return {"id": uid, "first_name": {BUYER: "Alya", NEWBIE: "Bima", ADMIN: "Owner"}[uid], "username": f"u{uid}"}


def say(uid: int, text: str, kind: str = "private") -> None:
    bot.handle_update({"message": {"message_id": 1, "chat": chat(uid, kind), "from": user(uid), "text": text}})


def press(uid: int, data: str, message_id: int = 77, kind: str = "private", photo: bool = False) -> None:
    msg = {"message_id": message_id, "chat": chat(uid, kind), "text": "panel"}
    if photo:
        msg = {"message_id": message_id, "chat": chat(uid, kind), "photo": [{"file_id": "x"}], "caption": "inv"}
    bot.handle_update({"callback_query": {"id": "cb", "from": user(uid), "data": data, "message": msg}})


# ------------------------------------------------------------------ screen checks
ALLOWED_TAGS = {"b", "i", "u", "s", "code", "pre", "a", "blockquote", "tg-spoiler"}
EMOJI = re.compile("[\U0001F300-\U0001FAFF\u2600-\u26FF\u2B05\u2B06\u2B07\u2705\u274C\u23F3\u2139]")


class TagCheck(HTMLParser):
    def __init__(self):
        super().__init__()
        self.stack: list[str] = []
        self.errors: list[str] = []

    def handle_starttag(self, tag, attrs):
        if tag not in ALLOWED_TAGS:
            self.errors.append(f"tag <{tag}> not supported by Telegram")
        self.stack.append(tag)

    def handle_endtag(self, tag):
        if not self.stack or self.stack.pop() != tag:
            self.errors.append(f"unbalanced </{tag}>")


def check_screen(screen: dict) -> list[str]:
    problems = []
    text = screen["text"]
    limit = 1024 if screen["method"] in ("sendPhoto", "editMessageCaption") else 4096
    if len(text) > limit:
        problems.append(f"text {len(text)} > {limit}")
    parser = TagCheck()
    parser.feed(text)
    parser.close()
    problems += parser.errors + [f"unclosed <{t}>" for t in parser.stack]
    for row in screen["kb"]:
        for b in row:
            if "callback_data" in b and len(b["callback_data"].encode()) > 64:
                problems.append(f"callback_data > 64 bytes: {b['callback_data']}")
            if EMOJI.search(b["text"]):
                problems.append(f"emoji in button: {b['text']}")
    if EMOJI.search(text):
        problems.append("emoji in text")
    return problems


def callbacks(screen: dict) -> list[str]:
    return [b["callback_data"] for row in screen["kb"] for b in row if "callback_data" in b]


def crawl(world: World, uid: int) -> dict[str, dict]:
    """Press every reachable button once, starting from /start. Returns callback -> screen."""
    say(uid, "/start")
    seen: dict[str, dict] = {}
    queue = callbacks(world.last())
    while queue:
        data = queue.pop(0)
        if data in seen:
            continue
        before = len(world.calls)
        press(uid, data)
        new = world.calls[before:]
        shown = [c for c in new if c[0] in ("sendMessage", "editMessageText", "sendPhoto", "editMessageCaption")]
        toast = [c[1].get("text") for c in new if c[0] == "answerCallbackQuery" and c[1].get("text")]
        seen[data] = {"screens": [s for s in world.screens()[-len(shown):]] if shown else [], "toast": toast}
        for s in seen[data]["screens"]:
            queue += callbacks(s)
    return seen


# ------------------------------------------------------------------ tests: navigation
@pytest.mark.parametrize("uid", [BUYER, NEWBIE, ADMIN])
def test_every_button_answers_and_every_screen_is_valid(world, uid):
    if uid == NEWBIE:
        world.snap.pop(NEWBIE, None)
    seen = crawl(world, uid)
    assert len(seen) > 15
    dead = [data for data, r in seen.items() if not r["screens"] and not r["toast"]]
    assert dead == [], f"buttons with no visible response: {dead}"
    problems = {data: p for data, r in seen.items() for s in r["screens"] if (p := check_screen(s))}
    assert problems == {}


def test_every_panel_has_a_way_home(world):
    """The navigable panel (message 77) must always offer Home or a back (‹) button.
    Standalone messages (invoice, key, admin ping) are excluded on purpose."""
    seen = crawl(world, BUYER)
    stuck = []
    for data, r in seen.items():
        for s in r["screens"]:
            if s["method"] != "editMessageText" or s["message_id"] != 77 or data == "ui:home":
                continue
            buttons = [b for row in s["kb"] for b in row]
            if not any(b.get("callback_data") == "ui:home" or "‹" in b["text"] for b in buttons):
                stuck.append(data)
    assert stuck == []


def test_home_shows_balance_key_and_pending_invoice(world):
    say(BUYER, "/start")
    home = world.last()
    assert "Rp72.000" in home["text"]
    assert "sk-aeth_9f2c" in home["text"] and "180" in home["text"]
    assert any(d == "ui:order:AETH-20261119-AB12" for d in callbacks(home))


def test_new_user_home_explains_how_to_start(world):
    say(NEWBIE, "/start")
    home = world.last()
    assert "Rp0" not in home["text"] and "belum" in home["text"].lower()
    assert "ui:gw:credits" in callbacks(home)


def test_gateway_account_rpm_comes_from_the_key(world):
    press(BUYER, "ui:gw:home")
    assert "180 request/menit" in world.last()["text"]


def test_gateway_hub_reaches_keys_usage_models_and_credits(world):
    press(BUYER, "ui:gw:home")
    datas = callbacks(world.last())
    for target in ("ui:gw:credits", "ui:gw:keys", "ui:gw:usage", "ui:gw:models:0", "ui:gw:guide", "ui:home"):
        assert target in datas


def test_store_and_gateway_link_to_each_other(world):
    press(BUYER, "ui:st:home")
    assert "ui:gw:home" in callbacks(world.last())
    press(BUYER, "ui:gw:home")
    assert "ui:st:home" in callbacks(world.last()) or "ui:home" in callbacks(world.last())


def test_model_detail_survives_catalog_reorder(world):
    press(BUYER, "ui:gw:models:0")
    first_detail = next(d for d in callbacks(world.last()) if d.startswith("ui:gw:model:"))
    world.models.reverse()          # catalogue changed between the list and the tap
    bot._CACHE.clear()
    press(BUYER, first_detail)
    assert MODELS[0]["display_name"] in world.last()["text"]


@pytest.mark.parametrize("legacy", ["m:home", "m:models", "m:buy", "m:usage", "m:bal", "m:keys",
                                    "m:portal", "m:help", "m:support", "m:rewards", "ui:activity",
                                    "ui:activity:gw:0", "ui:activity:st:0", "ui:help:st", "ui:help:gw"])
def test_buttons_on_old_messages_still_open_a_screen(world, legacy):
    before = len(world.screens())
    press(BUYER, legacy)
    assert len(world.screens()) == before + 1


# ------------------------------------------------------------------ tests: purchase flow
def test_package_button_asks_for_confirmation_before_creating_a_qr(world):
    press(BUYER, "ui:gw:credits")
    pkg = next(d for d in callbacks(world.last()) if "pro" in d)
    press(BUYER, pkg)
    assert not any(path == "/api/internal/order" for _, path, _ in world.gw)
    assert "Rp25.000" in world.last()["text"]
    create = next(d for d in callbacks(world.last()) if d.startswith("qr:"))
    press(BUYER, create)
    assert any(path == "/api/internal/order" for _, path, _ in world.gw)
    assert any(path == "/api/internal/pay/create" for _, path, _ in world.gw)


def test_invoice_is_a_qr_photo_with_wib_expiry(world):
    press(BUYER, "qr:pro")
    photo = next(s for s in world.screens() if s["method"] == "sendPhoto")
    assert photo["params"]["photo"] == "https://qr.test/ZZ99.png"
    assert "15:30 WIB" in photo["text"]           # 08:30 UTC
    assert "Rp25.170" in photo["text"] and "Rp170" in photo["text"]


def test_invoice_falls_back_to_text_when_the_photo_fails(world):
    world.tg_fail["sendPhoto"] = {"ok": False, "description": "Bad Request: wrong file identifier/HTTP URL"}
    press(BUYER, "qr:pro")
    text_invoice = [s for s in world.screens() if s["method"] == "sendMessage" and "Invoice" in s["text"]]
    assert text_invoice and "15:30 WIB" in text_invoice[-1]["text"]
    assert any("url" in b and "qr.test" in b["url"] for row in text_invoice[-1]["kb"] for b in row)


def test_check_status_while_unpaid_keeps_the_invoice_untouched(world):
    world.pay_status = "pending"
    before = len(world.screens())
    press(BUYER, "pay:AETH-20261119-ZZ99", message_id=900, photo=True)
    assert len(world.screens()) == before
    assert any("Belum" in t for t in world.toasts())


def test_check_status_after_payment_marks_the_photo_invoice_paid(world):
    world.pay_status = "granted"
    press(BUYER, "pay:AETH-20261119-ZZ99", message_id=900, photo=True)
    last = world.last()
    assert last["method"] == "editMessageCaption" and last["message_id"] == 900
    assert "diterima" in last["text"].lower()


def test_expired_invoice_offers_a_new_one(world):
    world.pay_status = "expired"
    press(BUYER, "pay:AETH-20261119-ZZ99", message_id=900, photo=True)
    assert "ui:gw:credits" in callbacks(world.last())


def test_repeat_top_up_by_admin_grant_notifies_the_buyer(world):
    """Regression: the reused-key branch of do_grant referenced an undefined chat_id."""
    ok, note = bot.do_grant("AETH-20261119-AB12")
    assert ok
    to_buyer = [s for s in world.screens() if s["chat_id"] == BUYER]
    assert to_buyer and "Rp77.000" in to_buyer[-1]["text"] and "sk-aeth_9f2c" in to_buyer[-1]["text"]


def test_manual_grant_of_first_purchase_sends_the_key_once(world):
    world.grant.update({"key": "sk-aeth_FULLKEY", "key_reused": False})
    bot.do_grant("AETH-20261119-AB12")
    with_key = [s for s in world.screens() if "sk-aeth_FULLKEY" in s["text"]]
    assert len(with_key) == 1 and with_key[0]["chat_id"] == BUYER
    assert not any("callback_data" in b for row in with_key[0]["kb"] for b in row), \
        "a callback on the key message would edit the key away"


# ------------------------------------------------------------------ tests: safety
@pytest.mark.parametrize("command", ["/rotate", "/saldo", "/gateway", "/keys", "/topup", "/menu", "/start"])
def test_personal_commands_never_answer_inside_a_group(world, command):
    say(BUYER, command, kind="group")
    assert not any(path == "/api/internal/rotate" for _, path, _ in world.gw)
    for s in world.screens():
        assert "sk-aeth" not in s["text"] and "Rp72.000" not in s["text"]


def test_rotate_command_asks_before_killing_the_key(world):
    say(BUYER, "/rotate")
    assert not any(path == "/api/internal/rotate" for _, path, _ in world.gw)
    assert "rot:yes" in callbacks(world.last())
    press(BUYER, "rot:yes")
    new_key = [s for s in world.screens() if "sk-aeth_NEWKEY123" in s["text"]]
    assert len(new_key) == 1 and new_key[0]["method"] == "sendMessage"


def test_failed_edit_falls_back_to_a_new_message(world):
    world.tg_fail["editMessageText"] = {"ok": False, "description": "Bad Request: message can't be edited"}
    before = len([c for c in world.calls if c[0] == "sendMessage"])
    press(BUYER, "ui:gw:home")
    assert len([c for c in world.calls if c[0] == "sendMessage"]) == before + 1


def test_unchanged_panel_does_not_spawn_a_new_message(world):
    world.tg_fail["editMessageText"] = {"ok": False, "description": "Bad Request: message is not modified"}
    before = len([c for c in world.calls if c[0] == "sendMessage"])
    press(BUYER, "ui:gw:home")
    assert len([c for c in world.calls if c[0] == "sendMessage"]) == before


def test_rate_limit_waits_as_long_as_telegram_asks(world):
    world.tg_fail["sendMessage"] = {"ok": False, "error_code": 429,
                                    "description": "Too Many Requests: retry after 7",
                                    "parameters": {"retry_after": 7}}
    bot.send(BUYER, "x")
    sleeps = [p["seconds"] for m, p in world.calls if m == "__sleep__"]
    assert sleeps and sleeps[0] >= 7


def test_admin_screens_are_refused_to_buyers(world):
    for data in ("m:admin", "ui:admin", "m:pending", "g:AETH-20261119-AB12"):
        press(BUYER, data)
    assert not any(path.endswith("/grant") for _, path, _ in world.gw)
    assert not any(path == "/api/internal/pending" for _, path, _ in world.gw)
