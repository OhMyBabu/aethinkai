# Bot UI: two-service store front (2026-11-12)

File: `bot/bot.py`. Store backend still absent; this pass is presentation only.
Payment, grant, auth and admin flows are unchanged.

## Structure

`/start` is one panel with two doors, then utilities:

```
✦ AethinkAI Store
Digital Products · AI Gateway

Digital Store
AethinkAI Gateway
Aktivitas Saya | Bantuan
Admin Panel (admins only)
```

Everything below is reached by editing that same message. No menu sends a new
message; only invoices are separate, traceable messages.

Screens added:

- Digital Store: home, category list, paginated product list (4/page), product
  detail, empty order history, store help.
- AethinkAI Gateway: home with real balance and RPM, credit packages, model list
  (4/page), model detail with context and cache price, gateway help.
- Aktivitas Saya: gateway transaction list (5/page, real orders) and store order
  list (empty until the store backend lands).
- Pusat Bantuan: store and gateway branches, admin chat kept as `s:ping`.

## Data

Every number comes from an existing source: `PKG` (packages), `catalog_models()`
(model catalogue), `buyer_snapshot(uid)` (balance, RPM, orders). No placeholder
prices or invented stock. `store_catalog()` is the single adapter that returns an
empty list today, so the store screens show honest empty states instead of fake
products; when the store service exists only that function changes.

## Telegram mechanics

- Navigation uses `callback_data` only, namespace `ui:*`; legacy `m:*` callbacks
  from older messages are mapped to the new screens.
- `answerCallbackQuery` fires before every edit, so no spinner hangs.
- `editMessageText` with `parse_mode: HTML`; dynamic text goes through
  `html.escape`.
- Pagination hides the unavailable direction, clamps out-of-range pages, and
  keeps the page when coming back from a detail screen.
- Invoice creation sends a new message and leaves the panel intact, so payment
  proof is never overwritten by navigation.
- `message is not modified` and invalid-query errors are already swallowed by
  `tg()`; they do not surface to the buyer.
- Group chats get a pointer to the private chat instead of account data.

## Copy

Minimal unicode: `✦`, `◦`, `‹`, `›`, `·`, `✓`, `◌`. No emoji rows, no ALL CAPS,
no promotional filler. Money renders as `Rp25.000` in customer panels. Statuses
read `Menunggu pembayaran`, `Kredit Ditambahkan`, `Kedaluwarsa`, `Dibatalkan`.

## Verification

- `py_compile` clean, `aethink-bot` restarted active.
- Live private-chat run as the owner, one message edited through 10 screens
  (`store home → categories → orders → gateway home → credits → models p2 →
  model detail → activity → help → home`), all edits returned success, message
  deleted afterwards so the chat was left clean.
- Router simulation for 16 callbacks including out-of-range model index, real
  activity list and payment panel: no exceptions, correct screens.
- Store screens dry-run with an injected 4-product catalogue: category filter,
  page header `Produk 1–3 dari 3`, page clamp, detail with price and stock, sold
  out hides the buy button.
- Real data seen on screen: `Saldo API: Rp72.000`, `Batas akun: 60 RPM`,
  transactions with `Kredit Ditambahkan` and `Dibatalkan`.

## Home extras

- A live pending order adds one row to the home keyboard:
  `◌ Menunggu pembayaran · Rp5.000`, opening an invoice panel with status,
  nominal and creation date. Granted orders drop the row.
- `reply_kb` installs persistent shortcuts (`Store`, `Gateway`, `Account`,
  `Support`) under the input field once per user per day on `/start`; tapping one
  sends the same panel as the inline route. Inline stays the primary navigation.
- `save_state` now merges keys so the poll offset and the keyboard flag no longer
  overwrite each other.

## Not covered

- Store catalogue and checkout screens render empty states until the store
  backend exists; `Digital Store → Beli` is not wired to a payment flow yet.
- The purchase path was not exercised: it creates a real QRIS and the rule is no
  provider calls during development.
- Telegram screenshots were not captured; evidence is the Bot API edit log and
  rendered text.
- Group `/start` guidance was not exercised against a real group.
