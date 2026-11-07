# AethinkAI Gateway

FastAPI gateway in front of 9Router. Owns users, keys, money. Upstream owns providers.

```
client ──► :8080 /v1/chat/completions ──► 9Router :20128 ──► provider
                    │
                    └─► Postgres (usage_events, ledger, balances, holds)
```

## Run (dev)

```bash
./run.sh                       # loads /root/.secrets/aethink-db.env, binds 127.0.0.1:8080
curl -s localhost:8080/health
```

## Money model

Integer **micro-IDR** (1 IDR = 1_000_000). Sell price stored as IDR per 1M tokens
(`model_prices.price_in_idr`), so the per-request charge is exact integer math:

```
cost_micro = tokens_in * price_in_idr + tokens_out * price_out_idr + tokens_cached * price_cached_idr
```

Proof: 16 in / 14 out at Rp2.000 / Rp8.000 per 1M →
`16*2000 + 14*8000 = 144_000 micro = Rp0,144`.

## Request lifecycle

1. Resolve `sk-aeth_…` (prefix lookup + sha256 compare, revoked/ suspended rejected)
2. Model must have a price row and be active, else `403 model_not_allowed`
3. Balance must be > 0, else `402 insufficient_credits`
4. Hold = estimate (prompt guess + max_tokens), atomically debited from `balances`
5. Proxy to 9Router with peer token (loopback only)
6. Read `usage` from the final chunk/body → settle hold, charge actual, write `usage_events` + `ledger_entries`
7. Upstream error → hold released, event still recorded (`status = upstream_error`)

## Auth to upstream

9Router stores API keys masked, so the gateway authenticates on loopback with
`x-9r-peer-token` (from `/root/services/.9router-peer`) plus `x-9r-real-ip: 127.0.0.1`
and `requireApiKey=false` on the upstream. The upstream port never faces the internet.

## Layout

| Path | Purpose |
|---|---|
| `app/main.py` | routes, hold/settle orchestration |
| `app/db.py` | asyncpg queries (all parameterised `$1…`) |
| `app/upstream.py` | 9Router client, SSE/JSON parsing |
| `db/001_init.sql` | schema v1 |
| `scripts/seed_dev.py` | dev user, key (written to `.devkey`), price rows |

## Security posture

- Postgres listens on `127.0.0.1:5432` only; `pg_hba` = peer for local socket, `scram-sha-256` for loopback
- App role is not a superuser; DDL stays with the migration path
- DB password lives in `/root/.secrets/aethink-db.env` (0600), never in code or the frontend
- `balances.balance_micro` has `CHECK (balance_micro >= 0)` — a bug cannot mint negative balances silently

## API surface (v0.1)

Public
- `GET  /health`
- `GET  /api/models`                     katalog aktif (slug Aethink + harga IDR)
- `POST /api/auth/signup`                buat akun
- `POST /api/auth/login`                 JWT 24 jam

Customer (JWT)
- `GET  /api/me`                          saldo
- `GET  /api/me/summary`                  spend 30d / hari ini / req terakhir
- `GET  /api/me/usage?days=7`             agregat harian per model
- `GET  /api/me/ledger?limit=50`          mutasi saldo (topup / charge / hold_release)
- `GET  /api/keys` `POST /api/keys` `PATCH /api/keys/{id}` `DELETE /api/keys/{id}`

Admin (JWT + role=admin)
- `GET  /api/admin/models` `PUT /api/admin/models/{id}`
- `GET  /api/admin/keys` `DELETE /api/admin/keys/{id}`
- `GET  /api/admin/users` `POST /api/admin/users` `POST /api/admin/users/{id}/credit`
- `GET  /api/admin/summary`               revenue / cost / margin / liability / ledger diff
- `GET  /api/admin/usage?days=7`
- `GET  /api/admin/reconciliation?days=7` billed vs biaya upstream nyata
- `GET  /api/admin/pricing/suggest?margin_pct=35`
- `POST /api/admin/maintenance/expire-holds`
- `POST /api/admin/maintenance/backfill-cost`

OpenAI-compatible (API key `sk-aeth_…`)
- `GET  /v1/models`
- `POST /v1/chat/completions`             model = slug Aethink, route 9Router internal

Billing invariants
- saldo = Σ ledger_entries (dicek `summary.ledger_diff_micro` = 0)
- biaya upstream diambil dari ledger 9Router (`usageHistory`) → margin nyata, bukan tebakan
- hold expire dibalikin otomatis tiap 60 detik (janitor)
