#!/usr/bin/env python3
"""AethinkAI store bot — button-only sales channel in front of the gateway.

Every feature is reachable from an inline keyboard: nothing to memorise. Commands still work as a
fallback (people type /start out of habit), but each one just opens the same menu.

Buyer never creates a password: the bot records an order, an admin (or auto-settle mode) confirms
payment, and the gateway mints the API key. The bot only holds an order id; balances, keys and usage
live in Postgres behind /api/internal/*.

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
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

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

PACKAGES = [
    {"sku": "starter", "name": "Starter", "idr": 5_000, "rpm": 60,
     "blurb": "cocok buat coba-coba & bot pribadi"},
    {"sku": "pro", "name": "Pro", "idr": 25_000, "rpm": 180,
     "blurb": "buat produk kecil & automation harian"},
    {"sku": "max", "name": "Max", "idr": 100_000, "rpm": 600,
     "blurb": "traffic tinggi, parallel request"},
]
PKG = {p["sku"]: p for p in PACKAGES}


def refresh_packages() -> None:
    """Catalogue lives in the gateway (/api/packages) — the bot only caches it."""
    global PACKAGES, PKG
    try:
        res = client.get(f"{GATEWAY}/api/packages", timeout=10)
        if res.status_code == 200:
            items = res.json().get("packages") or []
            if items:
                PACKAGES = items
                PKG = {p["sku"]: p for p in items}
    except Exception as err:
        print(f"[packages] fallback lokal: {err}", flush=True)

client = httpx.Client(timeout=40)
hits: dict[int, deque] = defaultdict(deque)
rotations: dict[int, deque] = defaultdict(deque)


# ---------------------------------------------------------------- helpers
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
    STATE.write_text(json.dumps(data))


def idr(micro: int) -> str:
    v = (micro or 0) / 1_000_000
    return "Rp " + f"{v:,.0f}".replace(",", ".")


def amount(pkg_idr: int) -> str:
    return "Rp" + f"{pkg_idr:,}".replace(",", ".")


def ago(iso: str | None) -> str:
    if not iso:
        return "—"
    try:
        then = datetime.fromisoformat(iso.replace("Z", "+00:00"))
        if then.tzinfo is None:
            then = then.replace(tzinfo=timezone.utc)
        minutes = max(0, int((datetime.now(timezone.utc) - then).total_seconds() // 60))
    except Exception:
        return "—"
    if minutes < 1:
        return "baru saja"
    if minutes < 60:
        return f"{minutes}m lalu"
    hours = minutes // 60
    return f"{hours}j lalu" if hours < 24 else f"{hours // 24}h lalu"


def portal_url() -> str:
    env = os.environ.get("PORTAL_URL", "").strip()
    if env:
        return env
    try:
        log = Path("/root/.pm2/logs/aethink-tunnel-error.log").read_text(errors="ignore")
        found = re.findall(r"https://[a-z0-9-]+\.trycloudflare\.com", log)
        if found:
            return found[-1]
    except Exception:
        pass
    return "http://127.0.0.1:4173"


def post_internal(path: str, payload: dict) -> tuple[int, dict]:
    body = json.dumps(payload, separators=(",", ":")).encode()
    ts = int(time.time())
    sig = hmac.new(secret().encode(), f"{ts}.".encode() + body, hashlib.sha256).hexdigest()
    req = client.build_request("POST", f"{GATEWAY}{path}", content=body,
                               headers={"Content-Type": "application/json",
                                        "X-Timestamp": str(ts), "X-Signature": sig})
    res = client.send(req)
    try:
        return res.status_code, res.json()
    except Exception:
        return res.status_code, {"error": res.text[:200]}


def get_internal(path: str, signed_for: str) -> tuple[int, dict]:
    ts = int(time.time())
    sig = hmac.new(secret().encode(), f"{ts}.{signed_for}".encode(), hashlib.sha256).hexdigest()
    res = client.get(f"{GATEWAY}{path}", headers={"X-Timestamp": str(ts), "X-Signature": sig})
    try:
        return res.status_code, res.json()
    except Exception:
        return res.status_code, {"error": res.text[:200]}


def rate_ok(store: dict[int, deque], uid: int, limit: int, window: float) -> bool:
    now = time.time()
    q = store[uid]
    while q and q[0] < now - window:
        q.popleft()
    if len(q) >= limit:
        return False
    q.append(now)
    return True


# ---------------------------------------------------------------- telegram
def tg(method: str, **params: Any) -> dict:
    for attempt in range(3):
        try:
            res = client.post(f"{API}/{method}", json=params)
            data = res.json()
            if data.get("ok"):
                return data["result"]
            desc = data.get("description", "")
            if "retry after" in desc.lower():
                time.sleep(3)
                continue
            print(f"[tg] {method} failed: {desc}", flush=True)
            return {}
        except Exception as err:
            if attempt == 2:
                print(f"[tg] {method} error: {err}", flush=True)
                return {}
            time.sleep(1.5)
    return {}


def send(chat_id: int, text: str, keyboard: list | None = None) -> dict:
    params: dict[str, Any] = {"chat_id": chat_id, "text": text, "parse_mode": "HTML",
                              "disable_web_page_preview": True}
    if keyboard:
        params["reply_markup"] = {"inline_keyboard": keyboard}
    return tg("sendMessage", **params)


def edit(chat_id: int, message_id: int, text: str, keyboard: list | None = None) -> None:
    params: dict[str, Any] = {"chat_id": chat_id, "message_id": message_id, "text": text,
                              "parse_mode": "HTML", "disable_web_page_preview": True}
    if keyboard:
        params["reply_markup"] = {"inline_keyboard": keyboard}
    tg("editMessageText", **params)


def send_rich(chat_id: int, markdown: str, keyboard: list | None = None) -> dict:
    """Native rich message: Telegram renders headings, tables, quotes client-side."""
    params: dict[str, Any] = {"chat_id": chat_id, "rich_message": {"markdown": markdown}}
    if keyboard:
        params["reply_markup"] = {"inline_keyboard": keyboard}
    return tg("sendRichMessage", **params)


def edit_rich(chat_id: int, message_id: int, markdown: str, keyboard: list | None = None) -> bool:
    params: dict[str, Any] = {"chat_id": chat_id, "message_id": message_id,
                              "rich_message": {"markdown": markdown}}
    if keyboard:
        params["reply_markup"] = {"inline_keyboard": keyboard}
    return bool(tg("editMessageText", **params))


def ack(cb_id: str, text: str = "") -> None:
    tg("answerCallbackQuery", callback_query_id=cb_id, text=text[:190])


def btn(label: str, data: str) -> dict:
    return {"text": label, "callback_data": data}


def url_btn(label: str, url: str) -> dict:
    return {"text": label, "url": url}


def web_app_btn(label: str, url: str) -> dict:
    return {"text": label, "web_app": {"url": url}}


_CACHE: dict[str, tuple[float, object]] = {}


def _cached(key: str, ttl: float, fn):
    now = time.time()
    hit = _CACHE.get(key)
    if hit and now - float(hit[0]) < ttl:
        return hit[1]
    val = fn()
    _CACHE[key] = (now, val)
    return val


def catalog_models() -> list[dict]:
    """Live catalogue from the gateway — never a hardcoded price table."""
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
            res = client.get(f"{GATEWAY}/api/miniapp", timeout=5)
            body = res.json()
            return body.get("url", "") if body.get("available") else ""
        except Exception:
            return ""
    return _cached("miniapp", 60, fetch)


def gateway_status() -> dict:
    def fetch() -> dict:
        try:
            res = client.get(f"{GATEWAY}/api/status", timeout=5)
            return res.json() if res.status_code == 200 else {}
        except Exception:
            return {}
    return _cached("status", 60, fetch)


# ---------------------------------------------------------------- views
def home_keyboard(uid: int) -> list:
    rows = [
        [btn("💳 Top Up", "m:buy"), btn("🔑 API Keys", "m:keys")],
        [btn("◈ Models", "m:models"), btn("📊 Usage", "m:usage")],
        [btn("🎁 Rewards", "m:rewards"), btn("💬 Support", "m:support")],
    ]
    mini = miniapp_link()
    if mini:
        rows.append([web_app_btn("🌐 Buka Dashboard", mini)])
    else:
        rows.append([url_btn("🌐 Buka Dashboard", f"{portal_url()}/portal")])
    if uid in ADMINS:
        rows.append([btn("🛠 Admin Panel", "m:admin")])
    return rows


def home_text(user: dict | None = None, snap: dict | None = None) -> str:
    """One clean panel: balance first, then key/request counters, then honest gateway state."""
    name = html.escape((user or {}).get("first_name") or "")
    hello = f"Halo, <b>{name}</b> 👋" if name else "Halo 👋"

    if snap:
        balance = idr(int(snap.get("balance_micro") or 0))
        keys = len([k for k in (snap.get("keys") or []) if k.get("status") == "active"])
        usage = snap.get("usage") or {}
        req24 = int(usage.get("requests_24h") or 0)
        body = (f"💰 <b>Saldo tersedia</b>\n<code>{balance}</code>\n\n"
                f"🔑 <b>{keys}</b> key aktif · 📊 <b>{req24}</b> request 24 jam\n")
    else:
        body = ("💰 <b>Saldo tersedia</b>\n<code>Rp 0</code>\n\n"
                "Belum ada pembelian — pilih <b>Top Up</b> buat mulai.\n")

    st = gateway_status()
    if st.get("status") == "operational":
        state = f"🟢 Gateway operational · update {time.strftime('%H:%M')}"
    else:
        state = f"🟡 Status gateway: {html.escape(str(st.get('status') or 'tidak diketahui'))}"

    return (
        "◈ <b>AethinkAI Gateway</b> · <i>Control Center</i>\n\n"
        f"{hello}\n\n"
        f"{body}"
        f"{state}\n"
    )


def text_table(headers: list[str], rows: list[list[str]], right: tuple[int, ...] = ()) -> str:
    """Monospace table for Telegram <pre>: pad every cell to the widest value.

    Telegram has no native table, so the alignment has to be computed here; the
    caller wraps the result in <pre> and the client renders it in a fixed font.
    """
    widths = [max(len(str(r[i])) for r in [headers, *rows]) for i in range(len(headers))]

    def line(cells: list[str]) -> str:
        out = []
        for i, cell in enumerate(cells):
            text = str(cell)
            out.append(text.rjust(widths[i]) if i in right else text.ljust(widths[i]))
        return "  ".join(out).rstrip()

    rule = "  ".join("─" * w for w in widths)
    return "\n".join([line(headers), rule, *(line([str(c) for c in row]) for row in rows)])


def short_name(name: str, width: int = 24) -> str:
    return name if len(name) <= width else name[: width - 1].rstrip() + "…"


def price_cell(value) -> str:
    """Plain digits with dot separators — the header already says Rupiah."""
    return f"{int(value or 0):,}".replace(",", ".")


def models_text() -> str:
    models = catalog_models()
    if not models:
        return ("◈ <b>Model &amp; tarif</b>\n\n"
                "Katalog belum tersedia. Coba lagi sebentar.")

    rows = []
    for m in models:
        price = m.get("pricing_idr_per_1m") or {}
        name = short_name(m.get("display_name") or m.get("id", ""))
        rows.append([name, price_cell(price.get("input", 0)), price_cell(price.get("output", 0))])

    table = text_table(["MODEL", "IN /1M", "OUT /1M"], rows, right=(1, 2))
    return (
        "◈ <b>Model &amp; tarif</b>\n"
        "<i>Rupiah per 1 juta token · satu endpoint OpenAI-compatible</i>\n\n"
        f"<pre>{html.escape(table)}</pre>\n"
        "Pakai model ID di body request: <code>\"model\": \"…\"</code>"
    )


def models_markdown() -> str:
    """Same catalogue rendered as a native rich table (Bot API 10.1+)."""
    models = catalog_models()
    if not models:
        return "## Model & tarif\n\nKatalog belum tersedia. Coba lagi sebentar."

    lines = [
        "## Model & tarif",
        "_Rupiah per 1 juta token · satu endpoint OpenAI-compatible_",
        "",
        "| Model | In / 1M | Out / 1M |",
        "|:--|--:|--:|",
    ]
    for m in models:
        price = m.get("pricing_idr_per_1m") or {}
        name = (m.get("display_name") or m.get("id", "")).replace("|", "\\|")
        pin = amount(price.get("input", 0)).replace("Rp", "Rp ", 1)
        pout = amount(price.get("output", 0)).replace("Rp", "Rp ", 1)
        lines.append(f"| {name} | {pin} | {pout} |")
    lines += ["", "Pakai model ID di body request: `\"model\": \"…\"`"]
    return "\n".join(lines)


def models_keyboard() -> list:
    rows = []
    mini = miniapp_link()
    rows.append([web_app_btn("🌐 Katalog Mini App", mini)] if mini else
                [url_btn("🌐 Katalog", f"{portal_url()}/portal")])
    rows.append([btn("⬅️ Menu", "m:home")])
    return rows


def usage_text(uid: int) -> str:
    snap = buyer_snapshot(uid)
    if not snap:
        return ("📊 <b>Usage</b>\n\nBelum ada pemakaian. Saldo dan pemakaian muncul "
                "setelah key dipakai untuk request.")
    u = snap.get("usage") or {}
    return (
        "📊 <b>Usage</b>\n\n"
        f"Request 24 jam: <b>{int(u.get('requests_24h') or 0)}</b>\n"
        f"Request 7 hari: <b>{int(u.get('requests_7d') or 0)}</b>\n"
        f"Request total: <b>{int(u.get('requests') or 0)}</b>\n\n"
        f"Token masuk: <b>{int(u.get('tokens_in') or 0):,}</b>\n"
        f"Token keluar: <b>{int(u.get('tokens_out') or 0):,}</b>\n"
        f"Biaya total: <b>{idr(int(u.get('cost_micro') or 0))}</b>\n\n"
        f"Saldo sekarang: <b>{idr(int(snap.get('balance_micro') or 0))}</b>"
    ).replace(",", ".")


def usage_keyboard() -> list:
    mini = miniapp_link()
    rows = [[web_app_btn("🌐 Detail di Mini App", mini)] if mini else
            [url_btn("🌐 Detail di portal", f"{portal_url()}/portal")]]
    rows.append([btn("⬅️ Menu", "m:home")])
    return rows


def rewards_text() -> str:
    return ("🎁 <b>Rewards</b>\n\n"
            "Belum ada program reward yang aktif untuk akun ini. Kalau ada program bansos atau "
            "bonus kredit, tombolnya muncul di sini — bot tidak menampilkan promo yang tidak aktif.")


def support_text() -> str:
    return ("💬 <b>Support</b>\n\n"
            "Butuh bantuan soal pembayaran, key, atau error request?\n"
            "Tekan tombol di bawah — pesan lu diteruskan ke admin, lengkap dengan ID Telegram lu.\n\n"
            f"Dokumentasi: <code>{portal_url()}/portal</code>")


def packages_text() -> str:
    lines = ["💳 <b>Top Up</b>\n"]
    for p in PACKAGES:
        lines.append(f"<b>{p['name']}</b> — {amount(p['idr'])}\n"
                     f"   {p['rpm']} req/menit · {p['blurb']}")
    lines.append("\nKredit masuk = nilai Rupiah yang dibayar. Pilih paket:")
    return "\n".join(lines)


def packages_keyboard() -> list:
    rows = [[btn(f"{p['name']} · {amount(p['idr'])}", f"buy:{p['sku']}")] for p in PACKAGES]
    rows.append([btn("⬅️ Menu", "m:home")])
    return rows


def create_payment(order_id: str) -> dict | None:
    """Ask the gateway for a QRIS code (WijayaPay). None = provider not configured."""
    status, data = post_internal("/api/internal/pay/create", {"order_id": order_id})
    if status != 200:
        print(f"[pay] create {status} {data}", flush=True)
        return None
    return data


def invoice_text(order_id: str, pkg: dict, pay: dict | None = None) -> str:
    head = (
        f"🧾 <b>Order</b> <code>{order_id}</code>\n"
        f"Paket: <b>{pkg['name']}</b>\n"
        f"Kredit masuk: <b>{idr(pkg['idr'] * 1_000_000)}</b>\n"
        f"Rate limit: <b>{pkg['rpm']} request/menit</b>\n"
    )
    if pay:
        total = int(pay.get("total_bayar") or pkg["idr"])
        fee = int(pay.get("fee_idr") or 0)
        exp = (pay.get("expires_at") or "").replace("T", " ")[:16]
        body = (f"\nBayar: <b>{idr(total * 1_000_000)}</b>"
                + (f" <i>(termasuk biaya QRIS {idr(fee * 1_000_000)})</i>" if fee else "")
                + f"\nBerlaku sampai: <b>{exp} WIB</b>\n\n"
                "Scan QR, bayar sesuai nominal <b>tepat</b>, key dikirim otomatis ke chat ini.")
        if pay.get("trx_reference"):
            body += f"\nRef: <code>{pay['trx_reference']}</code>"
        return head + body
    return head + ("\nStatus: <b>menunggu pembayaran</b>\n\n"
                   "Pembayaran manual: transfer/QRIS ke admin, lalu tekan <b>Saya sudah bayar</b>. "
                   "Admin konfirmasi, bot langsung kirim API key ke chat ini.")


def invoice_keyboard(order_id: str, pay: dict | None) -> list:
    if pay and pay.get("qr_image"):
        return [
            [url_btn("💳 Buka QR", pay["qr_image"]), btn("🔄 Cek status", f"pay:{order_id}")],
            [url_btn("🌐 Bayar di web", f"{portal_url()}/pay/{order_id}?t={pay.get('checkout_token', '')}")],
            [btn("⬅️ Menu", "m:home")],
        ]
    return [[btn("✅ Saya sudah bayar", f"paid:{order_id}")], [btn("⬅️ Menu", "m:home")]]


HELP_HOWTO = (
    "📖 <b>Cara pakai</b>\n\n"
    "1️⃣ Pilih paket → bayar → admin konfirmasi.\n"
    "2️⃣ Bot kirim API key <code>sk-aeth_…</code> (hanya sekali tampil).\n"
    "3️⃣ Menu <b>Key Saya</b> untuk lihat key aktif atau rotasi kalau hilang.\n"
    "4️⃣ Menu <b>Portal</b> untuk saldo, token, model, dan request log.\n\n"
    "<b>Contoh request</b>\n"
    "<pre>curl {base}/v1/chat/completions \\\n"
    "  -H \"Authorization: Bearer $AETHINK_KEY\" \\\n"
    "  -H \"Content-Type: application/json\" \\\n"
    "  -d '{{\"model\":\"deepseek-v4.1-flash-1017\",\n"
    "       \"messages\":[{{\"role\":\"user\",\"content\":\"halo\"}}]}}'</pre>"
)


# ---------------------------------------------------------------- data views
def buyer_snapshot(uid: int) -> dict | None:
    s, data = get_internal(f"/api/internal/buyer/{uid}", f"buyer:{uid}")
    return data if s == 200 else None


def balance_view(uid: int) -> tuple[str, list]:
    snap = buyer_snapshot(uid)
    if not snap:
        return "Belum ada pembelian di akun ini.\n\nPilih paket untuk mulai:", packages_keyboard()
    keys = snap.get("keys") or []
    usage = snap.get("usage") or {}
    lines = [
        "💳 <b>Saldo & Pemakaian</b>\n",
        f"Saldo: <b>{idr(snap.get('balance_micro', 0))}</b>",
        f"Request: <b>{usage.get('requests', 0)}</b> · token "
        f"{usage.get('tokens_in', 0)}/{usage.get('tokens_out', 0)}",
    ]
    if keys:
        k = keys[0]
        lines.append(f"Key aktif: <code>{k['prefix']}…</code> · {k['rpm_limit']} rpm · "
                     f"dipakai {ago(k.get('last_used_at'))}")
    else:
        lines.append("Key aktif: <b>tidak ada</b> — buka Key Saya → Rotasi.")
    orders = snap.get("orders") or []
    if orders:
        lines.append("\n<b>Order terakhir</b>")
        for o in orders[:3]:
            lines.append(f"• <code>{o['id']}</code> · {o['sku']} · "
                         f"{idr(o['price_idr'] * 1_000_000)} · <i>{o['status']}</i>")
    kb = [[btn("🔄 Refresh", "m:bal"), btn("🔑 Key Saya", "m:keys")], [btn("⬅️ Menu", "m:home")]]
    return "\n".join(lines), kb


def keys_view(uid: int) -> tuple[str, list]:
    snap = buyer_snapshot(uid)
    if not snap:
        return "Belum ada key. Beli paket dulu:", packages_keyboard()
    keys = snap.get("keys") or []
    lines = ["🔑 <b>Key Saya</b>\n"]
    if keys:
        for k in keys:
            lines.append(f"• <code>{k['prefix']}…</code> · {k['rpm_limit']} rpm · "
                         f"dipakai {ago(k.get('last_used_at'))}")
        lines.append("\nKey lengkap hanya dikirim sekali saat pembelian/rotasi. Kalau hilang, rotasi.")
    else:
        lines.append("Tidak ada key aktif.")
    kb = [[btn("🔄 Rotasi key", "rot:ask"), btn("🌐 Portal", "m:portal")], [btn("⬅️ Menu", "m:home")]]
    return "\n".join(lines), kb


def portal_view() -> tuple[str, list]:
    link = portal_url()
    return (
        "🌐 <b>Portal pembeli</b>\n\n"
        f"{link}/portal\n\n"
        "Tempel API key dari bot, lalu lihat saldo, token terpakai, model, dan request log. "
        "Tanpa email, tanpa password.",
        [[url_btn("🔗 Buka portal", f"{link}/portal"), btn("⬅️ Menu", "m:home")]],
    )


def admin_view() -> tuple[str, list]:
    s, data = get_internal("/api/internal/pending", "pending")
    pending = len((data or {}).get("orders") or []) if s == 200 else 0
    s2, buyers = get_internal("/api/internal/buyers", "buyers")
    total = len((buyers or {}).get("buyers") or []) if s2 == 200 else 0
    text = ("🛠 <b>Admin panel</b>\n\n"
            f"Order menunggu konfirmasi: <b>{pending}</b>\n"
            f"Pembeli terdaftar: <b>{total}</b>")
    kb = [
        [btn(f"🧾 Order Pending ({pending})", "m:pending")],
        [btn(f"👥 Pembeli ({total})", "m:buyers")],
        [btn("⬅️ Menu", "m:home")],
    ]
    return text, kb


def pending_view() -> tuple[str, list]:
    s, data = get_internal("/api/internal/pending", "pending")
    orders = (data or {}).get("orders") or []
    if s != 200:
        return "Gagal memuat order pending.", [[btn("⬅️ Admin", "m:admin")]]
    if not orders:
        return ("🧾 <b>Order pending</b>\n\nTidak ada order menunggu.",
                [[btn("🔄 Refresh", "m:pending")], [btn("⬅️ Admin", "m:admin")]])
    lines = [f"🧾 <b>Order pending</b> ({len(orders)})\n"]
    rows: list[list] = []
    for o in orders[:8]:
        who = f"@{o['username']}" if o.get("username") else f"tg {o.get('tg_id')}"
        lines.append(f"• <code>{o['id']}</code>\n   {who} · {o['sku']} · "
                     f"{idr(o['price_idr'] * 1_000_000)} · {ago(o.get('created_at'))}")
        rows.append([btn(f"✅ Grant {o['id'][-6:]} · {who}", f"g:{o['id']}")])
    rows.append([btn("🔄 Refresh", "m:pending"), btn("⬅️ Admin", "m:admin")])
    return "\n".join(lines), rows


def buyers_view() -> tuple[str, list]:
    s, data = get_internal("/api/internal/buyers", "buyers")
    rows_data = (data or {}).get("buyers") or []
    if s != 200:
        return "Gagal memuat pembeli.", [[btn("⬅️ Admin", "m:admin")]]
    if not rows_data:
        return ("👥 <b>Pembeli</b>\n\nBelum ada pembeli.",
                [[btn("🔄 Refresh", "m:buyers")], [btn("⬅️ Admin", "m:admin")]])
    lines = [f"👥 <b>Pembeli</b> ({len(rows_data)})\n"]
    for b in rows_data[:12]:
        who = f"@{b['username']}" if b.get("username") else (b.get("name") or f"tg {b.get('tg_id')}")
        lines.append(f"• {html.escape(str(who))} · <code>{b.get('tg_id')}</code>\n"
                     f"   saldo {idr(b.get('balance_micro', 0))} · spend {idr(b.get('spend_micro', 0))} · "
                     f"{b.get('keys_active', 0)} key")
    return "\n".join(lines), [[btn("🔄 Refresh", "m:buyers"), btn("⬅️ Admin", "m:admin")]]


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
        msg = (data.get("error") or {}).get("message") or f"HTTP {status}"
        send(chat_id, f"❌ Tidak bisa menghubungkan: {html.escape(msg)}",
             [[btn("⬅️ Menu", "m:home")]])
        return
    link = portal_url()
    send(chat_id,
         "✅ <b>Telegram terhubung</b>\n\n"
         "Balik ke halaman web — dalam beberapa detik akun ini otomatis masuk.\n"
         "Dari sana lu bisa beli paket, dan key-nya dikirim ke chat ini.",
         [[url_btn("🌐 Balik ke portal", f"{link}/portal"), btn("⬅️ Menu", "m:home")]])


# ---------------------------------------------------------------- order flow
def create_order(user: dict, sku: str, msg_id: int | None = None) -> tuple[str, dict] | None:
    pkg = PKG[sku]
    # invoice ids are issued by the gateway so every order looks the same:
    # AETH-YYYYMMDD-XXXX
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


def deliver_key(chat_id: int, order_id: str, pkg_name: str, key: str, balance: int, rpm: int,
                title: str = "✅ <b>API key aktif</b>", panel: int | None = None) -> None:
    """One panel, edited in place: the same message flows invoice → key → menu."""
    link = portal_url()
    text = (f"{title}\n\n"
            f"Order <code>{order_id}</code> · paket <b>{html.escape(pkg_name)}</b>\n"
            f"Saldo: <b>{idr(balance)}</b> · limit <b>{rpm} req/menit</b>\n\n"
            f"<b>API key</b>\n<code>{html.escape(key)}</code>\n\n"
            "Simpan sekarang — key hanya ditampilkan sekali di chat ini.")
    kb = [[url_btn("🌐 Buka portal", f"{link}/portal"), btn("📖 Cara pakai", "m:help")],
          [btn("⬅️ Menu", "m:home")]]
    if panel:
        edit(chat_id, panel, text, kb)
    else:
        send(chat_id, text, kb)


def do_grant(order_id: str) -> tuple[bool, str]:
    status, data = post_internal(f"/api/internal/order/{order_id}/grant", {})
    if status != 200:
        msg = (data.get("error") or {}).get("message") or f"HTTP {status}"
        return False, msg
    if data.get("already_granted"):
        return True, f"ℹ️ Order <code>{order_id}</code> sudah pernah di-grant (prefix {data.get('key_prefix')}…)."

    s, order = get_internal(f"/api/internal/order/{order_id}", order_id)
    if s != 200:
        return True, "Key dibuat, tapi data order tidak terbaca. Cek Order Pending."
    buyer_tg = data.get("tg_id") or order.get("tg_id")
    panel = data.get("telegram_msg_id") or order.get("telegram_msg_id")
    key = data.get("key") or ""
    pkg_name = PKG.get(order.get("sku", ""), {}).get("name", order.get("sku", "paket"))
    if buyer_tg and data.get("key_reused"):
        # identity = wallet: a top-up must not hand out a second credential
        text = (f"✅ <b>Saldo bertambah</b>\n\n"
                f"Order <code>{order_id}</code> · paket <b>{html.escape(pkg_name)}</b>\n"
                f"Saldo: <b>{idr(int(data.get('balance_micro', 0) or 0))}</b> · "
                f"limit <b>{int(data.get('rpm_limit', 60) or 60)} req/menit</b>\n\n"
                f"Key kamu tetap: <code>{data.get('key_prefix') or ''}…</code>\n"
                "Tidak ada key baru — satu akun Telegram = satu key.")
        kb = [[url_btn("🌐 Buka portal", f"{portal_url()}/portal"), btn("🔑 Key Saya", "m:keys")],
              [btn("⬅️ Menu", "m:home")]]
        if panel:
            edit(chat_id, panel, text, kb)
        else:
            send(chat_id, text, kb)
    elif buyer_tg and key:
        deliver_key(int(buyer_tg), order_id, pkg_name, key,
                    int(data.get("balance_micro", 0) or 0), int(data.get("rpm_limit", 60) or 60),
                    panel=int(panel) if panel else None)
    return True, (f"✅ Order <code>{order_id}</code> granted.\nKey <code>{data.get('key_prefix')}…</code> "
                  f"dikirim ke pembeli.")


def do_rotate(chat_id: int, uid: int, panel: int | None = None) -> None:
    status, data = post_internal("/api/internal/rotate", {"tg_id": uid})
    if status != 200:
        msg = (data.get("error") or {}).get("message") or f"HTTP {status}"
        text = f"Tidak bisa rotasi: {html.escape(msg)}"
        kb = [[btn("⬅️ Menu", "m:home")]]
        edit(chat_id, panel, text, kb) if panel else send(chat_id, text, kb)
        return
    snap = buyer_snapshot(uid) or {}
    deliver_key(chat_id, "rotate", "rotate", data["api_key"],
                int(snap.get("balance_micro", 0) or 0), int(data.get("rpm_limit", 60)),
                title="🔄 <b>Key baru sudah aktif</b>", panel=panel)


# ---------------------------------------------------------------- handlers
def show_home(chat_id: int, uid: int, user: dict | None = None,
              message_id: int | None = None) -> None:
    snap = buyer_snapshot(uid)
    text, kb = home_text(user or {"first_name": ""}, snap), home_keyboard(uid)
    if message_id:
        edit(chat_id, message_id, text, kb)
    else:
        send(chat_id, text, kb)


def handle_message(msg: dict) -> None:
    chat_id = (msg.get("chat") or {}).get("id")
    user = msg.get("from") or {}
    uid = user.get("id")
    text = (msg.get("text") or "").strip()
    if not chat_id or not uid:
        return
    if not rate_ok(hits, uid, 20, 60):
        send(chat_id, "⏳ Terlalu cepat. Tunggu sebentar ya.")
        return

    cmd = text.split()[0].split("@")[0].lower() if text.startswith("/") else ""
    args = text.split()[1:]

    # deep link from the web: t.me/<bot>?start=link_<code>
    if cmd == "/start" and args and args[0].startswith("link_"):
        confirm_link(args[0][len("link_"):], user)
        return

    # commands are only shortcuts into the same menus — nothing requires typing
    if cmd in ("/start", "/menu", "/paket", "/buy"):
        show_home(chat_id, uid, user)
        return
    if cmd == "/saldo":
        body, kb = balance_view(uid)
        send(chat_id, body, kb)
        return
    if cmd == "/portal":
        body, kb = portal_view()
        send(chat_id, body, kb)
        return
    if cmd == "/rotate":
        if not rate_ok(rotations, uid, 3, 3600):
            send(chat_id, "⏳ Rotasi maksimal 3x per jam.")
            return
        do_rotate(chat_id, uid)
        return
    if cmd == "/pending" and uid in ADMINS:
        body, kb = pending_view()
        send(chat_id, body, kb)
        return
    if cmd == "/grant" and uid in ADMINS and args:
        _ok, note = do_grant(args[0])
        send(chat_id, note)
        return

    # any other text opens the menu: the bot is button-driven
    show_home(chat_id, uid, user)


def handle_callback(cb: dict) -> None:
    uid = (cb.get("from") or {}).get("id")
    data = cb.get("data") or ""
    cb_id = cb.get("id")
    msg = cb.get("message") or {}
    chat_id = (msg.get("chat") or {}).get("id")
    mid = msg.get("message_id")
    sender = cb.get("from") or {}
    if not uid or not chat_id:
        return

    if data == "m:home":
        ack(cb_id)
        show_home(chat_id, uid, sender, mid)
        return

    if data == "m:models":
        ack(cb_id)
        if not edit_rich(chat_id, mid, models_markdown(), models_keyboard()):
            # older clients/servers: keep the monospace table rather than nothing
            edit(chat_id, mid, models_text(), models_keyboard())
        return

    if data == "m:usage":
        ack(cb_id)
        edit(chat_id, mid, usage_text(uid), usage_keyboard())
        return

    if data == "m:rewards":
        ack(cb_id)
        edit(chat_id, mid, rewards_text(), [[btn("💬 Support", "m:support")], [btn("⬅️ Menu", "m:home")]])
        return

    if data == "m:support":
        ack(cb_id)
        edit(chat_id, mid, support_text(),
             [[btn("📨 Kirim pesan ke admin", "s:ping")], [btn("⬅️ Menu", "m:home")]])
        return

    if data == "s:ping":
        ack(cb_id, "Diteruskan ke admin")
        uname = f"@{sender['username']}" if sender.get("username") else (sender.get("first_name") or "user")
        note = (f"💬 <b>Permintaan bantuan</b>\n\n"
                f"Dari: <b>{html.escape(str(uname))}</b> · id <code>{uid}</code>\n"
                f"Balas langsung ke chat ini untuk menjawab.")
        for admin in ADMINS:
            if admin != uid:
                send(admin, note, [[url_btn("💬 Buka chat user", f"tg://user?id={uid}")]])
        edit(chat_id, mid, "✅ Pesan lu sudah dikirim ke admin. Ditunggu ya.",
             [[btn("⬅️ Menu", "m:home")]])
        return

    if data == "m:buy":
        ack(cb_id)
        edit(chat_id, mid, packages_text(), packages_keyboard())
        return

    if data == "m:bal":
        ack(cb_id)
        body, kb = balance_view(uid)
        edit(chat_id, mid, body, kb)
        return

    if data == "m:keys":
        ack(cb_id)
        body, kb = keys_view(uid)
        edit(chat_id, mid, body, kb)
        return

    if data == "m:portal":
        ack(cb_id)
        body, kb = portal_view()
        edit(chat_id, mid, body, kb)
        return

    if data == "m:help":
        ack(cb_id)
        edit(chat_id, mid, HELP_HOWTO.format(base=portal_url()), [[btn("⬅️ Menu", "m:home")]])
        return

    if data == "m:admin":
        if uid not in ADMINS:
            ack(cb_id, "Bukan admin")
            return
        ack(cb_id)
        body, kb = admin_view()
        edit(chat_id, mid, body, kb)
        return

    if data == "m:pending":
        if uid not in ADMINS:
            ack(cb_id, "Bukan admin")
            return
        ack(cb_id)
        body, kb = pending_view()
        edit(chat_id, mid, body, kb)
        return

    if data == "m:buyers":
        if uid not in ADMINS:
            ack(cb_id, "Bukan admin")
            return
        ack(cb_id)
        body, kb = buyers_view()
        edit(chat_id, mid, body, kb)
        return

    if data.startswith("buy:"):
        sku = data.split(":", 1)[1]
        pkg = PKG.get(sku)
        if not pkg:
            ack(cb_id, "Paket tidak dikenal")
            return
        ack(cb_id, "Membuat order…")
        created = create_order(cb.get("from") or {}, sku, mid)
        if not created:
            send(chat_id, "Gagal membuat order. Coba lagi sebentar.", [[btn("⬅️ Menu", "m:home")]])
            return
        order_id, _ = created
        if TEST_MODE:
            ok, _note = do_grant(order_id)
            edit(chat_id, mid, f"🧾 <code>{order_id}</code> · {pkg['name']} — "
                              f"<b>{'lunas (test mode)' if ok else 'gagal grant'}</b>",
                 [[btn("⬅️ Menu", "m:home")]])
            return
        pay = create_payment(order_id)
        edit(chat_id, mid, invoice_text(order_id, pkg, pay), invoice_keyboard(order_id, pay))
        if pay:
            return   # automated payment: no admin ping, the gateway grants on settle
        notify = (f"🧾 <b>Order baru</b> <code>{order_id}</code>\n"
                  f"@{cb.get('from', {}).get('username') or uid} · {pkg['name']} · {amount(pkg['idr'])}")
        for admin in ADMINS:
            if admin != uid:  # same-panel rule: never duplicate a message into the buyer's chat
                send(admin, notify, [[btn("✅ Grant sekarang", f"g:{order_id}")]])
        return

    if data.startswith("pay:"):
        order_id = data.split(":", 1)[1]
        status, st = get_internal(f"/api/internal/pay/status/{order_id}", order_id)
        if status != 200:
            ack(cb_id, "Gagal cek status")
            return
        if st.get("status") == "granted":
            ack(cb_id, "Lunas ✅")
            pkg = PKG.get(st.get("sku", ""), {})
            edit(chat_id, mid,
                 f"✅ <b>Pembayaran diterima</b>\n\nOrder <code>{order_id}</code> · "
                 f"{html.escape(pkg.get('name', st.get('sku', 'paket')))}\n\n"
                 "API key sudah dikirim di chat ini (pesan terpisah). Kalau tidak ada, "
                 "buka <b>Key Saya</b> → Rotasi.",
                 [[btn("🔑 Key Saya", "m:keys"), btn("⬅️ Menu", "m:home")]])
            return
        ack(cb_id, "Belum masuk")
        total = st.get("total_bayar")
        edit(chat_id, mid,
             f"⏳ <b>Belum ada pembayaran masuk</b>\n\nOrder <code>{order_id}</code>\n"
             + (f"Nominal: <b>{idr(int(total) * 1_000_000)}</b>\n" if total else "")
             + "Kalau sudah bayar, tunggu 10–30 detik lalu tekan <b>Cek status</b> lagi "
               "(QRIS kadang butuh waktu konfirmasi).",
             [[btn("🔄 Cek status", f"pay:{order_id}"), btn("⬅️ Menu", "m:home")]])
        return

    if data.startswith("paid:"):
        order_id = data.split(":", 1)[1]
        ack(cb_id, "Diteruskan ke admin")
        edit(chat_id, mid,
             f"⏳ <b>Menunggu konfirmasi admin</b>\n\nOrder <code>{order_id}</code>\n"
             "Admin cek pembayaran, lalu key dikirim ke chat ini.",
             [[btn("⬅️ Menu", "m:home")]])
        for admin in ADMINS:
            if admin == uid:
                continue
            send(admin, f"💰 <b>Pembeli klaim sudah bayar</b>\nOrder <code>{order_id}</code>\n"
                        f"@{cb.get('from', {}).get('username') or uid}\n\nCek mutasi lalu grant.",
                 [[btn("✅ Grant sekarang", f"g:{order_id}")]])
        return

    if data.startswith("g:"):
        if uid not in ADMINS:
            ack(cb_id, "Bukan admin")
            return
        order_id = data.split(":", 1)[1]
        ok, note = do_grant(order_id)
        ack(cb_id, "Granted" if ok else "Gagal")
        edit(chat_id, mid, note,
             [[btn("🧾 Order Pending", "m:pending"), btn("⬅️ Admin", "m:admin")]])
        return

    if data == "rot:ask":
        ack(cb_id)
        edit(chat_id, mid,
             "🔄 <b>Rotasi key?</b>\n\nKey sekarang langsung mati, key baru dikirim ke chat ini. "
             "Aplikasi yang masih pakai key lama harus diganti.",
             [[btn("✅ Ya, rotasi", "rot:yes")], [btn("⬅️ Batal", "m:keys")]])
        return

    if data == "rot:yes":
        if not rate_ok(rotations, uid, 3, 3600):
            ack(cb_id, "Maksimal 3x per jam")
            return
        ack(cb_id, "Merotasi…")
        do_rotate(chat_id, uid, panel=mid)
        return

    ack(cb_id)


def handle_update(update: dict) -> None:
    if "message" in update:
        handle_message(update["message"])
    elif "callback_query" in update:
        handle_callback(update["callback_query"])


def main() -> int:
    refresh_packages()
    me = tg("getMe")
    print(f"[bot] online as @{me.get('username')} id={me.get('id')} test_mode={TEST_MODE}", flush=True)
    tg("deleteWebhook", drop_pending_updates=False)
    tg("setMyCommands", commands=[
        {"command": "start", "description": "Menu utama"},
        {"command": "saldo", "description": "Saldo & pemakaian"},
        {"command": "portal", "description": "Portal pembeli"},
        {"command": "rotate", "description": "Ganti API key"},
    ])
    offset = int(state().get("offset", 0))
    for admin in ADMINS:
        send(admin, "🤖 <b>Store bot online</b>\nSemua fitur lewat tombol — tekan Start untuk menu.",
             home_keyboard(admin))
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
