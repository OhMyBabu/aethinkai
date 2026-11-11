# Payment flow: explicit QRIS creation, one open payment (2026-11-12)

Files: `gateway/app/portal.py`, `gateway/app/payments.py`,
`frontend/src/lib/portal.ts`, `frontend/src/pages/public/Portal.tsx`,
`docs/migrations/014_pending_payment.sql`.

## Before

Clicking a package or Isi Saldo created an order and immediately called the
provider for a QRIS, then navigated to `/pay/<order>` in a new page. Every
click was a provider request, and a reload could not tell the difference
between "waiting" and "start over".

## After

1. Click package or Isi Saldo: confirmation panel with package, price, credits
   and RPM. Nothing is created yet.
2. Lanjutkan: order row only. Provider is not contacted.
3. Panel shows the invoice and the QR slot with Buat QRIS. That click is the
   only place `POST /api/portal/pay/create` is called.
4. Panel stays on `/portal`; Minimalkan leaves a fixed bar with the invoice ID,
   amount and Lihat Invoice.
5. Reload: `GET /api/portal/pending` restores the same order as a minimised bar.
   The order stays pending because no payment arrived and nothing was cancelled.
6. Batalkan pembayaran: local cancellation, no provider call, then a new order
   can be created for the amount the buyer actually wants.

## Rules enforced server-side

- One open order per buyer: `POST /api/portal/order` and `/api/portal/topup`
  answer `409 order_pending` with the existing order in the error body.
- One live QR per buyer: `POST /api/portal/pay/create` refuses with
  `409 payment_pending` and `pending_order_id` when another order still has an
  unexpired pending intent. Re-requesting a QR for the same order reuses the
  existing intent instead of asking the provider again.
- Cancel refuses granted orders (`already_paid`) and orders with a paid intent.

## Endpoints

- `GET /api/portal/pending`: the open order plus its live QR fields, or null.
- `GET /api/portal/orders/{id}/status`: local DB status only, used by the panel
  poll every 8s. It never calls the provider.
- `POST /api/portal/orders/{id}/cancel`: marks order and pending intent
  cancelled, writes an audit entry.

Indexes `orders_buyer_pending_idx` and `payment_intents_live_idx` back the two
lookups.

## UI

- Confirmation, invoice/QR panel, minimised bar: all inside `/portal`, no route
  change.
- QR renders from `qr_image` when the provider supplies one, otherwise the
  `qr_string` payload is encoded locally with `qrcode`, so the panel never
  depends on an external image host.
- Panel shows amount including service fee, countdown to expiry, copy code,
  Buat QRIS, Batalkan pembayaran, Minimalkan. Escape minimises.
- Store panel shows a banner while an order is open; clicking any package opens
  that invoice instead of starting a second checkout.
- Cancelled orders read `Dibatalkan` in the transaction list and receipt.

## Verification

- Backend, QA buyer, no provider call:
  - first order 200, second order 409 `order_pending` with order payload
  - live intent inserted directly: `GET /pending` returns `live: true`, QR and
    total `Rp 5.100`
  - `pay/create` on the same order returns the existing intent (no new request)
  - `pay/create` on a second order returns 409 `payment_pending` with
    `pending_order_id` equal to the first
  - cancel returns `cancelled`, `/pending` becomes null, new order allowed
- UI, QA buyer:
  - confirmation dialog renders package, price, credits, RPM
  - Lanjutkan creates a pending order and opens the panel at `QRIS belum dibuat`
  - minimise leaves the bar; reload restores the bar with the modal closed
  - clicking Pilih Pro while pending opens the same invoice, no second order
  - cancel removes the bar and the transaction list shows `Dibatalkan`
- UI, live QR (fetch stub, no provider): QR renders as a 359px data URL, amount
  `Rp 25.650`, fee `Rp 650`, countdown `sisa 13:54`, copy button present.
- Owner account: existing pending order `AETH-20261111-Q38W` is restored as a
  minimised invoice after reload, panel offers Buat QRIS, nothing was requested
  from the provider.
- `tsc -b` clean, build and deploy OK, no horizontal overflow at 390.
- Suites: access 40/40, payments 9/9, adversarial 20/20, link 33/33 (test now
  clears a stale pending order through the new cancel endpoint first).
- `journalctl -u aethink-gateway --since "1 hour ago" | grep -ci wijayapay` = 0.

## Transaction list stays live

The order list refreshes itself so a status change never waits for a page load:

- The pending poll runs every 5s against the local status endpoint; on granted it
  closes the panel, bumps a refresh key and reloads the dashboard figures.
- The transaction list polls every 12s while the tab is visible, and on window
  focus / visibilitychange, so a grant from the bot or a webhook lands without a
  manual reload.
- Order creation and cancellation still bump the same key immediately.

Verified with a QA buyer, no reload involved: order created from the UI, granted
through the internal bot endpoint, list switched from `Menunggu Pembayaran` to
`Kredit Ditambahkan` on the next beat, the pending bar and panel disappeared, the
"Pembayaran diterima" notice appeared, and the balance KPI showed the new credit.

## Expiry without polling the provider

The reconciler stays off (`PAY_RECONCILE` unset), so nothing calls WijayaPay on a
timer. A local sweeper now runs every 60s (`PAY_EXPIRY_SWEEP_SECONDS`) and only
touches our tables: pending intents whose own `expires_at` passed become
`expired`, and their orders become `expired` with `expired_at` set. That frees
the one-open-order slot and closes the panel on the next 5s status beat.

A late webhook is still safe: `settle_order` re-checks the provider and grants a
paid order whatever its local status was, so money that arrived is never lost to
an expiry race.

Verified with a QA order whose intent expiry was backdated two minutes: within
one sweep the order read `expired` with `expired_at` set and the intent read
`expired`. No provider call was made (`journalctl | grep -ci wijayapay` = 0).

## Not covered

- The provider round trip itself was not exercised: Bang tests real payments.
  The code path is the same `create_for_order` as before, now behind an explicit
  click and the single-live-QR guard.
- Telegram Mini App still creates an order from its package button; if an order
  is already open it now receives `order_pending` from the API. Turning the
  Mini App into the same two-step panel is a separate pass.
