# ACCESS — siapa masuk lewat mana

Tiga pintu, tiga kredensial berbeda. Jangan campur.

## 1. Server (SSH)

| | |
|---|---|
| Host | `129.226.219.219` |
| User | `ubuntu` (punya `sudo NOPASSWD: ALL`) → `sudo -i` untuk jadi root |
| Auth | password (key boleh ditambah; `authorized_keys` masih kosong) |
| Root SSH | `PermitRootLogin yes` — **tidak dipakai**, matikan kalau key admin sudah ada |

Ambil kredensial apa pun di bawah ini dari box (jangan dari chat):

```bash
sudo -i
cat /root/ops/aethinkai/gateway/.admin     # admin@aethink.ai + password panel
cat /root/ops/aethinkai/gateway/.devkey    # API key dev (sk-aet_...)
ls  /root/.secrets/                        # DB, JWT, internal HMAC, upstream key
```

## 2. Gateway — admin panel (web)

```
https://router.aethink.ai.id/admin/login
```

Kredensial: baris `admin` di `gateway/.admin` (email + password acak hasil seed).
Yang bisa dikerjakan di sana:

- **Models & harga** — `/admin/models`: aktif/nonaktifkan model, `public_id` (nama yang
  dilihat pembeli), harga in/out/cached per 1M IDR, label provider.
- **Users / buyers** — `/admin/buyers`: daftar pembeli Telegram, saldo, key, status.
- **Keys** — suspend / aktifkan, lihat RPM, rotate lewat bot (`/rotate`).
- **Orders** — status order, grant manual, riwayat pembayaran.
- **Usage & live feed** — request terakhir, token, biaya, latency, IP/UA.
- **Settings** — FX USD→IDR, nama brand, dll.

Ganti password admin (kapan pun, tanpa restart):

```bash
cd /root/ops/aethinkai
NEW='PasswordBaruYangKuat'
/root/ops/aethinkai/gateway/.venv/bin/python - <<PY
import asyncio, os, sys
sys.path.insert(0, "gateway")
from app import auth, db
async def main():
    pw = os.environ["NEW"]
    async with db.pool().acquire() as con:
        await con.execute("UPDATE users SET password_hash=$1 WHERE role='admin'", auth.hash_password(pw))
    print("admin password updated")
asyncio.run(main())
PY
```

## 3. 9Router — dashboard upstream

```
http://43.173.36.225:20128/login      (Next.js, publik saat ini)
```

Login memakai password yang diset di box relay (`INITIAL_PASSWORD`), **bukan** kredensial
gateway. Kalau lupa:

```bash
# di box relay 43.173.36.225
grep -iE 'INITIAL_PASSWORD|PASSWORD' /root/.9router/.env /root/.9router/*.env 2>/dev/null
pm2 env $(pm2 id 9router | tr -dc '0-9') | grep -i password
# reset: ubah env lalu restart
pm2 restart 9router --update-env
```

Di dashboard 9Router kamu mengelola: **provider/akun upstream** (API key OpenAI/Anthropic/
OpenRouter/Groq dll), route model (`mr/...`, `ky/...`), kuota, dan biaya per model.

> Dashboard ini **tidak boleh tetap publik**. Setelah kamu selesai menambah provider,
> ikuti `deploy/SECURITY.md` §5: bind ke loopback/WireGuard, jangan biarkan `:20128`
> terbuka dari internet. Sampai itu dikerjakan, minimal ganti password default dan
> jangan simpan API key provider bernilai besar di sana.

## 4. Bot Telegram

- Bot: `@AethinkBot` (id `8747681973`), token di `/root/.secrets/aethink-bot.env`.
- Admin bot: Telegram user id `541900896` (Bang). Perintah admin: `/admin`, `/pending`,
  `/buyers`, `/grant`, `/addsaldo`.
- Rotasi token: BotFather → `/revoke` → tulis token baru ke `aethink-bot.env` +
  `AETHINK_BOT_TOKEN` di `aethink-db.env` → `systemctl restart aethink-bot`.

## 5. Satu key per akun, rotasi dengan bukti Telegram

Model bisnisnya prepaid pay-as-you-go, jadi **kredensial = akun**, bukan = pembelian:

- Pembelian pertama mencetak satu key. Pembelian berikutnya hanya menambah saldo —
  `_key_for_grant()` memakai key hidup yang sama (`key_reused: true`, `key: null`).
- Saldo menempel di wallet (`users`/`balances`), bukan di key. Key habis kuota/rotasi →
  saldo utuh, riwayat `usage_events` utuh.
- Satu key aktif per akun dipaksa di DB: partial unique index
  `api_keys_one_active_per_user`.

Rotasi key (`POST /api/portal/keys/rotate`) punya dua pintu:

| Pintu | Bukti identitas | Alur |
|---|---|---|
| Bot | chat itu sendiri | ketik `/rotate` → key baru dikirim sekali di chat |
| Web (sesi key) | kode dari bot | `POST /keys/rotate/request` → kode 6 digit ke chat bot (5 menit, 5 percobaan) → `POST /keys/rotate/confirm {code}` |
| Mini App | initData Telegram tervalidasi | `POST /keys/rotate` langsung (sesi `kind=buyer`) |
| Admin | sesi admin | `POST /api/admin/access/keys/{id}/rotate` |

`/keys/rotate` dengan sesi web biasa **ditolak** (`verification_required`) — token
browser bukan bukti orangnya. Respons rotasi menyertakan sesi baru untuk key baru,
supaya buyer tidak ter-logout setelah rotasi.

## 6. Katalog realtime

`GET /api/stream` (SSE) mengirim `event: catalog` setiap `model_prices` berubah
(harga, nama, status on/gangguan/off, limit hasil refresh route). Landing dan dashboard
berlangganan channel ini, jadi tab yang sudah terbuka ikut berubah tanpa reload —
tidak perlu login Telegram ulang. Polling 15–20 s tetap ada sebagai jaring pengaman.

## 7. Ringkas

| Pintu | URL/host | Kredensial di |
|---|---|---|
| SSH | `ubuntu@129.226.219.219` | password kamu / key |
| Admin panel | `https://router.aethink.ai.id/admin/login` | `gateway/.admin` |
| 9Router (lokal) | `https://router.aethink.ai.id:8443/login` | `/root/.secrets/9router.env` + basic auth `bang` |
| Bot | `@AethinkBot` | `/root/.secrets/aethink-bot.env` |
| API publik | `https://router.aethink.ai.id/v1` | `sk-aet_...` per pembeli |
