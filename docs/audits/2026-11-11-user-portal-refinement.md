# User portal refinement (2026-11-11)

Scope: `frontend/src/pages/public/Portal.tsx` only. No backend, auth, pricing,
RPM, invoice or payment contract changes. The file already ran against the live
gateway (`/api/portal/me`, `/usage`, `/models`, `/requests`, `/api/packages`,
`/api/portal/orders`) during verification.

## The money bug (P0)

Top-up policy is plain IDR (`min_idr: 2000`, `max_idr: 2000000`), but the page
formatted it with `idr()`, which divides by 1,000,000 because it expects
micro-IDR. Result: `min Rp 0 · maks Rp 2`, and chips rendered `Rp 0,01`,
`Rp 0,03`, `Rp 0,05` for 10.000 / 25.000 / 50.000.

Fix: two formatters with explicit units.

- `rp(value)` for plain IDR (policy, package price, order price, chips).
- `idr(micro)` for balances and ledger, which calls `rp(micro / 1e6)`.

Verified in the DOM: `Min Rp 2.000 · Maks Rp 2.000.000`, chips `Rp 2.000`,
`Rp 5.000`, `Rp 10.000`, `Rp 20.000`, `Rp 25.000`, `Rp 50.000`.

Minimum is enforced in the UI, not only server-side: typing 1.000 disables the
button and shows `Minimal isi saldo Rp 2.000.`; 2.000 enables it; 2.500.000
disables it with `Maksimal isi saldo Rp 2.000.000.` The input accepts digits
only, renders as `2.000`, and sends the same integer it displays.

## Information architecture

New order, top to bottom:

1. Header: wordmark, masked key chip, refresh (`aria-label="Perbarui data"`), Keluar.
2. Page header: `Dashboard`, one-line purpose, `Isi Saldo` CTA anchored to `#isi-saldo`.
3. KPI: Saldo Tersedia, Total Permintaan, Token Digunakan, Batas Permintaan (60 RPM).
4. Aktivitas API (7/30/90 Hari) beside API Key Anda.
5. Penggunaan per Model.
6. Permintaan Terbaru.
7. Isi Saldo: three packages plus Nominal Lainnya.
8. Riwayat Transaksi.

Purchasing no longer owns the first viewport; the balance and key do.

## Component notes

- KPI cards: icon muted, 26px tabular number, label, one-line note
  (`Sejak akun dibuat`, `Input dan output`, `Per API key`). No invented deltas.
- Chart: 240px when data exists, 200px dashed empty state with a centred
  `Belum Ada Aktivitas API` message. Range tabs now read `7 Hari` etc.
- API key card: masked prefix only, Aktif badge, `Batas 60 RPM`,
  `Terakhir digunakan: Belum pernah` when the API reports null, rotate flow kept
  (bot code confirmation), security copy two lines.
- Package cards: Starter/Max neutral buttons, Pro the only accent CTA, badge
  `Pilihan Praktis`. Copy per tier is descriptive, not a throughput claim.
- Invoices: `AETH-...`, date, sku, price, badge `Kredit Ditambahkan` for
  granted. Row opens the existing receipt dialog through the same endpoint;
  Escape and backdrop both close it.
- Empty states replace bare sentences: `Belum Ada Penggunaan Model`,
  `Belum Ada Permintaan Tercatat`, `Belum ada transaksi`, each with the next
  step.
- Styling moved to the shared tokens (`#171717`, white/8 hairlines, flame only
  for primary action and state) so the portal matches the app and landing.

## Verification

- `tsc -b` clean, build + deploy OK.
- No horizontal overflow at 320, 390, 768, 1440.
- Header refresh/Keluar 44px; top-up input, chips and submit 44px on mobile.
- `Isi Saldo` CTA scrolls to the section (`#isi-saldo` top 168 below header).
- Receipt dialog opens with `AETH-20261109-YZR3` and closes on Escape.
- Min/max validation exercised as above; no payment request was sent.
- Numbers on screen come from the live API: balance Rp 55.000, RPM 60,
  0 requests, 0 tokens, 11 orders.
