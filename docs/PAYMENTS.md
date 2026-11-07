# PAYMENTS — WijayaPay QRIS

Otomatis: buyer klik beli → gateway bikin transaksi QRIS → status diverifikasi ke provider →
key dikirim ke Telegram. Berlaku di **bot** dan **web**.

## Alur

```
bot /portal  ──► order (pending)  ──► POST /api/internal/pay/create   (bot, HMAC)
                                        POST /api/portal/pay/create  (web, JWT buyer)
                                              │  ref_id = order_id
                                              ▼
                                   WijayaPay POST /transaction/create
                                              │  qr_string, qr_image, total_bayar, expired
                                              ▼
                        payment_intents (pending) ──► QR tampil di bot / halaman /pay/:order
                                              │
        ┌─────────────────────────────────────┼──────────────────────────────────┐
        ▼                                     ▼                                  ▼
  webhook (provider→kita)            "Cek status" di bot                poll halaman checkout
  POST /api/pay/webhook/wijayapay    GET /api/internal/pay/status/{id}   GET /api/pay/status?t=token
        └─────────────────────────────────────┼──────────────────────────────────┘
                                              ▼
                              settle_order(): re-check ke provider (authoritative)
                                              ▼
                        paid  → grant order (1×) → key dikirim via Telegram
                        expired → order ditutup
```

## Endpoint

| Method | Path | Auth | Fungsi |
|---|---|---|---|
| POST | `/api/internal/pay/create` | HMAC bot | buat/reuse QR untuk satu order |
| GET | `/api/internal/pay/status/{order_id}` | HMAC bot | tombol "Cek status" di bot |
| POST | `/api/portal/pay/create` | JWT buyer | checkout dari web (order miliknya sendiri) |
| GET | `/api/pay/status?order_id=&t=` | checkout token | polling halaman `/pay/:orderId` |
| POST | `/api/pay/webhook/wijayapay` | publik, **diverifikasi ulang** | callback provider |

## Aturan yang bikin ini aman

1. **Webhook tidak dipercaya.** Body callback cuma petunjuk `ref_id`; status & nominal
   diambil dari `GET /get-status`. Payload `{"status":"paid"}` palsu → `settled:false`.
2. **Satu QR hidup per order.** `pay/create` kedua mengembalikan QR yang sama (bukan bikin
   transaksi baru). Kalau QR kedaluwarsa, retry pakai `ref_id = <order_id>-2` (WijayaPay
   menolak `ref_id` yang pernah dipakai) dan tetap dipetakan ke order yang sama.
3. **Grant idempoten.** `settle_order` boleh dipanggil berkali-kali: `pg_advisory_xact_lock`
   per order, kredit hanya sekali, `already_granted:true` pada panggilan berikutnya.
4. **Nominal dicatat dua sisi.** `amount_idr` = kredit yang kita kasih, `total_bayar` =
   yang dibayar buyer (termasuk fee QRIS ~0.7–1%). Fee tidak mengurangi kredit.
5. **Reconciler OFF secara default.** `PAY_RECONCILE=1` untuk menyalakan sweep (interval
   `PAY_RECONCILE_SECONDS`, default 300 s). Webhook + tombol cek status sudah cukup.

## Konfigurasi

`/root/.secrets/aethink-pay.env` (chmod 600, dibaca systemd):

```
WIJAYAPAY_BASE_URL=https://gateway.wijayapay.com/api
WIJAYAPAY_MERCHANT=WP6a6856f646766
WIJAYAPAY_API_KEY=...
PAY_CALLBACK_URL=https://router.aethink.ai.id/api/pay/webhook/wijayapay
# PAY_RECONCILE=1
# PAY_RECONCILE_SECONDS=300
```

Di dashboard WijayaPay: aktifkan QRIS, isi URL callback di atas, dan whitelist IP
`129.226.219.219`.

## Tes manual (operator)

```bash
# 1. bikin order (HMAC) — lihat gateway/tests/test_payments.py untuk helper signed()
# 2. minta QR:            POST /api/internal/pay/create {"order_id": "..."}
# 3. buka halaman:        https://router.aethink.ai.id/pay/<order_id>?t=<checkout_token>
# 4. bayar QRIS dari e-wallet, lalu tunggu webhook / tekan "Cek status"
# 5. cek hasil:
psql "$DATABASE_URL" -tAc "select provider_ref,status,trx_reference from payment_intents order by created_at desc limit 3"
psql "$DATABASE_URL" -tAc "select id,status,key_id from orders order by created_at desc limit 3"
```

Test suite **tidak** memanggil provider kecuali `PAY_TEST_LIVE=1` — jangan biarkan tes
membuat transaksi nyata.
