# DEPLOY — dari nol ke server hidup

Target: satu box Linux (Ubuntu 24.04), satu Postgres lokal, satu vhost nginx,
satu systemd unit untuk gateway (+ satu untuk bot begitu `BOT_TOKEN` ada).

## 1. Paket dasar

```bash
apt-get update
apt-get install -y postgresql-16 postgresql-client-16 nginx python3-venv nodejs npm rsync
```

Node 20+ dibutuhkan Vite 7 (repo ini dites di Node 26).

## 2. Postgres

```bash
su postgres -c "psql -c \"CREATE ROLE aethink LOGIN PASSWORD '<pass>';\""
su postgres -c "psql -c \"CREATE DATABASE aethink OWNER aethink;\""
psql "$DATABASE_URL" -f docs/schema.sql          # fresh install
```

`schema.sql` sudah final (19 tabel). Untuk DB lama pakai `gateway/db/002_portal.sql` +
`003_link.sql`.

Bukti aman: `ss -ltnp | grep 5432` harus `127.0.0.1`, `pg_hba` pakai `scram-sha-256`,
role aplikasi bukan superuser, password file `chmod 600`.

## 3. Secrets

```bash
mkdir -p /root/.secrets && chmod 700 /root/.secrets
cp docs/env.gateway.example /root/.secrets/aethink-db.env   # isi nilai asli
chmod 600 /root/.secrets/aethink-db.env

openssl rand -hex 32 > /root/.secrets/aethink-internal       # HMAC bot↔gateway
echo "$(openssl rand -hex 32)"                               # → JWT_SECRET
```

`gateway/app/config.py` memuat file ini sendiri (`.env` di repo, atau
`/root/.secrets/aethink-db.env`), jadi script `seed_*`, `tests/*` dan uvicorn semuanya
dapat env yang sama tanpa wrapper shell.

## 4. Gateway

```bash
cd gateway
python3 -m venv .venv && ./.venv/bin/pip install -r requirements.txt
./.venv/bin/python scripts/seed_admin.py     # admin + customer, kredensial → gateway/.admin
./.venv/bin/python scripts/seed_dev.py       # user dev + key (opsional, untuk smoke test)

cp ../ops/aethinkai/deploy/systemd/aethink-gateway.service /etc/systemd/system/  # atau pakai unit di bawah
systemctl daemon-reload && systemctl enable --now aethink-gateway
curl -s localhost:8080/health
```

## 5. Harga model

Catalogue publik hanya menampilkan `model_prices` yang `active` **dan** punya harga
**dan** route-nya masih ada di upstream. Isi lewat admin UI (`/admin/models`) atau SQL:

```sql
INSERT INTO model_prices (model_id, public_id, provider_label, display_name,
                          price_in_idr, price_out_idr, price_cached_idr, active)
VALUES ('mr/glm-5.3-flash','glm-5.3-flash','Zhipu','GLM-5.3 Flash',700,2350,490,true);
```

`model_id` = route upstream asli (`<provider>/<model>`), `public_id` = slug yang dilihat
pembeli. Jangan pernah mengarang harga: kalau belum tahu, biarkan `active=false`.

## 6. Frontend + nginx

```bash
cd frontend && npm ci && npm run build
rsync -a --delete dist/ /var/www/aethink/ && chown -R www-data:www-data /var/www/aethink
```

nginx **tidak bisa** memakai `root /root/...` (direktori home `drwx------`), makanya
build disalin ke `/var/www/aethink`. Vhost lengkap: `/etc/nginx/sites-available/aethink.conf`
(SPA fallback + proxy `/api` `/v1`, `proxy_buffering off` untuk SSE dan streaming).

```bash
nginx -t && systemctl reload nginx
```

Semua langkah di atas sudah dibungkus:

```bash
./deploy.sh            # backend + frontend + smoke check
./deploy.sh backend    # restart gateway saja
./deploy.sh frontend   # rebuild SPA saja
```

## 7. Bot

```bash
cp docs/env.bot.example /root/.secrets/aethink-bot.env
# isi BOT_TOKEN (BotFather), AETHINK_ADMINS, PORTAL_URL=https://router.aethink.ai.id
chmod 600 /root/.secrets/aethink-bot.env
systemctl enable --now aethink-bot
journalctl -u aethink-bot -f
```

`AETHINK_INTERNAL_FILE` harus menunjuk file yang isinya sama dengan `INTERNAL_SECRET`
gateway. Bot tidak butuh Postgres — semua lewat `/api/internal/*` yang ditandatangani HMAC.

## 8. Verifikasi wajib sebelum bilang "live"

```bash
curl -s localhost:8080/health
curl -s localhost:8080/api/models | jq '.count'
curl -s localhost:8080/api/status
cd gateway && ./.venv/bin/python tests/e2e_access.py   # 35/35
cd gateway && ./.venv/bin/python tests/e2e_link.py     # 32/32
cd bot     && ./.venv/bin/python tests/e2e_bot.py      # 12/12
```

Satu completion nyata (bukan `/models`) adalah satu-satunya bukti data plane hidup:

```bash
curl -s localhost:8080/v1/chat/completions \
  -H "Authorization: Bearer $(cat gateway/.devkey)" \
  -H 'Content-Type: application/json' \
  -d '{"model":"glm-5.3-flash","messages":[{"role":"user","content":"ping"}],"max_tokens":16}'
```

## 9. Domain

`router.aethink.ai.id` → A record ke IP box, lalu TLS:

```bash
apt-get install -y certbot python3-certbot-nginx
certbot --nginx -d router.aethink.ai.id
```

Setelah domain hidup, set `AETHINK_MINIAPP_URL=https://router.aethink.ai.id` dan
`PORTAL_URL` di env bot ke origin yang sama, lalu restart keduanya. Mini App butuh HTTPS —
tombol `web_app` Telegram menolak origin HTTP.
