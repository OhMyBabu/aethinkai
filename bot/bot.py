#!/usr/bin/env python3
"""AethinkAI Telegram bot: account panel and storefront in front of the gateway.

One panel message is edited as the buyer navigates (`ui:*` callbacks). Messages that
must survive navigation are sent separately and never carry callback buttons that
would overwrite them: invoices (QR photo), API keys, receipts.

The bot holds no money and no keys. Balances, orders, keys and usage live in the
gateway behind HMAC-signed /api/internal/* routes; the bot only renders them.
See docs/BOT_FLOW.md for the screen map and the payment sequence.

Env (/root/.secrets/aethink-bot.env):
  BOT_TOKEN, AETHINK_ADMINS, AETHINK_GATEWAY, AETHINK_INTERNAL_FILE, PORTAL_URL, STORE_TEST_MODE
"""
from __future__ import annotations

import hashlib
import hmac
import html
import json
import os
import re
import sys
import time
import traceback
from collections import defaultdict, deque
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any
from urllib.parse import urlparse

import httpx


def _load_env() -> None:
    """Load the deployment env file when started outside a shell (pm2/systemd)."""
    path = Path(os.environ.get("BOT_ENV_FILE", "/root/.secrets/aethink-bot.env"))
    if not path.exists():
        return
    for line in path.read_text().splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        os.environ.setdefault(key.strip(), value.strip())


_load_env()

ROOT = Path(__file__).resolve().parent
STATE = ROOT / "data" / "state.json"
STATE.parent.mkdir(parents=True, exist_ok=True)

BOT_TOKEN = os.environ["BOT_TOKEN"]
GATEWAY = os.environ.get("AETHINK_GATEWAY", "http://127.0.0.1:8080")
SECRET_FILE = os.environ.get("AETHINK_INTERNAL_FILE", "/root/.secrets/aethink-internal")
ADMINS = {int(x) for x in re.split(r"[,\s]+", os.environ.get("AETHINK_ADMINS", "541900896")) if x.strip()}
TEST_MODE = os.environ.get("STORE_TEST_MODE", "0") == "1"

API = f"https://api.telegram.org/bot{BOT_TOKEN}"
WIB = timezone(timedelta(hours=7))
MONTHS = ["Jan", "Feb", "Mar", "Apr", "Mei", "Jun", "Jul", "Agu", "Sep", "Okt", "Nov", "Des"]
REPLY_KB_VERSION = "2"
BOT_USERNAME = ""

PACKAGES = [
    {"sku": "starter", "name": "Starter", "idr": 5_000, "rpm": 60,
     "blurb": "cocok buat coba-coba & bot pribadi"},
    {"sku": "pro", "name": "Pro", "idr": 25_000, "rpm": 180,
     "blurb": "buat produk kecil & automation harian"},
    {"sku": "max", "name": "Max", "idr": 100_000, "rpm": 600,
     "blurb": "traffic tinggi, parallel request"},
]
PKG = {p["sku"]: p for p in PACKAGES}

client = httpx.Client(timeout=40)
hits: dict[int, deque] = defaultdict(deque)
rotations: dict[int, deque] = defaultdict(deque)
pings: dict[int, deque] = defaultdict(deque)


def refresh_packages() -> None:
    """Catalogue lives in the gateway (/api/packages); the bot only caches it."""
    global PACKAGES, PKG
    try:
        res = client.get(f"{GATEWAY}/api/packages", timeout=10)
        if res.status_code == 200:
            items = res.json().get("packages") or []
            if items:
                PACKAGES = sorted(items, key=lambda p: (p.get("sort") or 0, p.get("idr") or 0))
                PKG = {p["sku"]: p for p in PACKAGES}
    except Exception as err:
        print(f"[packages] fallback lokal: {err}", flush=True)


# ---------------------------------------------------------------- plumbing
def secret() -> str:
    env = os.environ.get("AETHINK_INTERNAL_SECRET")
    if env:
        return env.strip()
    return Path(SECRET_FILE).read_text().strip()


def state() -> dict:
    try:
        return json.loads(STATE.read_text())
    except Exception:
        return {}


def save_state(data: dict) -> None:
    """Merge instead of replace: the poller writes offset while flags live here too."""
    current = state()
    current.update(data)
    STATE.write_text(json.dumps(current))


def post_internal(path: str, payload: dict) -> tuple[int, dict]:
    body = json.dumps(payload, separators=(",", ":")).encode()
    ts = int(time.time())
    sig = hmac.new(secret().encode(), f"{ts}.".encode() + body, hashlib.sha256).hexdigest()
    req = client.build_request("POST", f"{GATEWAY}{path}", content=body,
                               headers={"Content-Type": "application/json",
                                        "X-Timestamp": str(ts), "X-Signature": sig})
    try:
        res = client.send(req)
    except Exception as err:
        return 0, {"error": {"message": f"gateway tidak terjangkau: {err}"}}
    try:
        return res.status_code, res.json()
    except Exception:
        return res.status_code, {"error": res.text[:200]}


def get_internal(path: str, signed_for: str) -> tuple[int, dict]:
    ts = int(time.time())
    sig = hmac.new(secret().encode(), f"{ts}.{signed_for}".encode(), hashlib.sha256).hexdigest()
    try:
        res = client.get(f"{GATEWAY}{path}", headers={"X-Timestamp": str(ts), "X-Signature": sig})
    except Exception as err:
        return 0, {"error": {"message": f"gateway tidak terjangkau: {err}"}}
    try:
        return res.status_code, res.json()
    except Exception:
        return res.status_code, {"error": res.text[:200]}


def error_message(data: dict, status: int) -> str:
    err = (data or {}).get("error")
    if isinstance(err, dict):
        return err.get("message") or err.get("code") or f"HTTP {status}"
    return str(err or f"HTTP {status}")


def rate_ok(store: dict[int, deque], uid: int, limit: int, window: float) -> bool:
    now = time.time()
    q = store[uid]
    while q and q[0] < now - window:
        q.popleft()
    if len(q) >= limit:
        return False
    q.append(now)
    return True


_CACHE: dict[str, tuple[float, object]] = {}


def _cached(key: str, ttl: float, fn):
    now = time.time()
    hit = _CACHE.get(key)
    if hit and now - float(hit[0]) < ttl:
        return hit[1]
    val = fn()
    _CACHE[key] = (now, val)
    return val


# ---------------------------------------------------------------- telegram
def tg_call(method: str, **params: Any) -> tuple[bool, Any]:
    """(True, result) or (False, description). Waits out 429s for as long as Telegram asks."""
    for attempt in range(3):
        try:
            data = client.post(f"{API}/{method}", json=params).json()
        except Exception as err:
            if attempt == 2:
                print(f"[tg] {method} error: {err}", flush=True)
                return False, str(err)
            time.sleep(1.5)
            continue
        if data.get("ok"):
            return True, data.get("result")
        desc = str(data.get("description", ""))
        retry = (data.get("parameters") or {}).get("retry_after")
        if data.get("error_code") == 429 or "retry after" in desc.lower():
            time.sleep(float(retry or 3) + 0.5)
            continue
        if "message is not modified" not in desc:
            print(f"[tg] {method} failed: {desc}", flush=True)
        return False, desc
    return False, "rate limited"


def tg(method: str, **params: Any) -> dict:
    ok, result = tg_call(method, **params)
    if not ok:
        return {}
    return result if isinstance(result, dict) else {"ok": True}


def _markup(keyboard: list | None) -> dict:
    return {"reply_markup": {"inline_keyboard": keyboard}} if keyboard else {}


def send(chat_id: int, text: str, keyboard: list | None = None) -> dict:
    return tg("sendMessage", chat_id=chat_id, text=text, parse_mode="HTML",
              disable_web_page_preview=True, **_markup(keyboard))


def edit(chat_id: int, message_id: int | None, text: str, keyboard: list | None = None) -> None:
    """Edit the panel in place. If Telegram refuses (photo message, too old, deleted),
    send the screen as a new message so a tap never ends in silence."""
    if message_id:
        ok, desc = tg_call("editMessageText", chat_id=chat_id, message_id=message_id, text=text,
                           parse_mode="HTML", disable_web_page_preview=True, **_markup(keyboard))
        if ok or "message is not modified" in str(desc):
            return
    send(chat_id, text, keyboard)


def edit_caption(chat_id: int, message_id: int, text: str, keyboard: list | None = None) -> None:
    ok, desc = tg_call("editMessageCaption", chat_id=chat_id, message_id=message_id, caption=text,
                       parse_mode="HTML", **_markup(keyboard))
    if not ok and "message is not modified" not in str(desc):
        send(chat_id, text, keyboard)


def ack(cb_id: str, text: str = "", alert: bool = False) -> None:
    tg("answerCallbackQuery", callback_query_id=cb_id, text=text[:190], show_alert=alert)


def btn(label: str, data: str) -> dict:
    return {"text": label, "callback_data": data}


def url_btn(label: str, url: str) -> dict:
    return {"text": label, "url": url}


def web_app_btn(label: str, url: str) -> dict:
    return {"text": label, "web_app": {"url": url}}


def send_reply_keyboard(chat_id: int) -> dict:
    """Persistent shortcuts under the input field. Inline panels stay the primary UI."""
    keyboard = [[{"text": "Store"}, {"text": "Gateway"}],
                [{"text": "Akun"}, {"text": "Bantuan"}]]
    return tg("sendMessage", chat_id=chat_id, text="Menu cepat aktif di bawah kolom chat.",
              reply_markup={"keyboard": keyboard, "resize_keyboard": True, "is_persistent": True})


# ---------------------------------------------------------------- formatting
def rupiah(value: int | float) -> str:
    """Rp25.000: no space, dots for thousands."""
    return "Rp" + f"{int(round(float(value or 0))):,}".replace(",", ".")


def rupiah_micro(micro: int | float) -> str:
    return rupiah((micro or 0) / 1_000_000)


def number(value: int | float) -> str:
    return f"{int(value or 0):,}".replace(",", ".")


def esc(value: Any) -> str:
    return html.escape(str(value if value is not None else ""))


def _parse(iso: str | None) -> datetime | None:
    if not iso:
        return None
    try:
        when = datetime.fromisoformat(str(iso).replace("Z", "+00:00"))
    except ValueError:
        return None
    return when if when.tzinfo else when.replace(tzinfo=timezone.utc)


def date_id(iso: str | None) -> str:
    when = _parse(iso)
    if not when:
        return "-"
    when = when.astimezone(WIB)
    return f"{when.day} {MONTHS[when.month - 1]} {when.year}"


def time_wib(iso: str | None) -> str:
    """Gateway timestamps are UTC; buyers read WIB."""
    when = _parse(iso)
    if not when:
        return "-"
    when = when.astimezone(WIB)
    return f"{when.day} {MONTHS[when.month - 1]}, {when:%H:%M} WIB"


def ago(iso: str | None) -> str:
    when = _parse(iso)
    if not when:
        return "belum pernah"
    minutes = max(0, int((datetime.now(timezone.utc) - when).total_seconds() // 60))
    if minutes < 1:
        return "baru saja"
    if minutes < 60:
        return f"{minutes} menit lalu"
    hours = minutes // 60
    return f"{hours} jam lalu" if hours < 24 else f"{hours // 24} hari lalu"


def short_name(name: str, width: int = 24) -> str:
    return name if len(name) <= width else name[: width - 1].rstrip() + "…"


def package_name(sku: str | None) -> str:
    return str(PKG.get(sku or "", {}).get("name") or sku or "paket")


def portal_url() -> str:
    env = os.environ.get("PORTAL_URL", "").strip()
    if env:
        return env.rstrip("/")
    try:
        log = Path("/root/.pm2/logs/aethink-tunnel-error.log").read_text(errors="ignore")
        found = re.findall(r"https://[a-z0-9-]+\.trycloudflare\.com", log)
        if found:
            return found[-1]
    except Exception:
        pass
    return "http://127.0.0.1:4173"


def site_label() -> str:
    return urlparse(portal_url()).netloc or "Dashboard"


def api_base() -> str:
    env = os.environ.get("API_BASE_URL", "").strip()
    return (env or portal_url()).rstrip("/") + "/v1"


# ---------------------------------------------------------------- gateway reads
def buyer_snapshot(uid: int) -> dict | None:
    s, data = get_internal(f"/api/internal/buyer/{uid}", f"buyer:{uid}")
    return data if s == 200 else None


def catalog_models() -> list[dict]:
    """Live catalogue from the gateway, never a hardcoded price table."""
    def fetch() -> list[dict]:
        try:
            res = client.get(f"{GATEWAY}/api/models", timeout=10)
            return res.json().get("data", []) if res.status_code == 200 else []
        except Exception:
            return []
    return _cached("models", 300, fetch)


def miniapp_link() -> str:
    def fetch() -> str:
        try:
            body = client.get(f"{GATEWAY}/api/miniapp", timeout=5).json()
            return body.get("url", "") if body.get("available") else ""
        except Exception:
            return ""
    return _cached("miniapp", 60, fetch)


def store_catalog() -> list[dict]:
    """Single adapter for the Digital Store catalogue (docs/STORE_DESIGN.md).
    The store service does not exist yet, so this returns nothing and every store
    screen renders an honest empty state. When the service lands only this changes."""
    return []


def primary_key(snap: dict | None) -> dict | None:
    keys = (snap or {}).get("keys") or []
    return keys[0] if keys else None


def account_rpm(snap: dict | None) -> int | None:
    key = primary_key(snap)
    return int(key["rpm_limit"]) if key and key.get("rpm_limit") else None


def pending_order(uid: int, snap: dict | None = None) -> dict | None:
    snap = snap if snap is not None else buyer_snapshot(uid)
    return next((o for o in (snap or {}).get("orders") or [] if o.get("status") == "pending"), None)


def dashboard_button(mini_label: str = "Buka Mini App", web_label: str = "Dashboard") -> dict:
    """Mini App inside Telegram when it is deployed, the web dashboard otherwise."""
    mini = miniapp_link()
    return web_app_btn(mini_label, mini) if mini else url_btn(f"{web_label}  ↗", f"{portal_url()}/portal")


HOME = btn("‹ Menu Utama", "ui:home")
TO_GATEWAY = btn("‹ AI Gateway", "ui:gw:home")
TO_STORE = btn("‹ Digital Store", "ui:st:home")


# ---------------------------------------------------------------- screens: home
def account_block(snap: dict | None) -> str:
    if not snap:
        return ("<blockquote>Akun gateway kamu belum aktif.\n"
                "Isi kredit sekali, API key langsung dikirim ke chat ini.</blockquote>")
    key = primary_key(snap)
    usage = snap.get("usage") or {}
    lines = [f"Saldo API <b>{rupiah_micro(snap.get('balance_micro'))}</b>"]
    if key:
        lines.append(f"Key <code>{esc(key.get('prefix'))}…</code> · {account_rpm(snap)} request/menit")
    else:
        lines.append("Belum ada key aktif")
    lines.append(f"{number(usage.get('requests_24h'))} request dalam 24 jam")
    return "<blockquote>" + "\n".join(lines) + "</blockquote>"


def home_text(user: dict | None = None, snap: dict | None = None) -> str:
    name = esc((user or {}).get("first_name") or "")
    greet = f"Halo, {name}." if name else "Halo."
    store_line = ("Produk digital, dikirim langsung ke chat ini." if store_catalog()
                  else "Katalog sedang disiapkan.")
    return (
        f"✦ <b>AethinkAI</b>\n{greet}\n\n"
        f"{account_block(snap)}\n\n"
        f"<b>AI Gateway</b> · satu API untuk banyak model, bayar sesuai pemakaian.\n"
        f"<b>Digital Store</b> · {store_line}"
    )


def home_keyboard(uid: int, snap: dict | None = None) -> list:
    rows = [[btn("AI Gateway  ›", "ui:gw:home"), btn("Digital Store  ›", "ui:st:home")]]
    pending = pending_order(uid, snap) if snap else None
    if pending:
        rows.append([btn(f"◌ Invoice belum dibayar · {rupiah(pending.get('price_idr', 0))}",
                         f"ui:order:{pending.get('id')}")])
    elif not snap:
        rows.append([btn("Mulai: Isi Kredit", "ui:gw:credits")])
    rows.append([btn("Akun", "ui:acct"), btn("Bantuan", "ui:help")])
    rows.append([dashboard_button()])
    if uid in ADMINS:
        rows.append([btn("Admin", "ui:admin")])
    return rows


def home_screen(uid: int, user: dict | None) -> tuple[str, list]:
    snap = buyer_snapshot(uid)
    return home_text(user, snap), home_keyboard(uid, snap)


# ---------------------------------------------------------------- screens: gateway
def gateway_home(uid: int) -> tuple[str, list]:
    snap = buyer_snapshot(uid)
    count = len(catalog_models())
    models_line = f"{count} model" if count else "banyak model"
    text = (
        "✦ <b>AI Gateway</b>\n"
        f"Satu endpoint OpenAI-compatible untuk {models_line}. "
        "Bayar per token dari saldo, tanpa langganan bulanan.\n\n"
        f"{account_block(snap)}\n\n"
        f"Base URL <code>{esc(api_base())}</code>"
    )
    kb = [
        [btn("Isi Kredit", "ui:gw:credits"), btn("API Key", "ui:gw:keys")],
        [btn("Pemakaian", "ui:gw:usage"), btn("Model & Harga", "ui:gw:models:0")],
        [btn("Cara Pakai", "ui:gw:guide"), dashboard_button("Mini App")],
        [btn("Digital Store  ›", "ui:st:home")],
        [HOME],
    ]
    return text, kb


def gateway_credits(uid: int) -> tuple[str, list]:
    lines = ["<b>Isi Kredit</b>",
             "Kredit = nilai rupiah yang kamu bayar, dipakai per token sesuai tarif model.", ""]
    rows = []
    for p in PACKAGES:
        rpm = p.get("rpm") or p.get("rpm_limit")
        lines.append(f"<b>{esc(p.get('name'))}</b> · {rupiah(p.get('idr', 0))}")
        detail = " · ".join(x for x in [esc(p.get("blurb") or ""), f"{rpm} request/menit" if rpm else ""] if x)
        if detail:
            lines.append(detail)
        lines.append("")
        rows.append([btn(f"{p.get('name')} · {rupiah(p.get('idr', 0))}", f"ui:gw:pkg:{p.get('sku')}")])
    lines.append("Bayar dengan QRIS. Saldo masuk otomatis setelah pembayaran terverifikasi.")
    pending = pending_order(uid)
    if pending:
        lines += ["", f"◌ Kamu masih punya invoice {rupiah(pending.get('price_idr', 0))} yang belum dibayar."]
        rows.insert(0, [btn("◌ Buka invoice yang belum dibayar", f"ui:order:{pending.get('id')}")])
    rows.append([url_btn("Nominal lain  ↗", f"{portal_url()}/portal#isi-saldo")])
    rows.append([TO_GATEWAY])
    return "\n".join(lines), rows


def gateway_confirm(sku: str) -> tuple[str, list]:
    pkg = PKG.get(sku)
    if not pkg:
        return "<b>Paket tidak tersedia</b>\n\nDaftar paket sudah berubah.", [[btn("‹ Isi Kredit", "ui:gw:credits")]]
    rpm = pkg.get("rpm") or pkg.get("rpm_limit")
    lines = [
        "<b>Konfirmasi pembelian</b>",
        "",
        f"Paket: <b>{esc(pkg.get('name'))}</b>",
        f"Kredit masuk: <b>{rupiah(pkg.get('idr', 0))}</b>",
    ]
    if rpm:
        lines.append(f"Batas: {rpm} request/menit")
    lines += ["Metode: QRIS (biaya QRIS tertera di invoice)", "",
              "QR baru dibuat setelah kamu menekan tombol di bawah."]
    kb = [[btn(f"Buat QRIS · {rupiah(pkg.get('idr', 0))}", f"qr:{sku}")],
          [btn("‹ Pilih paket lain", "ui:gw:credits")]]
    return "\n".join(lines), kb


def gateway_keys(uid: int) -> tuple[str, list]:
    snap = buyer_snapshot(uid)
    if not snap:
        return ("<b>API Key</b>\n\nBelum ada API key. Key dibuat otomatis dan dikirim ke chat ini "
                "saat pembelian kredit pertama.",
                [[btn("Isi Kredit", "ui:gw:credits")], [TO_GATEWAY]])
    keys = snap.get("keys") or []
    if not keys:
        return ("<b>API Key</b>\n\nTidak ada key aktif di akun ini. Hubungi admin untuk mengaktifkan lagi.",
                [[btn("Chat Admin", "s:ping")], [TO_GATEWAY]])
    lines = ["<b>API Key</b>", ""]
    for k in keys:
        status = "Aktif" if (k.get("status") or "active") == "active" else esc(k.get("status"))
        lines += [f"<code>{esc(k.get('prefix'))}…</code>",
                  f"{status} · {k.get('rpm_limit')} request/menit · dipakai {ago(k.get('last_used_at'))}",
                  f"Dibuat {date_id(k.get('created_at'))}", ""]
    lines.append("Key lengkap hanya dikirim sekali, saat pembelian pertama atau saat membuat key baru. "
                 "Kalau hilang atau bocor, buat key baru; key lama langsung mati.")
    kb = [[btn("Buat Key Baru", "rot:ask"), btn("Cara Pakai", "ui:gw:guide")], [TO_GATEWAY]]
    return "\n".join(lines), kb


def rotate_confirm(uid: int) -> tuple[str, list]:
    key = primary_key(buyer_snapshot(uid))
    if not key:
        return gateway_keys(uid)
    text = ("<b>Buat key baru?</b>\n\n"
            f"Key <code>{esc(key.get('prefix'))}…</code> langsung mati. Aplikasi yang masih memakainya "
            "harus diganti ke key baru.\n\nKey baru dikirim ke chat ini, sekali saja.")
    return text, [[btn("Ya, buat key baru", "rot:yes")], [btn("‹ Batal", "ui:gw:keys")]]


def gateway_usage(uid: int) -> tuple[str, list]:
    snap = buyer_snapshot(uid)
    if not snap:
        return ("<b>Pemakaian</b>\n\nBelum ada pemakaian. Angka muncul setelah API key dipakai.",
                [[btn("Isi Kredit", "ui:gw:credits")], [TO_GATEWAY]])
    u = snap.get("usage") or {}
    text = (
        "<b>Pemakaian</b>\n\n"
        f"24 jam: <b>{number(u.get('requests_24h'))}</b> request · {rupiah_micro(u.get('spend_24h_micro'))}\n"
        f"7 hari: <b>{number(u.get('requests_7d'))}</b> request\n"
        f"Sejak awal: <b>{number(u.get('requests'))}</b> request\n\n"
        f"Token masuk: {number(u.get('tokens_in'))}\n"
        f"Token keluar: {number(u.get('tokens_out'))}\n"
        f"Total biaya: {rupiah_micro(u.get('cost_micro'))}\n\n"
        f"Saldo sekarang: <b>{rupiah_micro(snap.get('balance_micro'))}</b>"
    )
    return text, [[dashboard_button("Grafik di Mini App", "Grafik di dashboard")],
                  [btn("Isi Kredit", "ui:gw:credits"), TO_GATEWAY]]


MODELS_PER_PAGE = 5


def model_ref(m: dict, idx: int) -> str:
    """Callback key for a model: its id (stable when the catalogue reorders), else the index."""
    mid = str(m.get("id") or "")
    return mid if mid and len(f"ui:gw:model:{mid}:99".encode()) <= 64 and ":" not in mid else f"#{idx}"


def find_model(ref: str) -> dict | None:
    models = catalog_models()
    if ref.startswith("#"):
        idx = int(ref[1:]) if ref[1:].isdigit() else -1
        return models[idx] if 0 <= idx < len(models) else None
    return next((m for m in models if str(m.get("id")) == ref), None)


def model_status(status: str) -> str:
    return {"on": "Tersedia", "maintenance": "Gangguan sementara"}.get((status or "").lower(), "Tidak diketahui")


def gateway_models(page: int) -> tuple[str, list]:
    models = catalog_models()
    if not models:
        return ("<b>Model & Harga</b>\n\nKatalog belum bisa dimuat. Coba lagi sebentar.",
                [[btn("Coba lagi", "ui:gw:models:0")], [TO_GATEWAY]])
    pages = max(1, -(-len(models) // MODELS_PER_PAGE))
    page = max(0, min(page, pages - 1))
    chunk = models[page * MODELS_PER_PAGE:(page + 1) * MODELS_PER_PAGE]
    lines = ["<b>Model & Harga</b>",
             f"Rupiah per 1 juta token · {len(models)} model · halaman {page + 1}/{pages}", ""]
    buttons = []
    for offset, m in enumerate(chunk):
        price = m.get("pricing_idr_per_1m") or {}
        name = str(m.get("display_name") or m.get("id"))
        flag = "" if (m.get("status") or "on") == "on" else f" · {model_status(m.get('status'))}"
        lines += [f"<b>{esc(name)}</b>{esc(flag)}",
                  f"masuk {rupiah(price.get('input', 0))} · keluar {rupiah(price.get('output', 0))}", ""]
        buttons.append(btn(short_name(name, 18),
                           f"ui:gw:model:{model_ref(m, page * MODELS_PER_PAGE + offset)}:{page}"))
    rows = [buttons[i:i + 2] for i in range(0, len(buttons), 2)]
    nav = []
    if page > 0:
        nav.append(btn("‹ Sebelumnya", f"ui:gw:models:{page - 1}"))
    if page < pages - 1:
        nav.append(btn("Berikutnya ›", f"ui:gw:models:{page + 1}"))
    if nav:
        rows.append(nav)
    rows.append([dashboard_button("Katalog lengkap di Mini App", "Katalog lengkap")])
    rows.append([TO_GATEWAY])
    return "\n".join(lines).rstrip(), rows


def gateway_model(ref: str, page: int) -> tuple[str, list]:
    m = find_model(ref)
    if not m:
        return ("<b>Model tidak ditemukan</b>\n\nModel ini sudah tidak ada di katalog.",
                [[btn("‹ Model & Harga", "ui:gw:models:0")]])
    price = m.get("pricing_idr_per_1m") or {}
    ctx = int(m.get("context_length") or 0)
    ctx_text = (f"{ctx // 1_000_000}M token" if ctx >= 1_000_000 and ctx % 1_000_000 == 0
                else f"{number(ctx // 1000)}K token" if ctx else "-")
    lines = [
        f"<b>{esc(m.get('display_name') or m.get('id'))}</b>",
        f"<code>{esc(m.get('id'))}</code>",
        "",
        f"Status: {model_status(m.get('status'))}",
        f"Konteks: {ctx_text}",
        f"Masuk: <b>{rupiah(price.get('input', 0))}</b> / 1 juta token",
        f"Keluar: <b>{rupiah(price.get('output', 0))}</b> / 1 juta token",
    ]
    if price.get("cached_input"):
        lines.append(f"Cache: {rupiah(price['cached_input'])} / 1 juta token")
    caps = [c for c, on in (m.get("capabilities") or {}).items() if on]
    if caps:
        lines.append("Kemampuan: " + esc(", ".join(caps)))
    lines += ["", "Pakai ID di atas sebagai <code>model</code> saat memanggil API."]
    return "\n".join(lines), [[btn("Cara Pakai", "ui:gw:guide")], [btn("‹ Model & Harga", f"ui:gw:models:{page}")]]


def gateway_guide() -> tuple[str, list]:
    models = catalog_models()
    model = str(models[0].get("id")) if models else "nama-model"
    curl = (f"curl {api_base()}/chat/completions \\\n"
            "  -H \"Authorization: Bearer $AETHINK_KEY\" \\\n"
            "  -H \"Content-Type: application/json\" \\\n"
            f"  -d '{{\"model\":\"{model}\",\"messages\":[{{\"role\":\"user\",\"content\":\"halo\"}}]}}'")
    text = (
        "<b>Cara Pakai</b>\n\n"
        "1. Ambil API key dari pesan pembelian (awalan <code>sk-aeth_</code>).\n"
        "2. Pakai SDK OpenAI, ganti base URL ke:\n"
        f"<code>{esc(api_base())}</code>\n"
        "3. Pilih model dari menu Model & Harga.\n\n"
        f"<pre>{esc(curl)}</pre>"
    )
    return text, [[url_btn("Panduan lengkap  ↗", f"{portal_url()}/panduan")],
                  [btn("Model & Harga", "ui:gw:models:0"), TO_GATEWAY]]


ORDER_STATUS = {
    "pending": ("◌", "Menunggu pembayaran"),
    "paid": ("◌", "Dibayar, sedang diproses"),
    "granted": ("✓", "Kredit ditambahkan"),
    "expired": ("×", "Kedaluwarsa"),
    "cancelled": ("×", "Dibatalkan"),
    "failed": ("×", "Gagal"),
}


def order_status(status: str) -> tuple[str, str]:
    return ORDER_STATUS.get(status, ("·", status))


def order_panel(uid: int, order_id: str) -> tuple[str, list]:
    snap = buyer_snapshot(uid)
    order = next((o for o in (snap or {}).get("orders") or [] if o.get("id") == order_id), None)
    if not order:
        return ("<b>Invoice tidak ditemukan</b>\n\nDaftar transaksi sudah berubah.",
                [[btn("Transaksi Kredit", "ui:acct:gw:0")], [HOME]])
    symbol, label = order_status(str(order.get("status")))
    lines = [
        "<b>Invoice</b>",
        f"<code>{esc(order_id)}</code>",
        "",
        f"Paket: {esc(package_name(order.get('sku')))}",
        f"Nominal: <b>{rupiah(order.get('price_idr', 0))}</b>",
        f"Status: {symbol} {label}",
        f"Dibuat: {time_wib(order.get('created_at'))}",
    ]
    kb = []
    if order.get("status") == "pending":
        lines += ["", "QR ada di pesan invoice. Setelah membayar, tekan Cek Status."]
        kb.append([btn("Cek Status", f"pay:{order_id}")])
    elif order.get("status") in ("expired", "cancelled", "failed"):
        kb.append([btn("Buat invoice baru", "ui:gw:credits")])
    kb.append([btn("Transaksi Kredit", "ui:acct:gw:0"), HOME])
    return "\n".join(lines), kb


# ---------------------------------------------------------------- screens: store
def store_home() -> tuple[str, list]:
    products = store_catalog()
    head = ("✦ <b>Digital Store</b>\n"
            "Produk digital yang dikirim langsung ke chat ini setelah pembayaran terverifikasi.\n\n")
    if not products:
        text = head + ("<blockquote>Katalog sedang disiapkan, belum ada produk yang bisa dibeli.</blockquote>\n\n"
                       "Layanan yang sudah berjalan: <b>AI Gateway</b>, API untuk banyak model AI.")
        kb = [[btn("Lihat AI Gateway  ›", "ui:gw:home")],
              [btn("Pesanan Saya", "ui:st:orders:0"), btn("Bantuan", "ui:help")],
              [HOME]]
        return text, kb
    text = head + f"{len(products)} produk tersedia. Pilih kategori untuk melihat harga dan stok."
    kb = [[btn("Lihat Kategori", "ui:st:cats")],
          [btn("Pesanan Saya", "ui:st:orders:0"), btn("Bantuan", "ui:help")],
          [btn("AI Gateway  ›", "ui:gw:home")],
          [HOME]]
    return text, kb


def store_category_names() -> list[str]:
    cats: list[str] = []
    for p in store_catalog():
        if p.get("category") and p["category"] not in cats:
            cats.append(p["category"])
    return cats


def store_categories() -> tuple[str, list]:
    if not store_catalog():
        return store_home()
    rows = [[btn(str(c), f"ui:st:prods:{i}:0")] for i, c in enumerate(store_category_names()[:8])]
    rows.append([TO_STORE])
    return "<b>Kategori</b>\nPilih kategori yang ingin kamu lihat.", rows


PRODUCTS_PER_PAGE = 4


def store_products(cat: int, page: int) -> tuple[str, list]:
    products = store_catalog()
    cats = store_category_names()
    if products and cats and 0 <= cat < len(cats):
        products = [p for p in products if p.get("category") == cats[cat]]
    if not products:
        return ("<b>Belum ada produk</b>\n\nProduk untuk kategori ini belum tersedia.",
                [[btn("‹ Kategori", "ui:st:cats")], [HOME]])
    pages = max(1, -(-len(products) // PRODUCTS_PER_PAGE))
    page = max(0, min(page, pages - 1))
    chunk = products[page * PRODUCTS_PER_PAGE:(page + 1) * PRODUCTS_PER_PAGE]
    first = page * PRODUCTS_PER_PAGE + 1
    lines = [f"<b>{esc(cats[cat]) if 0 <= cat < len(cats) else 'Produk'}</b>",
             f"Produk {first}–{first + len(chunk) - 1} dari {len(products)}", ""]
    rows = []
    for p in chunk:
        stock = "Tersedia" if p.get("in_stock", True) else "Habis"
        lines += [f"<b>{esc(p.get('name'))}</b>", f"mulai {rupiah(p.get('price_from') or 0)} · {stock}", ""]
        rows.append([btn(f"{short_name(str(p.get('name', '')), 26)}  ›", f"ui:st:product:{p.get('id')}:{cat}:{page}")])
    nav = []
    if page > 0:
        nav.append(btn("‹ Sebelumnya", f"ui:st:prods:{cat}:{page - 1}"))
    if page < pages - 1:
        nav.append(btn("Berikutnya ›", f"ui:st:prods:{cat}:{page + 1}"))
    if nav:
        rows.append(nav)
    rows.append([btn("‹ Kategori", "ui:st:cats"), HOME])
    return "\n".join(lines).rstrip(), rows


def store_product(pid: str, cat: int, page: int) -> tuple[str, list]:
    product = next((p for p in store_catalog() if str(p.get("id")) == str(pid)), None)
    if not product:
        return store_products(cat, page)
    variants = product.get("variants") or []
    cheapest = min((v.get("price_idr", 0) for v in variants), default=product.get("price_from") or 0)
    in_stock = bool(product.get("in_stock", bool(variants)))
    lines = [
        f"<b>{esc(product.get('name'))}</b>",
        "",
        esc(product.get("description") or "Deskripsi produk belum tersedia."),
        "",
        f"Harga: mulai <b>{rupiah(cheapest)}</b>",
        f"Durasi: {esc(product.get('duration') or 'sesuai varian')}",
        f"Stok: {'Tersedia' if in_stock else 'Habis'}",
    ]
    kb = []
    if in_stock and variants:
        kb.append([btn("Beli", f"ui:st:buy:{pid}")])
    kb.append([btn("‹ Daftar Produk", f"ui:st:prods:{cat}:{page}"), HOME])
    return "\n".join(lines), kb


def store_checkout_closed() -> tuple[str, list]:
    return ("<b>Checkout belum dibuka</b>\n\n"
            "Pembayaran otomatis untuk Digital Store belum aktif. Admin bisa membantu pesanan secara manual.",
            [[btn("Chat Admin", "s:ping")], [TO_STORE]])


def store_orders(page: int) -> tuple[str, list]:
    return ("<b>Pesanan Store</b>\n\nBelum ada pesanan. Pesanan Digital Store akan muncul di sini.",
            [[btn("Ke Digital Store", "ui:st:home")], [btn("‹ Akun", "ui:acct"), HOME]])


# ---------------------------------------------------------------- screens: account & help
def account_home(uid: int, user: dict | None) -> tuple[str, list]:
    snap = buyer_snapshot(uid)
    who = esc(" ".join(x for x in [(user or {}).get("first_name"), (user or {}).get("last_name")] if x) or "-")
    handle = f" (@{esc(user['username'])})" if (user or {}).get("username") else ""
    lines = ["<b>Akun</b>", "", f"Telegram: {who}{handle}", f"ID: <code>{uid}</code>"]
    if snap:
        buyer = snap.get("buyer") or {}
        lines += [f"Akun gateway: aktif sejak {date_id(buyer.get('created_at'))}",
                  f"Saldo: <b>{rupiah_micro(snap.get('balance_micro'))}</b>"]
    else:
        lines.append("Akun gateway: belum aktif")
    kb = [[btn("Transaksi Kredit", "ui:acct:gw:0"), btn("Pesanan Store", "ui:acct:st:0")],
          [btn("API Key", "ui:gw:keys"), btn("Pemakaian", "ui:gw:usage")],
          [HOME]]
    return "\n".join(lines), kb


TX_PER_PAGE = 5


def account_transactions(uid: int, page: int) -> tuple[str, list]:
    orders = (buyer_snapshot(uid) or {}).get("orders") or []
    if not orders:
        return ("<b>Transaksi Kredit</b>\n\nBelum ada transaksi.",
                [[btn("Isi Kredit", "ui:gw:credits")], [btn("‹ Akun", "ui:acct"), HOME]])
    pages = max(1, -(-len(orders) // TX_PER_PAGE))
    page = max(0, min(page, pages - 1))
    chunk = orders[page * TX_PER_PAGE:(page + 1) * TX_PER_PAGE]
    lines = ["<b>Transaksi Kredit</b>", f"{len(orders)} transaksi terakhir", ""]
    rows = []
    for o in chunk:
        symbol, label = order_status(str(o.get("status")))
        lines += [f"{symbol} <b>{esc(package_name(o.get('sku')))}</b> · {rupiah(o.get('price_idr', 0))}",
                  f"{label} · {date_id(o.get('created_at'))}",
                  f"<code>{esc(o.get('id'))}</code>", ""]
        if o.get("status") == "pending":
            rows.append([btn(f"◌ Buka invoice {rupiah(o.get('price_idr', 0))}", f"ui:order:{o.get('id')}")])
    nav = []
    if page > 0:
        nav.append(btn("‹ Sebelumnya", f"ui:acct:gw:{page - 1}"))
    if page < pages - 1:
        nav.append(btn("Berikutnya ›", f"ui:acct:gw:{page + 1}"))
    if nav:
        rows.append(nav)
    rows.append([btn("‹ Akun", "ui:acct"), HOME])
    return "\n".join(lines).rstrip(), rows


def help_home() -> tuple[str, list]:
    text = (
        "<b>Bantuan</b>\n\n"
        "<b>Saldo belum masuk setelah bayar?</b>\n"
        "Buka invoice lalu tekan Cek Status. Pembayaran dicek langsung ke penyedia QRIS.\n\n"
        "<b>API key hilang atau bocor?</b>\n"
        "AI Gateway › API Key › Buat Key Baru. Key lama langsung mati.\n\n"
        "<b>Request API error?</b>\n"
        "Cek saldo dan pastikan ID model sesuai daftar Model & Harga.\n\n"
        "<b>Pesanan Digital Store</b>\n"
        "Produk dikirim ke chat ini setelah pembayaran terverifikasi.\n\n"
        "Masih perlu bantuan? Kirim pesan ke admin; ID Telegram kamu ikut terkirim supaya admin bisa membalas."
    )
    return text, [[btn("Chat Admin", "s:ping"), url_btn("Panduan API  ↗", f"{portal_url()}/panduan")],
                  [HOME]]


# ---------------------------------------------------------------- screens: admin
def admin_view() -> tuple[str, list]:
    s, data = get_internal("/api/internal/pending", "pending")
    pending = len((data or {}).get("orders") or []) if s == 200 else 0
    s2, buyers = get_internal("/api/internal/buyers", "buyers")
    total = len((buyers or {}).get("buyers") or []) if s2 == 200 else 0
    text = ("<b>Admin</b>\n\n"
            f"Order menunggu konfirmasi: <b>{pending}</b>\n"
            f"Pembeli terdaftar: <b>{total}</b>")
    return text, [[btn(f"Order menunggu ({pending})", "ui:admin:pending")],
                  [btn(f"Pembeli ({total})", "ui:admin:buyers")],
                  [HOME]]


def pending_view() -> tuple[str, list]:
    s, data = get_internal("/api/internal/pending", "pending")
    back = btn("‹ Admin", "ui:admin")
    if s != 200:
        return "Gagal memuat order. Coba lagi.", [[btn("Muat ulang", "ui:admin:pending"), back]]
    orders = (data or {}).get("orders") or []
    if not orders:
        return ("<b>Order menunggu</b>\n\nTidak ada order yang menunggu.",
                [[btn("Muat ulang", "ui:admin:pending"), back]])
    lines = [f"<b>Order menunggu</b> ({len(orders)})", ""]
    rows: list[list] = []
    for o in orders[:8]:
        who = f"@{o['username']}" if o.get("username") else f"tg {o.get('tg_id')}"
        lines += [f"<code>{esc(o.get('id'))}</code>",
                  f"{esc(who)} · {esc(package_name(o.get('sku')))} · {rupiah(o.get('price_idr', 0))} · "
                  f"{ago(o.get('created_at'))}", ""]
        rows.append([btn(f"Grant {str(o.get('id'))[-6:]} · {who}", f"g:{o.get('id')}")])
    rows.append([btn("Muat ulang", "ui:admin:pending"), back])
    return "\n".join(lines).rstrip(), rows


def buyers_view() -> tuple[str, list]:
    s, data = get_internal("/api/internal/buyers", "buyers")
    back = btn("‹ Admin", "ui:admin")
    if s != 200:
        return "Gagal memuat pembeli. Coba lagi.", [[btn("Muat ulang", "ui:admin:buyers"), back]]
    buyers = (data or {}).get("buyers") or []
    if not buyers:
        return "<b>Pembeli</b>\n\nBelum ada pembeli.", [[btn("Muat ulang", "ui:admin:buyers"), back]]
    lines = [f"<b>Pembeli</b> ({len(buyers)})", ""]
    for b in buyers[:12]:
        who = f"@{b['username']}" if b.get("username") else (b.get("name") or f"tg {b.get('tg_id')}")
        lines += [f"{esc(who)} · <code>{b.get('tg_id')}</code>",
                  f"saldo {rupiah_micro(b.get('balance_micro'))} · terpakai {rupiah_micro(b.get('spend_micro'))} · "
                  f"{b.get('keys_active', 0)} key", ""]
    return "\n".join(lines).rstrip(), [[btn("Muat ulang", "ui:admin:buyers"), back]]


# ---------------------------------------------------------------- telegram link
def confirm_link(code: str, user: dict) -> None:
    """Web asked for t.me/<bot>?start=link_<code>; the bot proves the human owns this account."""
    chat_id = user.get("id")
    status, data = post_internal("/api/internal/link/confirm", {
        "code": code,
        "tg_id": user.get("id"),
        "username": user.get("username"),
        "name": " ".join(filter(None, [user.get("first_name"), user.get("last_name")])) or None,
    })
    if status != 200:
        send(chat_id, f"× <b>Tidak bisa menghubungkan</b>\n\n{esc(error_message(data, status))}",
             [[HOME]])
        return
    send(chat_id,
         "✓ <b>Telegram terhubung</b>\n\n"
         "Kembali ke halaman web; dalam beberapa detik akunmu otomatis masuk. "
         "Pembelian dan API key berikutnya dikirim ke chat ini.",
         [[url_btn("Kembali ke web  ↗", f"{portal_url()}/portal")], [HOME]])


# ---------------------------------------------------------------- order flow
def create_order(user: dict, sku: str, msg_id: int | None = None) -> tuple[str, dict] | None:
    pkg = PKG[sku]
    # invoice ids are issued by the gateway so every order looks the same: AETH-YYYYMMDD-XXXX
    status, ref = post_internal("/api/internal/order-id", {})
    order_id = ref.get("order_id") if status == 200 else ""
    if not order_id:
        return None
    status, data = post_internal("/api/internal/order", {
        "order_id": order_id,
        "tg_id": user["id"],
        "username": user.get("username"),
        "name": " ".join(filter(None, [user.get("first_name"), user.get("last_name")])) or None,
        "sku": pkg["sku"],
        "credits_micro": int(pkg.get("credits_micro") or pkg["idr"] * 1_000_000),
        "price_idr": int(pkg.get("price_idr") or pkg["idr"]),
        "rpm_limit": int(pkg.get("rpm_limit") or pkg["rpm"]),
        "payment_ref": order_id,
        "telegram_msg_id": msg_id,
    })
    if status != 200:
        print(f"[order] {status} {data}", flush=True)
        return None
    return order_id, data


def create_payment(order_id: str) -> dict | None:
    """Ask the gateway for a QRIS code. None = provider not configured (manual mode)."""
    status, data = post_internal("/api/internal/pay/create", {"order_id": order_id})
    if status != 200:
        print(f"[pay] create {status} {data}", flush=True)
        return None
    return data


def invoice_text(order_id: str, pkg: dict, pay: dict | None = None) -> str:
    lines = [f"<b>Invoice</b> <code>{esc(order_id)}</code>", "",
             f"Paket: <b>{esc(pkg.get('name'))}</b> · kredit {rupiah(pkg.get('idr', 0))}"]
    if pay:
        total = int(pay.get("total_bayar") or pkg.get("idr") or 0)
        fee = int(pay.get("fee_idr") or 0)
        lines.append(f"Bayar: <b>{rupiah(total)}</b>" + (f" (termasuk biaya QRIS {rupiah(fee)})" if fee else ""))
        if pay.get("expires_at"):
            lines.append(f"Berlaku sampai: <b>{time_wib(pay['expires_at'])}</b>")
        lines += ["", "Scan QR dengan aplikasi bank atau e-wallet dan bayar tepat sesuai nominal. "
                      "Saldo masuk otomatis; bot mengabari di chat ini."]
        return "\n".join(lines)
    lines += ["Status: menunggu pembayaran", "",
              "Pembayaran manual: transfer atau QRIS ke admin, lalu tekan Saya sudah bayar. "
              "Admin memverifikasi, lalu kredit masuk ke akun ini."]
    return "\n".join(lines)


def invoice_keyboard(order_id: str, pay: dict | None, with_qr_link: bool = False) -> list:
    """Only status/link buttons: a navigation callback would overwrite the invoice."""
    if pay:
        rows = [[btn("Cek Status", f"pay:{order_id}")]]
        links = []
        if with_qr_link and pay.get("qr_image"):
            links.append(url_btn("Buka QR  ↗", pay["qr_image"]))
        links.append(url_btn("Bayar di web  ↗",
                             f"{portal_url()}/pay/{order_id}?t={pay.get('checkout_token', '')}"))
        rows.append(links)
        return rows
    return [[btn("Saya sudah bayar", f"paid:{order_id}")]]


def send_invoice(chat_id: int, order_id: str, pkg: dict, pay: dict | None) -> None:
    """QR as a photo when the provider gives an image; text with a QR link otherwise."""
    text = invoice_text(order_id, pkg, pay)
    if pay and pay.get("qr_image"):
        ok, _ = tg_call("sendPhoto", chat_id=chat_id, photo=pay["qr_image"], caption=text,
                        parse_mode="HTML", **_markup(invoice_keyboard(order_id, pay)))
        if ok:
            return
    send(chat_id, text, invoice_keyboard(order_id, pay, with_qr_link=True))


def receipt_text(order_id: str, sku: str | None, credits_micro: int | None, balance_micro: int,
                 rpm: int | None, key: str = "", key_prefix: str = "") -> str:
    """Same layout as the gateway's receipt (gateway/app/payments.py notify_text)."""
    lines = ["✓ <b>Pembayaran diterima</b>", f"<code>{esc(order_id)}</code>", "",
             f"Paket   : {esc(package_name(sku))}"]
    if credits_micro:
        lines.append(f"Kredit  : +{rupiah_micro(credits_micro)}")
    lines.append(f"Saldo   : <b>{rupiah_micro(balance_micro)}</b>")
    if rpm:
        lines.append(f"Batas   : {rpm} request/menit")
    lines.append("")
    if key:
        lines += ["<b>API key kamu</b>", f"<code>{esc(key)}</code>", "",
                  "Simpan sekarang. Key lengkap hanya dikirim sekali; kalau hilang, "
                  "buat key baru lewat menu API Key."]
    else:
        lines.append(f"Saldo masuk ke akun yang sama. Key kamu tetap <code>{esc(key_prefix)}…</code>, "
                     "tidak ada key baru.")
    return "\n".join(lines)


def key_message_keyboard() -> list:
    """URL buttons only: a callback on the key message would let navigation edit the key away."""
    return [[url_btn("Panduan API  ↗", f"{portal_url()}/panduan"),
             url_btn(f"{site_label()}  ↗", f"{portal_url()}/portal")]]


def do_grant(order_id: str) -> tuple[bool, str]:
    """Admin/test-mode grant. Delivers the same receipt the webhook path sends."""
    status, data = post_internal(f"/api/internal/order/{order_id}/grant", {})
    if status != 200:
        return False, error_message(data, status)
    if data.get("already_granted"):
        return True, f"Order <code>{esc(order_id)}</code> sudah pernah di-grant (key {esc(data.get('key_prefix'))}…)."

    s, order = get_internal(f"/api/internal/order/{order_id}", order_id)
    order = order if s == 200 else {}
    buyer_tg = data.get("tg_id") or order.get("tg_id")
    sku = order.get("sku")
    if buyer_tg:
        text = receipt_text(order_id, sku, order.get("credits_micro"), int(data.get("balance_micro") or 0),
                            int(data.get("rpm_limit") or 0) or None,
                            key="" if data.get("key_reused") else str(data.get("key") or ""),
                            key_prefix=str(data.get("key_prefix") or ""))
        send(int(buyer_tg), text, key_message_keyboard())
    return True, (f"✓ Order <code>{esc(order_id)}</code> di-grant. "
                  f"Struk dikirim ke pembeli (key {esc(data.get('key_prefix'))}…).")


def do_rotate(chat_id: int, uid: int, panel: int | None = None) -> None:
    status, data = post_internal("/api/internal/rotate", {"tg_id": uid})
    if status != 200:
        edit(chat_id, panel, f"<b>Tidak bisa membuat key baru</b>\n\n{esc(error_message(data, status))}",
             [[btn("Chat Admin", "s:ping")], [btn("‹ API Key", "ui:gw:keys")]])
        return
    send(chat_id,
         "✓ <b>Key baru aktif</b>\n\n"
         f"<code>{esc(data.get('api_key'))}</code>\n\n"
         f"Batas: {data.get('rpm_limit')} request/menit. Key lama sudah mati.\n"
         "Simpan sekarang; key lengkap hanya dikirim sekali.",
         key_message_keyboard())
    edit(chat_id, panel, "<b>Key baru sudah dikirim</b>\n\nCek pesan di bawah, lalu ganti key di aplikasimu.",
         [[btn("‹ API Key", "ui:gw:keys"), HOME]])


# ---------------------------------------------------------------- routing
def is_private(chat: dict | None) -> bool:
    return (chat or {}).get("type") == "private"


def private_only_notice(chat_id: int) -> None:
    kb = [[url_btn("Buka chat pribadi  ↗", f"https://t.me/{BOT_USERNAME}")]] if BOT_USERNAME else None
    send(chat_id, "Menu, saldo dan API key hanya tersedia di chat pribadi dengan bot ini.", kb)


def route(data: str, uid: int, user: dict) -> tuple[str, list] | None:
    """Pure navigation: callback data -> (text, keyboard). None means not a navigation callback."""
    parts = data.split(":")

    def arg(i: int, default: int = 0) -> int:
        try:
            return int(parts[i])
        except (IndexError, ValueError):
            return default

    if data in ("ui:home", "m:home"):
        return home_screen(uid, user)
    # gateway
    if data in ("ui:gw:home", "m:portal"):
        return gateway_home(uid)
    if data in ("ui:gw:credits", "m:buy"):
        return gateway_credits(uid)
    if data.startswith("ui:gw:pkg:"):
        return gateway_confirm(data.split(":", 3)[3])
    if data.startswith("buy:"):                        # package buttons on old messages
        return gateway_confirm(data.split(":", 1)[1])
    if data in ("ui:gw:keys", "m:keys"):
        return gateway_keys(uid)
    if data in ("ui:gw:usage", "m:usage", "m:bal"):
        return gateway_usage(uid)
    if data == "ui:gw:guide" or data == "m:help":
        return gateway_guide()
    if data == "m:models" or (data.startswith("ui:gw:models")):
        return gateway_models(arg(3))
    if data.startswith("ui:gw:model:"):
        rest = data[len("ui:gw:model:"):]
        ref, _, page = rest.rpartition(":")
        if not ref:                                    # no page suffix
            ref, page = rest, "0"
        if ref.isdigit():                              # index refs from the old bot
            ref = f"#{ref}"
        return gateway_model(ref, int(page) if page.isdigit() else 0)
    if data == "rot:ask":
        return rotate_confirm(uid)
    if data.startswith("ui:order:"):
        return order_panel(uid, data.split(":", 2)[2])
    # store
    if data == "ui:st:home":
        return store_home()
    if data == "ui:st:cats":
        return store_categories()
    if data.startswith("ui:st:prods:"):
        return store_products(arg(3), arg(4))
    if data.startswith("ui:st:product:"):
        return store_product(parts[3] if len(parts) > 3 else "", arg(4), arg(5))
    if data.startswith("ui:st:buy:"):
        return store_checkout_closed()
    if data.startswith("ui:st:orders"):
        return store_orders(arg(3))
    # account & help (ui:activity* are the old names)
    if data in ("ui:acct", "ui:activity"):
        return account_home(uid, user)
    if data.startswith("ui:acct:gw") or data.startswith("ui:activity:gw"):
        return account_transactions(uid, arg(3))
    if data.startswith("ui:acct:st") or data.startswith("ui:activity:st"):
        return store_orders(arg(3))
    if data in ("ui:help", "ui:help:st", "ui:help:gw", "m:support", "m:rewards"):
        return help_home()
    return None


ADMIN_ROUTES = {
    "ui:admin": admin_view, "m:admin": admin_view,
    "ui:admin:pending": pending_view, "m:pending": pending_view,
    "ui:admin:buyers": buyers_view, "m:buyers": buyers_view,
}


def check_payment(cb_id: str, chat_id: int, mid: int, msg: dict, order_id: str) -> None:
    status, st = get_internal(f"/api/internal/pay/status/{order_id}", order_id)
    if status != 200:
        ack(cb_id, "Gagal cek status. Coba lagi sebentar.")
        return
    state_ = st.get("status")
    is_photo = bool(msg.get("photo"))
    if state_ == "granted":
        ack(cb_id, "Pembayaran diterima")
        text = (f"✓ <b>Pembayaran diterima</b>\n<code>{esc(order_id)}</code>\n\n"
                f"Paket {esc(package_name(st.get('sku')))} · {rupiah(st.get('price_idr', 0))}\n"
                "Saldo sudah masuk. Struk dan saldo terbaru dikirim di pesan terpisah.")
        kb = [[btn("API Key", "ui:gw:keys"), HOME]]
        edit_caption(chat_id, mid, text, kb) if is_photo else edit(chat_id, mid, text, kb)
        return
    if state_ in ("expired", "cancelled", "failed"):
        ack(cb_id, "Invoice sudah tidak berlaku")
        _, label = order_status(str(state_))
        text = (f"× <b>Invoice {label.lower()}</b>\n<code>{esc(order_id)}</code>\n\n"
                "QR ini tidak bisa dipakai lagi. Kalau kamu sudah terlanjur membayar, hubungi admin.")
        kb = [[btn("Buat invoice baru", "ui:gw:credits")], [btn("Chat Admin", "s:ping"), HOME]]
        edit_caption(chat_id, mid, text, kb) if is_photo else edit(chat_id, mid, text, kb)
        return
    # still pending: a toast only, so the QR and its buttons stay on screen
    ack(cb_id, "Belum ada pembayaran masuk. Setelah membayar, tunggu 10–30 detik lalu cek lagi.", alert=True)


def ping_admins(cb_id: str, chat_id: int, mid: int, uid: int, sender: dict) -> None:
    if not rate_ok(pings, uid, 2, 600):
        ack(cb_id, "Pesanmu sudah diteruskan. Admin akan membalas di chat ini.", alert=True)
        return
    ack(cb_id, "Diteruskan ke admin")
    who = f"@{sender['username']}" if sender.get("username") else (sender.get("first_name") or "pengguna")
    note = ("<b>Permintaan bantuan</b>\n\n"
            f"Dari: <b>{esc(who)}</b> · ID <code>{uid}</code>\n"
            "Balas langsung ke pengguna lewat tombol di bawah.")
    for admin in ADMINS:
        if admin != uid:
            send(admin, note, [[url_btn("Buka chat pengguna  ↗", f"tg://user?id={uid}")]])
    edit(chat_id, mid, "✓ <b>Pesan terkirim ke admin</b>\n\nAdmin akan membalas langsung di chat ini.",
         [[HOME]])


def handle_callback(cb: dict) -> None:
    uid = (cb.get("from") or {}).get("id")
    data = cb.get("data") or ""
    cb_id = cb.get("id")
    msg = cb.get("message") or {}
    chat = msg.get("chat") or {}
    chat_id = chat.get("id")
    mid = msg.get("message_id")
    sender = cb.get("from") or {}
    if not uid or not chat_id:
        return
    if not is_private(chat):
        ack(cb_id, "Buka bot di chat pribadi untuk memakai menu ini.", alert=True)
        return

    screen = route(data, uid, sender)
    if screen is not None:
        ack(cb_id)
        edit(chat_id, mid, *screen)
        return

    if data in ADMIN_ROUTES:
        if uid not in ADMINS:
            ack(cb_id, "Khusus admin")
            return
        ack(cb_id)
        edit(chat_id, mid, *ADMIN_ROUTES[data]())
        return

    if data.startswith("qr:"):
        sku = data.split(":", 1)[1]
        pkg = PKG.get(sku)
        if not pkg:
            ack(cb_id, "Paket tidak tersedia")
            edit(chat_id, mid, *gateway_credits(uid))
            return
        if not rate_ok(hits, uid, 20, 60):
            ack(cb_id, "Terlalu cepat. Tunggu sebentar.")
            return
        ack(cb_id, "Membuat invoice…")
        created = create_order(sender, sku, mid)
        if not created:
            edit(chat_id, mid, "<b>Invoice gagal dibuat</b>\n\nGateway sedang tidak bisa dihubungi. Coba lagi sebentar.",
                 [[btn("Coba lagi", f"ui:gw:pkg:{sku}")], [HOME]])
            return
        order_id, _ = created
        if TEST_MODE:
            ok, _note = do_grant(order_id)
            edit(chat_id, mid, f"Invoice <code>{esc(order_id)}</code> · {esc(pkg.get('name'))}: "
                               f"<b>{'lunas (mode uji)' if ok else 'gagal grant'}</b>", [[HOME]])
            return
        pay = create_payment(order_id)
        send_invoice(chat_id, order_id, pkg, pay)
        edit(chat_id, mid,
             f"<b>Invoice dibuat</b>\n<code>{esc(order_id)}</code>\n\n"
             + ("QR ada di pesan di bawah. Saldo masuk otomatis setelah pembayaran terverifikasi."
                if pay else "Instruksi pembayaran manual ada di pesan di bawah."),
             [[btn("Lihat status", f"ui:order:{order_id}")], [HOME]])
        if not pay:
            notify = (f"<b>Order baru</b> <code>{esc(order_id)}</code>\n"
                      f"@{esc(sender.get('username') or uid)} · {esc(pkg.get('name'))} · {rupiah(pkg.get('idr', 0))}")
            for admin in ADMINS:
                if admin != uid:
                    send(admin, notify, [[btn("Grant sekarang", f"g:{order_id}")]])
        return

    if data.startswith("pay:"):
        check_payment(cb_id, chat_id, mid, msg, data.split(":", 1)[1])
        return

    if data.startswith("paid:"):
        order_id = data.split(":", 1)[1]
        ack(cb_id, "Diteruskan ke admin")
        edit(chat_id, mid,
             f"◌ <b>Menunggu konfirmasi admin</b>\n<code>{esc(order_id)}</code>\n\n"
             "Admin mengecek pembayaran, lalu struk dikirim ke chat ini.", [[HOME]])
        for admin in ADMINS:
            if admin != uid:
                send(admin, f"<b>Pembeli mengaku sudah bayar</b>\n<code>{esc(order_id)}</code>\n"
                            f"@{esc(sender.get('username') or uid)}\n\nCek mutasi, lalu grant.",
                     [[btn("Grant sekarang", f"g:{order_id}")]])
        return

    if data.startswith("g:"):
        if uid not in ADMINS:
            ack(cb_id, "Khusus admin")
            return
        ok, note = do_grant(data.split(":", 1)[1])
        ack(cb_id, "Granted" if ok else "Gagal")
        edit(chat_id, mid, note, [[btn("Order menunggu", "ui:admin:pending"), btn("‹ Admin", "ui:admin")]])
        return

    if data == "rot:yes":
        if not rate_ok(rotations, uid, 3, 3600):
            ack(cb_id, "Maksimal 3 kali per jam", alert=True)
            return
        ack(cb_id, "Membuat key baru…")
        do_rotate(chat_id, uid, panel=mid)
        return

    if data == "s:ping":
        ping_admins(cb_id, chat_id, mid, uid, sender)
        return

    # unknown or retired button: land on home instead of a silent spinner
    ack(cb_id, "Menu ini sudah diperbarui")
    edit(chat_id, mid, *home_screen(uid, sender))


COMMANDS = {
    "/gateway": lambda uid, user: gateway_home(uid),
    "/store": lambda uid, user: store_home(),
    "/topup": lambda uid, user: gateway_credits(uid),
    "/paket": lambda uid, user: gateway_credits(uid),
    "/buy": lambda uid, user: gateway_credits(uid),
    "/saldo": lambda uid, user: gateway_usage(uid),
    "/balance": lambda uid, user: gateway_usage(uid),
    "/usage": lambda uid, user: gateway_usage(uid),
    "/keys": lambda uid, user: gateway_keys(uid),
    "/rotate": lambda uid, user: rotate_confirm(uid),
    "/models": lambda uid, user: gateway_models(0),
    "/akun": lambda uid, user: account_home(uid, user),
    "/help": lambda uid, user: help_home(),
    "/bantuan": lambda uid, user: help_home(),
    "/portal": lambda uid, user: gateway_home(uid),
}
SHORTCUTS = {
    "store": lambda uid, user: store_home(),
    "gateway": lambda uid, user: gateway_home(uid),
    "akun": lambda uid, user: account_home(uid, user),
    "account": lambda uid, user: account_home(uid, user),
    "bantuan": lambda uid, user: help_home(),
    "support": lambda uid, user: help_home(),
}


def install_reply_keyboard(chat_id: int, uid: int) -> None:
    installed = dict(state().get("reply_kb") or {})
    if installed.get(str(uid)) != REPLY_KB_VERSION:
        send_reply_keyboard(chat_id)
        installed[str(uid)] = REPLY_KB_VERSION
        save_state({"reply_kb": installed})


def handle_message(msg: dict) -> None:
    chat = msg.get("chat") or {}
    chat_id = chat.get("id")
    user = msg.get("from") or {}
    uid = user.get("id")
    text = (msg.get("text") or "").strip()
    if not chat_id or not uid:
        return
    if not rate_ok(hits, uid, 20, 60):
        send(chat_id, "Terlalu cepat. Tunggu sebentar.")
        return

    cmd = text.split()[0].split("@")[0].lower() if text.startswith("/") else ""
    args = text.split()[1:]

    if not is_private(chat):
        # personal data, keys and payments never render in a group
        if cmd:
            private_only_notice(chat_id)
        return

    if cmd == "/start" and args and args[0].startswith("link_"):
        confirm_link(args[0][len("link_"):], user)
        return
    if cmd in ("/start", "/menu"):
        install_reply_keyboard(chat_id, uid)
        send(chat_id, *home_screen(uid, user))
        return
    if cmd in COMMANDS:
        send(chat_id, *COMMANDS[cmd](uid, user))
        return
    if cmd == "/pending" and uid in ADMINS:
        send(chat_id, *pending_view())
        return
    if cmd == "/grant" and uid in ADMINS and args:
        _ok, note = do_grant(args[0])
        send(chat_id, note)
        return
    if not cmd and text.lower() in SHORTCUTS:
        send(chat_id, *SHORTCUTS[text.lower()](uid, user))
        return
    # the bot is button-driven: anything else opens the menu
    send(chat_id, *home_screen(uid, user))


def handle_update(update: dict) -> None:
    if "message" in update:
        handle_message(update["message"])
    elif "callback_query" in update:
        handle_callback(update["callback_query"])


def main() -> int:
    global BOT_USERNAME
    refresh_packages()
    me = tg("getMe")
    BOT_USERNAME = str(me.get("username") or "")
    print(f"[bot] online as @{BOT_USERNAME} id={me.get('id')} test_mode={TEST_MODE}", flush=True)
    tg("deleteWebhook", drop_pending_updates=False)
    tg("setMyCommands", commands=[
        {"command": "start", "description": "Menu utama"},
        {"command": "gateway", "description": "AI Gateway: saldo, key, model"},
        {"command": "topup", "description": "Isi kredit API"},
        {"command": "saldo", "description": "Saldo & pemakaian"},
        {"command": "keys", "description": "API key"},
        {"command": "models", "description": "Model & harga"},
        {"command": "store", "description": "Digital Store"},
        {"command": "bantuan", "description": "Bantuan & chat admin"},
    ])
    offset = int(state().get("offset", 0))
    for admin in ADMINS:
        send(admin, "✦ <b>AethinkAI bot online</b>", home_keyboard(admin))
    while True:
        try:
            res = client.get(f"{API}/getUpdates",
                             params={"offset": offset, "timeout": 25,
                                     "allowed_updates": json.dumps(["message", "callback_query"])},
                             timeout=40)
            data = res.json()
            if not data.get("ok"):
                print(f"[poll] {data}", flush=True)
                time.sleep(3)
                continue
            for update in data["result"]:
                offset = update["update_id"] + 1
                save_state({"offset": offset})
                try:
                    handle_update(update)
                except Exception:
                    traceback.print_exc()
        except KeyboardInterrupt:
            return 0
        except Exception as err:
            print(f"[poll] {err}", flush=True)
            time.sleep(2)


if __name__ == "__main__":
    sys.exit(main())
