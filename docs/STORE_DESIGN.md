# AethinkAI Store: bot-only commerce on the existing payment core

Status: design draft, nothing implemented yet.
Scope: a product store that lives only in the Telegram bot. The web portal and
Mini App keep selling gateway credits; they are not part of this store.

## 1. Principles

1. One payment core. QRIS creation, expiry, webhook verification and settlement
   stay in `gateway/app/payments.py`. The store is a new order type, not a second
   payment integration.
2. Store money is separate from gateway credit. A store sale never touches
   `balances`, `ledger_entries`, `holds` or API keys. It produces a delivery.
3. The bot is the only storefront. No public store web page, no store route in
   the Mini App.
4. Prices, stock and delivery content are server-side. The bot only renders.
5. Every buyer action is scoped by the Telegram identity that owns the session.

## 2. Domain model

```
store_products      id, slug, name, description, status(on|off), sort, created_at
store_variants      id, product_id, name, price_idr, status, stock_mode(unique|bulk),
                    delivery_kind(text|file|account|voucher), max_per_buyer, created_at
store_stock         id, variant_id, payload(jsonb), status(available|reserved|sold),
                    reserved_until, sold_at, created_at
store_orders        id(AETH-S-YYYYMMDD-XXXX), buyer_id, variant_id, qty,
                    unit_price_idr, total_idr, status, delivered_at,
                    telegram_msg_id, created_at, expired_at
store_order_stock   order_id, stock_id          -- one row per delivered unit
store_order_events  id, order_id, event, detail(jsonb), created_at
```

Qty is allowed per order, but an order always covers **one product variant only**.
There is no cart and no cross-product basket. Three licences of the same variant
is one order with three stock rows; one licence of two different variants is two
orders.

Delivery payloads are whatever the product sells: email + password, licence key,
API key, voucher code, invite link, or a file link. The payload stays generic
JSON so a new product shape needs no schema change.

`store_stock.payload` holds the delivered secret (license, account, link). It is
encrypted with a key from `/root/.secrets/` and never returned by any list API
unless the caller owns a delivered order.

Gateway tables are untouched except `payment_intents`, which becomes the shared
payment record (section 3).

## 3. Payment reuse

`payment_intents` currently points at `orders` via `order_id`. Add:

```sql
ALTER TABLE payment_intents ADD COLUMN target text NOT NULL DEFAULT 'gateway';
ALTER TABLE payment_intents ADD COLUMN store_order_id text;
ALTER TABLE payment_intents ALTER COLUMN order_id DROP NOT NULL;
-- exactly one target row
CHECK ((target='gateway' AND order_id IS NOT NULL AND store_order_id IS NULL)
    OR (target='store'   AND store_order_id IS NOT NULL AND order_id IS NULL))
```

Webhook resolution stays `provider_ref -> payment_intents row`, then:

- `target='gateway'` → today's `grant_order`
- `target='store'` → `settle_store_order`: mark paid, deliver stock, push the item

Settlement stays idempotent (`status <> 'paid'` guard plus per-order advisory
lock). Provider is re-checked before any grant, so a forged callback cannot
deliver stock.

The single-live-QR rule becomes buyer-wide across both targets: one live intent
per buyer, whatever it is paying for. This needs the store order's buyer resolved
to the same `buyer_id`.

## 4. Order lifecycle

```
created (pending_payment)
   |  QR created -> awaiting_payment
   |  paid (webhook verified) -> paid -> fulfilling -> delivered
   |  expired / cancelled -> closed
   |  paid but stock empty -> paid_no_stock -> refund_pending -> refunded
```

Rules:

- Creating a store order reserves `qty` stock rows atomically in one statement:
  `UPDATE store_stock SET status='reserved', reserved_until=now()+15min
   WHERE id IN (SELECT id FROM store_stock WHERE variant_id=... AND status='available'
                ORDER BY created_at LIMIT $qty FOR UPDATE SKIP LOCKED) RETURNING id`
  and the returned ids are written to `store_order_stock`. If fewer than `qty`
  rows come back the transaction rolls back and the buyer sees the real stock.
- Reserved stock returns to `available` on cancel, expiry, or a sweeper run.
- Payment after expiry: money arrived, so the order moves to `paid_no_stock` if
  the item is gone, and admin gets a queue entry for refund or replacement. Never
  silently drop a paid order.
- One open store order per buyer, same reason as gateway checkout: no double QR,
  no accidental duplicate purchase.
- Unique items are sold once. `bulk` variants keep a counter and deliver the same
  payload per unit.

## 5. Bot UX

Main menu gains `Store`. Callback namespaces: `st:cat`, `st:p:<product>`,
`st:v:<variant>`, `st:buy:<variant>`, `st:ord:<order>`, `st:cancel:<order>`,
`st:resend:<order>`.

Flow:

1. `Store` → product list, one line per product: name, cheapest variant, stock
   badge (`Tersedia` / `Habis`). Rich table, not monospace.
2. Product → variant table: variant, price, stock.
3. Variant → detail card: price, what is delivered, stock, max per buyer, and a
   quantity stepper (`-` / `+` callbacks, 1 to min(stock, max_per_buyer)).
4. `Beli` → confirmation card with qty, unit price, total and delivery type,
   buttons `Buat QRIS` / `Batal`. Same two-step rule as the web portal: nothing is
   charged until the buyer asks for the QR.
5. `Buat QRIS` → QR photo (`qr_image` from the provider, else rendered locally),
   invoice id, amount, expiry countdown, `Cek Status`, `Batalkan`.
6. Webhook settled → bot pushes the delivered item, `Pesanan saya` keeps it,
   `Kirim ulang` re-sends to the same chat.
7. `Pesanan saya` → last 10 orders with status: `Menunggu pembayaran`,
   `Diproses`, `Terkirim`, `Dibatalkan`, `Kedaluwarsa`, `Refund`. A delivered
   order shows its payload again through `Kirim ulang`.
8. Every order screen and the main menu carry `Chat Admin`, opening the admin
   username from config. Refunds, wrong items and delivery problems go there;
   the bot never promises an automatic refund.

Every callback answers its query, edits the same message where possible, and
refuses stale callbacks (`order already delivered`).

## 6. Admin

Admin console gets `/admin/store`:

- products and variants CRUD, on/off per variant
- stock import: paste lines or CSV (`payload` per line), preview, commit
- stock view: available/reserved/sold per variant
- order queue: pending, paid-no-stock, refund pending, with manual deliver,
  replace, refund
- audit trail from `store_order_events`

Bot admin shortcuts stay minimal: `/store_stock <variant> <n>` reports counts,
`/store_order <id>` prints one order. Heavy editing lives on the web.

## 7. API surface (gateway)

Buyer (bot token auth, same session as portal):

```
GET  /api/store/products
GET  /api/store/products/{slug}
POST /api/store/orders            {variant_id}
POST /api/store/orders/{id}/pay      -> QR payload (provider call)
GET  /api/store/orders/{id}          -> buyer-scoped status, delivered payload if delivered
GET  /api/store/orders               -> my orders
POST /api/store/orders/{id}/cancel
POST /api/store/orders/{id}/resend   -> bot pushes again
```

Admin (admin auth): products, variants, stock import, order queue, refund.

Internal (bot, HMAC like `/api/internal/*`): pending store orders, delivery
status, resend.

## 8. Security checklist

- price and stock always read from DB at order creation, never from the callback
- stock reservation inside one transaction with `FOR UPDATE SKIP LOCKED`
- webhook: signature header when the provider supplies one, plus mandatory
  provider re-check before delivery
- settle idempotent per order, advisory lock on order id
- buyer-scoped reads; order ids are random, but authorization never trusts the id
- one live QR per buyer across gateway and store
- delivery only to the Telegram chat linked to the buyer, never to a chat id in
  the request
- payload encryption at rest, no secrets in logs or admin list responses
- rate limit order creation and QR creation per buyer
- audit entries for create, pay, deliver, resend, cancel, refund

## 9. Phases

0. Payment core: add `target`/`store_order_id`, split settlement dispatch,
   buyer-wide live-QR guard, indexes. No behaviour change for gateway.
1. Catalog: tables, admin CRUD, stock import, bot browse (no checkout).
2. Checkout: reserve stock, order + QR two-step, webhook delivery, bot push.
3. Self-service: Pesanan saya, resend, cancel, expiry sweeper, paid-no-stock queue.
4. Admin order queue and refunds, audit view.
5. Hardening: tests for replay, double pay, concurrent stock, expired-then-paid,
   buyer spoofing, rate limits.

## 10. Defaults chosen unless overridden

- Digital goods only: email/password, licence key, API key, voucher, invite
  link, file link. No shipping address.
- IDR only, QRIS only. No card, no e-wallet direct.
- No cart. One order = one variant, quantity 1..min(stock, max_per_buyer).
- Max one open store order per buyer, same as gateway.
- Store stays out of the web portal and Mini App. Mini App keeps gateway only.
- Stock is finite unless the variant is marked `bulk` with unlimited supply.
- No refund automation: refunds are an admin action recorded in the order, and
  the buyer is pointed to the admin chat for any problem.

## 11. Status

Design only. The owner is defining the bot screens for both the store and the
gateway menu before any code is written; nothing in this document is built yet.
