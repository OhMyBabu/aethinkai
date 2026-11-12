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
    """Two doors, then utilities. Nothing else lives on the root panel."""
    rows = [
        [btn("Digital Store", "ui:st:home")],
        [btn("AethinkAI Gateway", "ui:gw:home")],
        [btn("Aktivitas Saya", "ui:activity"), btn("Bantuan", "ui:help")],
    ]
    if uid in ADMINS:
        rows.append([btn("Admin Panel", "m:admin")])
    return rows


def home_text(user: dict | None = None, snap: dict | None = None) -> str:
    """Root: two services, nothing transactional, no balance leak in groups."""
    return (
        "✦ <b>AETHINKAI STORE</b>\n"
        "<i>Digital essentials. Intelligent access.</i>\n\n"
        "Selamat datang di <b>AethinkAI Store.</b>\n\n"
        "Satu tempat untuk kebutuhan digital Anda, mulai dari akun premium hingga "
        "akses berbagai model AI.\n\n"
        "<b>01 / DIGITAL STORE</b>\n"
        "<blockquote>Temukan akun premium, langganan AI, dan produk digital pilihan.\n\n"
        "<i>Pilih produk. Bayar. Terima pesanan.</i></blockquote>\n\n"
        "<b>02 / AETHINKAI GATEWAY</b>\n"
        "<blockquote>Akses Claude, DeepSeek, GLM, Kimi, dan model lainnya melalui satu API key.\n\n"
        "<i>Isi kredit. Integrasikan. Bayar sesuai pemakaian.</i></blockquote>\n\n"
        "<i>Pilih layanan Anda untuk memulai.</i>"
    )


def rupiah(value: int | float) -> str:
    """UI money: Rp25.000, never Rp 25.000 or 25k inside the bot panels."""
    return "Rp" + f"{int(round(float(value or 0))):,}".replace(",", ".")


def page_chunks(items: list, size: int) -> list[list]:
    if not items:
        return [[]]
    return [items[i:i + size] for i in range(0, len(items), size)]


def page_of(items: list, size: int, page: int) -> tuple[list, int, int]:
    pages = page_chunks(items, size)
    page = max(0, min(page, len(pages) - 1))
    return pages[page], page, len(pages)


ORDER_STATUS_ID = {
    "pending": "Menunggu pembayaran",
    "granted": "Kredit Ditambahkan",
    "expired": "Kedaluwarsa",
    "cancelled": "Dibatalkan",
    "failed": "Gagal",
}


def model_status_id(status: str) -> str:
    return {"on": "Tersedia", "maintenance": "Gangguan sementara"}.get((status or "").lower(), "Tidak diketahui")


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
    """Compact Rupiah: 'Rp 96.5K' — currency stays visible, digits stay short."""
    n = float(value or 0)
    if n >= 1000:
        text = f"{n / 1000:.1f}".rstrip("0").rstrip(".")
        return f"Rp {text}K"
    return f"Rp {int(n)}"


def api_base() -> str:
    env = os.environ.get("API_BASE_URL", "").strip()
    return (env or portal_url()).rstrip("/") + "/v1"


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
        f"Base URL · <code>{html.escape(api_base())}</code>"
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
        lines.append(f"| {name} | {price_cell(price.get('input', 0))} | {price_cell(price.get('output', 0))} |")
    lines += ["", f"Base URL · `{api_base()}`"]
    return "\n".join(lines)


def models_keyboard() -> list:
    rows = []
    mini = miniapp_link()
    rows.append([web_app_btn("🌐 Katalog Mini App", mini)] if mini else
                [url_btn("🌐 Katalog", f"{portal_url()}/portal")])
    rows.append([btn("⬅️ Menu", "m:home")])
    return rows


# ---------------------------------------------------------------- store & gateway panels
def store_catalog() -> list[dict]:
    """Store products live behind their own service. Until that service is wired the
    panel shows an honest empty state instead of invented products."""
    return []


def store_home() -> tuple[str, list]:
    text = (
        "✦ <b>Digital Store</b>\n"
        "<code>AethinkAI Store / Digital Products</code>\n\n"
        "Jelajahi produk digital yang tersedia. Pilih kategori untuk melihat produk, "
        "harga, dan informasi pembelian.\n\n"
        "<b>Layanan</b>\n"
        "◦ Katalog produk\n"
        "◦ Riwayat pesanan\n"
        "◦ Bantuan pembelian"
    )
    kb = [
        [btn("Lihat Kategori Produk", "ui:st:cats")],
        [btn("Pesanan Saya", "ui:st:orders:0"), btn("Bantuan", "ui:help:st")],
        [btn("‹ Menu Utama", "ui:home")],
    ]
    return text, kb


def store_category_names() -> list[str]:
    cats: list[str] = []
    for p in store_catalog():
        if p.get("category") and p["category"] not in cats:
            cats.append(p["category"])
    return cats


def store_categories() -> tuple[str, list]:
    products = store_catalog()
    if not products:
        text = (
            "<b>Kategori Produk</b>\n\n"
            "Katalog Digital Store belum tersedia.\n\n"
            "Produk akan muncul di sini setelah katalog diisi."
        )
        return text, [[btn("‹ Digital Store", "ui:st:home")]]
    cats = store_category_names()
    rows = [[btn(str(c), f"ui:st:prods:{i}:0")] for i, c in enumerate(cats[:6])]
    rows.append([btn("‹ Digital Store", "ui:st:home")])
    return "<b>Kategori Produk</b>\nPilih kategori yang ingin Anda jelajahi.", rows


def store_products(cat: int, page: int) -> tuple[str, list]:
    products = store_catalog()
    cats = store_category_names()
    if products and cats and 0 <= cat < len(cats):
        products = [p for p in products if p.get("category") == cats[cat]]
    if not products:
        return (
            "<b>Belum ada produk</b>\n\n"
            "Produk untuk kategori ini belum tersedia saat ini.",
            [[btn("‹ Digital Store", "ui:st:home")]],
        )
    chunk, page, pages = page_of(products, 4, page)
    lines = ["<b>Katalog Produk</b>", f"<code>Produk {page * 4 + 1}–{page * 4 + len(chunk)} dari {len(products)} · Halaman {page + 1}/{pages}</code>", ""]
    rows = []
    for i, p in enumerate(chunk):
        price = p.get("price_from") or 0
        lines.append(f"<b>{page * 4 + i + 1:02d} · {html.escape(str(p.get('name', '')))}</b>")
        lines.append(f"Harga mulai <b>{rupiah(price)}</b>\n")
        rows.append([btn(f"{page * 4 + i + 1:02d} · {short_name(str(p.get('name', '')), 22)}",
                         f"ui:st:product:{p.get('id')}:{cat}:{page}")])
    nav = []
    if page > 0:
        nav.append(btn("‹ Sebelumnya", f"ui:st:prods:{cat}:{page - 1}"))
    if page < pages - 1:
        nav.append(btn("Berikutnya ›", f"ui:st:prods:{cat}:{page + 1}"))
    if nav:
        rows.append(nav)
    rows.append([btn("‹ Kategori", "ui:st:cats"), btn("Menu Utama", "ui:home")])
    return "\n".join(lines), rows


def store_product(pid: str, cat: int, page: int) -> tuple[str, list]:
    product = next((p for p in store_catalog() if str(p.get("id")) == str(pid)), None)
    if not product:
        return store_products(cat, page)
    variants = product.get("variants") or []
    cheapest = min((v.get("price_idr", 0) for v in variants), default=product.get("price_from") or 0)
    in_stock = bool(product.get("in_stock", bool(variants)))
    lines = [
        f"<b>{html.escape(str(product.get('name', '')))}</b>",
        f"<code>{html.escape(str(product.get('id', '')))}</code>",
        "",
        html.escape(str(product.get("description") or "Deskripsi produk belum tersedia.")),
        "",
        "<b>Informasi</b>",
        f"Durasi       : {html.escape(str(product.get('duration') or 'sesuai varian'))}",
        f"Harga        : {rupiah(cheapest)}",
        f"Ketersediaan : {'Tersedia' if in_stock else 'Stok habis'}",
        "",
        "Periksa pilihan produk sebelum melanjutkan pembelian." if in_stock else
        "Produk ini sedang tidak tersedia.",
    ]
    kb = []
    if in_stock and variants:
        kb.append([btn("Pilih Varian / Beli", f"ui:st:buy:{pid}")])
    kb.append([btn("‹ Daftar Produk", f"ui:st:prods:{cat}:{page}"), btn("Menu Utama", "ui:home")])
    return "\n".join(lines), kb


def store_orders(page: int) -> tuple[str, list]:
    text = (
        "<b>Pesanan Saya</b>\n\n"
        "<b>Belum ada pesanan</b>\n\n"
        "Pesanan Digital Store yang Anda buat akan muncul di sini."
    )
    kb = [[btn("Jelajahi Produk", "ui:st:cats")], [btn("‹ Digital Store", "ui:st:home")]]
    return text, kb


def gateway_home(uid: int) -> tuple[str, list]:
    snap = buyer_snapshot(uid)
    if snap:
        account = (f"Saldo API: <b>{rupiah((snap.get('balance_micro') or 0) / 1_000_000)}</b>\n"
                   f"Batas akun: {snap.get('rpm_limit') or 60} RPM")
    else:
        account = "Belum terhubung."
    text = (
        "✦ <b>AethinkAI Gateway</b>\n"
        "<code>One API · Multiple Models</code>\n\n"
        "Gunakan satu endpoint untuk mengakses model AI yang tersedia. Kelola kredit, "
        "cek harga model, dan lihat panduan integrasi.\n\n"
        f"<b>Akun</b>\n{account}"
    )
    kb = [
        [btn("Beli Kredit API", "ui:gw:credits")],
        [url_btn("Dashboard AethinkAI", f"{portal_url()}/portal")],
        [btn("Model & Harga", "ui:gw:models:0"), url_btn("Panduan API", f"{portal_url()}/panduan")],
        [btn("‹ Menu Utama", "ui:home")],
    ]
    return text, kb


def gateway_credits() -> tuple[str, list]:
    pkgs = sorted(PKG.values(), key=lambda p: p.get("sort", 0) or p.get("idr", 0))
    lines = [
        "<b>Isi Kredit API</b>",
        "",
        "Pilih nominal kredit untuk menambah saldo AethinkAI Gateway. Kredit digunakan "
        "sesuai pemakaian model, tanpa langganan bulanan.",
        "",
        "<b>Paket Kredit</b>",
    ]
    rows = []
    row = []
    for p in pkgs[:3]:
        lines.append(f"{html.escape(str(p.get('name', p.get('sku'))))} · <b>{rupiah(p.get('idr', 0))}</b>")
        row.append(btn(str(p.get("name", p.get("sku", ""))), f"buy:{p.get('sku')}"))
    if row:
        rows.append(row)
    lines += ["", "<b>Catatan</b>", "Seluruh paket mengikuti batas penggunaan akun yang berlaku."]
    rows.append([url_btn("Nominal Lainnya", f"{portal_url()}/portal#isi-saldo")])
    rows.append([btn("‹ AethinkAI Gateway", "ui:gw:home")])
    return "\n".join(lines), rows


def gateway_models(page: int) -> tuple[str, list]:
    models = catalog_models()
    if not models:
        return ("<b>Model & Harga</b>\n\nData belum dapat dimuat. Coba beberapa saat lagi.",
                [[btn("‹ AethinkAI Gateway", "ui:gw:home")]])
    chunk, page, pages = page_of(models, 4, page)
    lines = ["<b>Model & Harga</b>", f"<code>Halaman {page + 1}/{pages}</code>", ""]
    rows = []
    for offset, m in enumerate(chunk):
        idx = page * 4 + offset
        price = m.get("pricing_idr_per_1m") or {}
        name = html.escape(str(m.get("display_name") or m.get("id")))
        lines.append(f"<b>{name}</b>")
        lines.append(f"Input: {rupiah(price.get('input', 0))} / 1M token")
        lines.append(f"Output: {rupiah(price.get('output', 0))} / 1M token\n")
        rows.append([btn(f"Detail · {short_name(str(m.get('display_name') or m.get('id')), 20)}",
                         f"ui:gw:model:{idx}:{page}")])
    nav = []
    if page > 0:
        nav.append(btn("‹ Sebelumnya", f"ui:gw:models:{page - 1}"))
    if page < pages - 1:
        nav.append(btn("Berikutnya ›", f"ui:gw:models:{page + 1}"))
    if nav:
        rows.append(nav)
    lines.append("Harga mengikuti katalog aktif AethinkAI Gateway.")
    rows.append([btn("‹ AethinkAI Gateway", "ui:gw:home")])
    return "\n".join(lines), rows


def gateway_model(idx: int, page: int) -> tuple[str, list]:
    models = catalog_models()
    if not models or idx < 0 or idx >= len(models):
        return ("<b>Model tidak ditemukan</b>\n\nDaftar model sudah berubah. Buka ulang daftar.",
                [[btn("‹ Model & Harga", "ui:gw:models:0")]])
    m = models[idx]
    price = m.get("pricing_idr_per_1m") or {}
    ctx = m.get("context_length") or 0
    ctx_text = f"{ctx // 1_000_000}M" if ctx and ctx % 1_000_000 == 0 else (f"{ctx // 1000}K" if ctx else "belum tersedia")
    lines = [
        f"<b>{html.escape(str(m.get('display_name') or m.get('id')))}</b>",
        f"<code>{html.escape(str(m.get('id')))}</code>",
        "",
        f"Status        : {model_status_id(str(m.get('status') or ''))}",
        f"Context       : {ctx_text}",
        f"Input / 1M    : {rupiah(price.get('input', 0))}",
        f"Output / 1M   : {rupiah(price.get('output', 0))}",
    ]
    if price.get("cached_input"):
        lines.append(f"Cache / 1M    : {rupiah(price['cached_input'])}")
    lines += ["", "Gunakan ID model di atas saat mengirim permintaan API."]
    kb = [
        [url_btn("Buka Panduan API", f"{portal_url()}/panduan")],
        [btn("‹ Model & Harga", f"ui:gw:models:{page}")],
    ]
    return "\n".join(lines), kb


def activity_home() -> tuple[str, list]:
    text = ("<b>Aktivitas Saya</b>\n\n"
            "Pilih layanan untuk melihat aktivitas terkait akun Anda.")
    kb = [
        [btn("Pesanan Digital Store", "ui:activity:st:0")],
        [btn("Transaksi Kredit Gateway", "ui:activity:gw:0")],
        [btn("‹ Menu Utama", "ui:home")],
    ]
    return text, kb


def activity_gateway(uid: int, page: int) -> tuple[str, list]:
    snap = buyer_snapshot(uid)
    orders = (snap or {}).get("orders") or []
    if not orders:
        return ("<b>Transaksi Kredit Gateway</b>\n\nBelum ada transaksi yang tercatat.",
                [[btn("‹ Aktivitas Saya", "ui:activity")], [btn("Menu Utama", "ui:home")]])
    chunk, page, pages = page_of(orders, 5, page)
    lines = ["<b>Transaksi Kredit Gateway</b>", f"<code>Halaman {page + 1}/{pages}</code>", ""]
    for o in chunk:
        lines.append(f"<b>#{html.escape(str(o.get('id', '')).split('-')[-1])}</b> · {html.escape(str(o.get('sku', '')))}")
        when = str(o.get("created_at") or "")[:10]
        lines.append(f"{when} · {ORDER_STATUS_ID.get(str(o.get('status')), str(o.get('status')))} · {rupiah(o.get('price_idr', 0))}\n")
    nav = []
    if page > 0:
        nav.append(btn("‹ Sebelumnya", f"ui:activity:gw:{page - 1}"))
    if page < pages - 1:
        nav.append(btn("Berikutnya ›", f"ui:activity:gw:{page + 1}"))
    kb = ([nav] if nav else []) + [[btn("‹ Aktivitas Saya", "ui:activity")], [btn("Menu Utama", "ui:home")]]
    return "\n".join(lines), kb


def activity_store(page: int) -> tuple[str, list]:
    return ("<b>Pesanan Digital Store</b>\n\nBelum ada pesanan yang tercatat.",
            [[btn("Jelajahi Produk", "ui:st:home")], [btn("‹ Aktivitas Saya", "ui:activity")]])


def help_home() -> tuple[str, list]:
    text = ("<b>Pusat Bantuan</b>\n\n"
            "Pilih topik bantuan sesuai layanan yang Anda gunakan.")
    kb = [
        [btn("Bantuan Digital Store", "ui:help:st")],
        [btn("Bantuan AethinkAI Gateway", "ui:help:gw")],
        [btn("‹ Menu Utama", "ui:home")],
    ]
    return text, kb


def help_store() -> tuple[str, list]:
    text = ("<b>Bantuan Digital Store</b>\n\n"
            "Pesanan digital dikirim langsung ke chat ini setelah pembayaran terkonfirmasi. "
            "Kalau ada kendala, hubungi admin.")
    kb = [[btn("Chat Admin", "s:ping")], [btn("‹ Bantuan", "ui:help")], [btn("Menu Utama", "ui:home")]]
    return text, kb


def help_gateway() -> tuple[str, list]:
    text = ("<b>Bantuan AethinkAI Gateway</b>\n\n"
            "Satu API key untuk seluruh model. Kelola kredit lewat bot, pantau pemakaian "
            "dan transaksi di dashboard.")
    kb = [
        [url_btn("Panduan API", f"{portal_url()}/panduan"), url_btn("Dashboard", f"{portal_url()}/portal")],
        [btn("Kelola API Key", "m:keys"), btn("Chat Admin", "s:ping")],
        [btn("‹ Bantuan", "ui:help")],
    ]
    return text, kb


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
        f"<b>Invoice</b> <code>{order_id}</code>\n"
        f"Paket: <b>{pkg['name']}</b>\n"
        f"Kredit masuk: <b>{rupiah(pkg['idr'])}</b>\n"
        f"Batas akun: <b>{pkg['rpm']} RPM</b>\n"
    )
    if pay:
        total = int(pay.get("total_bayar") or pkg["idr"])
        fee = int(pay.get("fee_idr") or 0)
        exp = (pay.get("expires_at") or "").replace("T", " ")[:16]
        body = (f"\nBayar: <b>{rupiah(total)}</b>"
                + (f" <i>(termasuk biaya QRIS {rupiah(fee)})</i>" if fee else "")
                + f"\nBerlaku sampai: <b>{exp} WIB</b>\n\n"
                "Scan QR dan bayar sesuai nominal tepat. Kredit masuk otomatis setelah "
                "pembayaran terkonfirmasi.")
        if pay.get("trx_reference"):
            body += f"\nRef: <code>{pay['trx_reference']}</code>"
        return head + body
    return head + ("\nStatus: <b>menunggu pembayaran</b>\n\n"
                   "Pembayaran manual: transfer atau QRIS ke admin, lalu tekan Saya sudah bayar. "
                   "Admin mengonfirmasi, lalu kredit masuk ke akun ini.")


def invoice_keyboard(order_id: str, pay: dict | None) -> list:
    if pay and pay.get("qr_image"):
        return [
            [url_btn("Buka QR", pay["qr_image"]), btn("Cek Status", f"pay:{order_id}")],
            [url_btn("Bayar di web", f"{portal_url()}/pay/{order_id}?t={pay.get('checkout_token', '')}")],
            [btn("‹ Menu Utama", "ui:home")],
        ]
    return [[btn("Saya sudah bayar", f"paid:{order_id}")], [btn("‹ Menu Utama", "ui:home")]]


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
        "<b>Saldo &amp; Penggunaan API</b>\n",
        f"Saldo tersedia : <b>{rupiah((snap.get('balance_micro') or 0) / 1_000_000)}</b>",
        f"Batas akun     : {snap.get('rpm_limit') or 60} RPM",
        f"Penggunaan     : {usage.get('requests', 0)} request · "
        f"{usage.get('tokens_in', 0)} token masuk / {usage.get('tokens_out', 0)} token keluar",
    ]
    if keys:
        k = keys[0]
        lines.append(f"Key aktif      : <code>{k['prefix']}…</code> · {k['rpm_limit']} RPM · "
                     f"dipakai {ago(k.get('last_used_at'))}")
    else:
        lines.append("Key aktif      : belum ada · buat lewat Rotasi di Kelola API Key.")
    lines.append("\nKelola transaksi dan riwayat penggunaan melalui dashboard AethinkAI.")
    kb = [
        [url_btn("Buka Dashboard", f"{portal_url()}/portal")],
        [btn("Isi Kredit API", "ui:gw:credits"), btn("‹ AethinkAI Gateway", "ui:gw:home")],
    ]
    return "\n".join(lines), kb


def keys_view(uid: int) -> tuple[str, list]:
    snap = buyer_snapshot(uid)
    if not snap:
        return "Belum ada key. Beli paket dulu:", packages_keyboard()
    keys = snap.get("keys") or []
    lines = ["<b>Kelola API Key</b>\n"]
    if keys:
        for k in keys:
            lines.append(f"<code>{k['prefix']}…</code> · {k['rpm_limit']} RPM · "
                         f"dipakai {ago(k.get('last_used_at'))}")
        lines.append("\nKey lengkap hanya dikirim sekali saat pembelian atau rotasi. Kalau hilang, rotasi.")
    else:
        lines.append("Belum ada key aktif.")
    kb = [
        [btn("Rotasi Key", "rot:ask"), url_btn("Dashboard", f"{portal_url()}/portal")],
        [btn("‹ Bantuan Gateway", "ui:help:gw")],
    ]
    return "\n".join(lines), kb


def portal_view() -> tuple[str, list]:
    link = portal_url()
    return (
        "<b>Dashboard AethinkAI</b>\n\n"
        f"{link}/portal\n\n"
        "Masuk dengan API key dari bot untuk melihat saldo, pemakaian, model, dan riwayat request.",
        [[url_btn("Buka Dashboard", f"{link}/portal"), btn("‹ Menu Utama", "ui:home")]],
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

    # Commands are shortcuts into the same panels. Personal data never renders in
    # a group: the root menu there only points to the private chat.
    if cmd == "/start" and (msg.get("chat") or {}).get("type") in {"group", "supergroup", "channel"}:
        send(chat_id, "Menu dan data akun hanya tersedia di chat pribadi bot.\n\n"
                      "Buka chat privat dengan bot ini, lalu kirim /start.")
        return
    if cmd in ("/start", "/menu"):
        show_home(chat_id, uid, user)
        return
    if cmd == "/store":
        text, kb = store_home()
        send(chat_id, text, kb)
        return
    if cmd == "/gateway":
        text, kb = gateway_home(uid)
        send(chat_id, text, kb)
        return
    if cmd in ("/paket", "/buy"):
        text, kb = gateway_credits()
        send(chat_id, text, kb)
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

    if data == "ui:home":
        ack(cb_id)
        show_home(chat_id, uid, sender, mid)
        return

    if data.startswith("ui:st:"):
        parts = data.split(":")
        ack(cb_id)
        if data == "ui:st:home":
            text, kb = store_home()
        elif data == "ui:st:cats":
            text, kb = store_categories()
        elif len(parts) >= 5 and parts[2] == "prods":
            text, kb = store_products(int(parts[3]), int(parts[4]))
        elif parts[2] == "orders" and len(parts) >= 4:
            text, kb = store_orders(int(parts[3]))
        elif parts[2] == "product" and len(parts) >= 6:
            text, kb = store_product(parts[3], int(parts[4]), int(parts[5]))
        else:
            text, kb = store_home()
        edit(chat_id, mid, text, kb)
        return

    if data.startswith("ui:gw:"):
        parts = data.split(":")
        ack(cb_id)
        if data == "ui:gw:home":
            text, kb = gateway_home(uid)
        elif data == "ui:gw:credits":
            text, kb = gateway_credits()
        elif parts[2] == "models":
            text, kb = gateway_models(int(parts[3]) if len(parts) > 3 else 0)
        elif parts[2] == "model" and len(parts) >= 5:
            text, kb = gateway_model(int(parts[3]), int(parts[4]))
        else:
            text, kb = gateway_home(uid)
        edit(chat_id, mid, text, kb)
        return

    if data == "ui:activity":
        ack(cb_id)
        text, kb = activity_home()
        edit(chat_id, mid, text, kb)
        return

    if data.startswith("ui:activity:"):
        parts = data.split(":")
        ack(cb_id)
        kind = parts[2] if len(parts) > 2 else "st"
        page = int(parts[3]) if len(parts) > 3 else 0
        text, kb = activity_gateway(uid, page) if kind == "gw" else activity_store(page)
        edit(chat_id, mid, text, kb)
        return

    if data == "ui:help":
        ack(cb_id)
        text, kb = help_home()
        edit(chat_id, mid, text, kb)
        return

    if data == "ui:help:st":
        ack(cb_id)
        text, kb = help_store()
        edit(chat_id, mid, text, kb)
        return

    if data == "ui:help:gw":
        ack(cb_id)
        text, kb = help_gateway()
        edit(chat_id, mid, text, kb)
        return

    if data == "m:home":
        ack(cb_id)
        show_home(chat_id, uid, sender, mid)
        return

    if data == "m:models":
        ack(cb_id)
        text, kb = gateway_models(0)
        edit(chat_id, mid, text, kb)
        return

    if data == "m:buy":
        ack(cb_id)
        text, kb = gateway_credits()
        edit(chat_id, mid, text, kb)
        return

    if data == "m:usage":
        ack(cb_id)
        body, kb = balance_view(uid)
        edit(chat_id, mid, body, kb)
        return

    if data == "m:rewards":
        ack(cb_id)
        edit(chat_id, mid, rewards_text(), [[btn("💬 Support", "m:support")], [btn("⬅️ Menu", "m:home")]])
        return

    if data == "m:support":
        ack(cb_id)
        text, kb = help_home()
        edit(chat_id, mid, text, kb)
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
        ack(cb_id, "Membuat invoice…")
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
        # The invoice is its own traceable message: navigating the panels later must
        # never overwrite the only payment proof.
        send(chat_id, invoice_text(order_id, pkg, pay), invoice_keyboard(order_id, pay))
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
                 f"✓ <b>Pembayaran diterima</b>\n\nOrder <code>{order_id}</code> · "
                 f"{html.escape(pkg.get('name', st.get('sku', 'paket')))}\n\n"
                 "Kredit sudah masuk. API key ada di menu Kelola API Key.",
                 [[btn("Kelola API Key", "m:keys"), btn("‹ Menu Utama", "ui:home")]])
            return
        ack(cb_id, "Belum masuk")
        total = st.get("total_bayar")
        edit(chat_id, mid,
             f"◌ <b>Menunggu konfirmasi pembayaran</b>\n\nOrder <code>{order_id}</code>\n"
             + (f"Nominal: <b>{rupiah(total)}</b>\n" if total else "")
             + "Kalau sudah membayar, tunggu 10–30 detik lalu tekan Cek Status lagi.",
             [[btn("Cek Status", f"pay:{order_id}"), btn("‹ Menu Utama", "ui:home")]])
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
        {"command": "store", "description": "Digital Store"},
        {"command": "gateway", "description": "AethinkAI Gateway"},
        {"command": "saldo", "description": "Saldo & pemakaian"},
        {"command": "portal", "description": "Portal pembeli"},
        {"command": "rotate", "description": "Ganti API key"},
    ])
    offset = int(state().get("offset", 0))
    for admin in ADMINS:
        send(admin, "✦ <b>AethinkAI Store online</b>\nSemua fitur lewat tombol. Tekan Start untuk menu.",
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
