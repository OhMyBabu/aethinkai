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

## 5. Ringkas

| Pintu | URL/host | Kredensial di |
|---|---|---|
| SSH | `ubuntu@129.226.219.219` | password kamu / key |
| Admin panel | `https://router.aethink.ai.id/admin/login` | `gateway/.admin` |
| 9Router | `http://43.173.36.225:20128/login` | env box relay |
| Bot | `@AethinkBot` | `/root/.secrets/aethink-bot.env` |
| API publik | `https://router.aethink.ai.id/v1` | `sk-aet_...` per pembeli |
