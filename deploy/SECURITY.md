# SECURITY — postur AethinkAI (dan 9Router)

Status terakhir diverifikasi: 2026-11-07 di box `129.226.219.219`
(`router.aethink.ai.id`).

## 1. Permukaan publik (apa yang benar-benar terbuka)

```
:22   sshd        root login = password + key, fail2ban 3 percobaan / 2 jam
:80   nginx       301 → https (kecuali host lain → 404)
:443  nginx       SPA + /api + /v1
```

Tertutup: `5432` (Postgres), `8080` (uvicorn), `20128` (9Router) — semuanya loopback.
UFW: default deny incoming, hanya 22/80/443.

## 2. Kontrol yang aktif

| Lapis | Kontrol | Bukti |
|---|---|---|
| Edge | HSTS 1 tahun, CSP, X-Frame-Options, COOP, Permissions-Policy | `curl -sI https://router.aethink.ai.id/` |
| Edge | `server_tokens off` (tanpa versi nginx) | header `Server: nginx` |
| Edge | rate limit: auth 8/menit, api 15 r/s, v1 25 r/s, generic 40 r/s, conn 32/IP | `conf.d/aethink-limits.conf` |
| Edge | `/docs`, `/redoc`, `/openapi.json` → 404 | curl |
| Edge | dotfiles, `*.sql/*.env/*.log/*.key/*.pem` → deny | vhost |
| App | API docs dimatikan di FastAPI (`AETHINK_DOCS` untuk menyalakan) | `app/main.py` |
| App | lockout admin & portal per (identitas, IP), RPM per key | `app/ratelimit.py` |
| App | JWT portal 12 jam, read-only, `aud`/`scope` dicek | `app/portal.py` |
| App | initData Telegram diverifikasi HMAC + tolak `auth_date` > 24 jam | `app/portal.py` |
| Bot | HMAC `ts.body` ±300 s, grant idempoten per order | `bot/bot.py` |
| DB | listen 127.0.0.1, `scram-sha-256`, role bukan superuser, `statement_timeout=30s`, `REVOKE CREATE ON SCHEMA public FROM PUBLIC` | psql |
| DB | invariant `Σbalance == Σledger`, ditampilkan sebagai `ledger_diff_micro` | admin summary |
| Host | fail2ban: sshd, nginx-req-limit, nginx-botsearch | `fail2ban-client status` |
| Host | UFW aktif | `ufw status` |
| TLS | Let's Encrypt, renew otomatis (certbot.timer) | `systemctl list-timers` |

## 3. Akses: siapa boleh apa

| Aktor | Masuk lewat | Boleh |
|---|---|---|
| **Bang** (owner) | SSH key/password, `/admin/login` (email+password), bot (id 541900896) | semua: admin panel, DB, deploy, rotate secret |
| **Ganteng** (dev/admin) | SSH dari box ini, `/admin/login` | sama; tooling di `scripts/`, `deploy.sh` |
| Buyer | Telegram (`/start` deep link) atau Mini App `initData` | read-only: saldo, usage, key, order |
| API client | `sk-aeth_…` | `/v1/*` sesuai RPM + saldo |
| 9Router upstream | `UPSTREAM_KEY` (Bearer) | hanya dipanggil dari gateway |

Aturan: **tidak ada buyer yang punya password**, jadi tidak ada form login buyer
yang bisa di-brute force. `/signup` dialihkan ke `/login`.

## 4. Yang belum (dan caranya)

1. **SSH key-only.** Sekarang root masih bisa password (biar tidak kekunci).
   Kirim public key ke Bang/Ganteng, lalu:
   ```bash
   echo 'ssh-ed25519 AAAA... bang@laptop' >> /root/.ssh/authorized_keys
   chmod 600 /root/.ssh/authorized_keys
   sed -i 's/^PermitRootLogin yes/PermitRootLogin prohibit-password/' /etc/ssh/sshd_config.d/99-aethink.conf
   sed -i 's/^PasswordAuthentication yes/PasswordAuthentication no/'   /etc/ssh/sshd_config.d/99-aethink.conf
   sshd -t && systemctl reload ssh
   ```
   Uji dari sesi kedua **sebelum** menutup sesi pertama.

2. **TOTP untuk admin panel** (opsional, kalau Bang mau 2FA). Titik sisip:
   `app/auth.py` (`login`) + kolom `users.totp_secret`.

3. **IP allowlist admin** (kalau IP Bang statis):
   ```nginx
   geo $admin_ok { default 0; 103.x.x.x/32 1; }
   location /api/admin/ { if ($admin_ok = 0) { return 403; } ... }
   ```
   Jangan dipasang sebelum IP-nya dipastikan — bisa mengunci diri sendiri.

## 5. 9Router — model akses & hardening

9Router adalah **infrastruktur**, bukan API publik. Posisi sekarang: relay di
`43.173.36.225:20128`, gateway memanggilnya dengan Bearer key.

### Target konfigurasi (wajib)

```
internet ──X──> :20128            # port router TIDAK boleh terbuka
gateway ──loopback/WireGuard──> 9Router :20128
admin  ──WireGuard/SSH tunnel──> dashboard
```

1. **Bind loopback.** `HOSTNAME=127.0.0.1` (bukan `0.0.0.0`). Kalau gateway beda box:
   pasang WireGuard, bind 9Router ke IP WG saja, firewall tolak 20128 dari publik.
2. **Password dashboard** dari env `INITIAL_PASSWORD` (bukan default). Default
   password hanya diterima dari loopback — itu guard, bukan bug.
3. **Dua kredensial terpisah**: key untuk gateway (`UPSTREAM_KEY`) dan password
   dashboard hanya untuk manusia. Key gateway dibuat khusus, bisa dicabut tanpa
   mengganggu dashboard.
4. **Rotasi key** kalau pernah tampil di chat/log/screenshot. Setelah rotasi,
   update `/root/.secrets/aethink-db.env` → `systemctl restart aethink-gateway`.
5. **Rate limit di depan dashboard** (nginx basic-auth + `limit_req`) atau cukup
   lewat WireGuard — dashboard tidak butuh publik.
6. **Audit**: aktifkan log 9Router, cek `usageHistory` untuk lonjakan biaya yang
   tidak dikenal (indikasi key bocor).

### Perintah cepat saat dapat akses box relay

```bash
# 1. pastikan tidak publik
ss -ltnp | grep 20128        # harus 127.0.0.1 atau IP wg, bukan 0.0.0.0
# 2. kalau masih 0.0.0.0:
pm2 restart 9router --update-env   # dengan HOSTNAME=127.0.0.1
# 3. buktikan dari luar (dari box lain):
curl -m 3 http://43.173.36.225:20128/api/health   # harus timeout/refused
# 4. rotasi key gateway, lalu di box gateway:
systemctl restart aethink-gateway && ./scripts/healthcheck.sh
```

## 6. Incident response (kalau curiga dibobol)

```bash
# 1. jejak masuk
last -a | head; grep -c 'Failed password' /var/log/auth.log
fail2ban-client banned
psql "$DATABASE_URL" -c "select * from auth_failures order by at desc limit 20;"
# 2. jejak API
psql "$DATABASE_URL" -c "select client_ip, client_ua, count(*), sum(cost_micro)/1e6 rp
                          from usage_events group by 1,2 order by rp desc limit 20;"
# 3. matikan yang bocor
psql "$DATABASE_URL" -c "update api_keys set revoked_at=now(), status='revoked' where id='<key>';"
# 4. rotate semua secret
openssl rand -hex 32   # JWT_SECRET / INTERNAL_SECRET
# 5. force logout semua sesi portal = ganti JWT_SECRET (token lama langsung invalid)
systemctl restart aethink-gateway aethink-bot
```
