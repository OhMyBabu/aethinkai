# MIGRASI SERVER — AethinkAI

Tujuan: pindah box tanpa kehilangan uang, key, atau sesi.

## 0. Ringkas (5 langkah)

```bash
# DI BOX LAMA
./scripts/backup.sh                     # dump DB + secrets + boxconf
./scripts/migrate-bundle.sh             # kode (git archive) + manifest
# salin 3 file dari /root/backups ke box baru (scp, jangan lewat git/chat publik)

# DI BOX BARU
sudo apt-get install -y postgresql-16 nginx python3-venv nodejs npm rsync ufw fail2ban certbot python3-certbot-nginx
tar -xzf aethink-code-*.tar.gz -C /root/ops && mv /root/ops/aethink-code-* /root/ops/aethinkai
cd /root/ops/aethinkai && ./scripts/restore.sh /path/secrets-*.tar.gz && ./scripts/restore.sh /path/aethink-*.dump
./scripts/migrate-bundle.sh --help >/dev/null 2>&1 || true
python3 -m venv gateway/.venv && gateway/.venv/bin/pip install -r gateway/requirements.txt
python3 -m venv bot/.venv && bot/.venv/bin/pip install -r bot/requirements.txt
cp deploy/systemd/*.service /etc/systemd/system/ && systemctl daemon-reload
cp deploy/nginx/aethink.conf /etc/nginx/sites-available/ && ln -sf ../sites-available/aethink.conf /etc/nginx/sites-enabled/
cp deploy/nginx/aethink-limits.conf /etc/nginx/conf.d/
certbot --nginx -d router.aethink.ai.id --non-interactive --agree-tos -m admin@aethink.ai --redirect
./deploy.sh && ./scripts/healthcheck.sh
```

## 1. Yang HARUS ikut pindah

| Artefak | Cara |
|---|---|
| Postgres `aethink` | `./scripts/backup.sh` → `aethink-*.dump` |
| `/root/.secrets/*` | ikut `secrets-*.tar.gz` |
| `gateway/.admin`, `gateway/.devkey` | ikut tarball secrets |
| vhost + systemd + fail2ban config | ikut `boxconf-*.tar.gz` |
| DNS `router.aethink.ai.id` | arahkan A record ke IP baru |
| Sertifikat TLS | **jangan** dicopy dari box lama, terbitkan baru dengan certbot |

Tidak perlu dipindah: `.venv`, `node_modules`, `dist`, `__pycache__` (dibangun ulang).

## 2. Yang TIDAK boleh lewat git / chat

- `DATABASE_URL` (password DB)
- `INTERNAL_SECRET` (HMAC bot↔gateway)
- `JWT_SECRET` (semua sesi portal)
- `UPSTREAM_KEY` (9Router)
- `BOT_TOKEN` (Telegram — siapa punya token ini punya bot-nya)

Kirim lewat `scp`/rsync dengan key, atau password manager. Kalau pernah tercopy ke
chat publik: **rotate semuanya** setelah migrasi (`openssl rand -hex 32` untuk
secret, BotFather `/revoke` untuk token bot).

## 3. Urutan agar tidak ada downtime berarti

1. Siapkan box baru, Postgres, secrets, kode (langkah 0) — jangan sentuh DNS dulu.
2. `restore.sh` dump **terbaru**, lalu `./deploy.sh` di box baru dan
   `./scripts/healthcheck.sh` harus `HEALTHY`.
3. Matikan bot di box lama (`systemctl stop aethink-bot`) supaya tidak dua bot
   polling `getUpdates` bersamaan (Telegram menolak 409 Conflict).
4. `pg_dump` sekali lagi (delta), restore ke box baru, `systemctl restart aethink-gateway`.
5. Pindahkan A record, tunggu TTL, terbitkan TLS baru, `./deploy.sh`.
6. Baru matikan gateway lama. Jangan sebaliknya.

## 4. Setelah migrasi — checklist

```bash
./scripts/healthcheck.sh                 # semua harus OK
cd gateway && ./.venv/bin/python tests/e2e_access.py   # 35/35
cd gateway && ./.venv/bin/python tests/e2e_link.py     # 32/32
cd bot     && ./.venv/bin/python tests/e2e_bot.py      # 12/12
```

- [ ] `curl https://router.aethink.ai.id/health` → `"db":true`
- [ ] `curl -o /dev/null -w '%{http_code}' https://router.aethink.ai.id/docs` → `404`
- [ ] `ufw status` → active, hanya 22/80/443
- [ ] `fail2ban-client status` → 3 jail (sshd, nginx-req-limit, nginx-botsearch)
- [ ] `systemctl list-timers | grep certbot` → ada jadwal renew
- [ ] `psql ... -c "select count(*) from users"` → sama dengan box lama
- [ ] ledger invariant 0 (healthcheck sudah cek)
- [ ] `/start` bot dari akun Bang → panel muncul (bukan diam)

## 5. Rollback

Box lama jangan dihapus minimal 72 jam. Kalau box baru bermasalah: kembalikan A
record ke IP lama, `systemctl start aethink-bot` di sana, selesai. Karena secrets
lama tidak diubah, rollback tidak butuh restore apa pun — kecuali kamu sudah
rotate secret; dalam kasus itu restore `secrets-*.tar.gz` yang lama.
