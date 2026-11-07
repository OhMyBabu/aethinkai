# AethinkAI Gateway — full stack (frontend + gateway + Telegram store bot + Mini App)

Monorepo handoff. Everything needed to run and continue the project, minus credentials.

```
frontend/   Vite 7 + React 19 + TS + Tailwind v4 — landing page, buyer portal (/portal),
            Mini App (/tg), admin panel (/admin/*)
gateway/    FastAPI + asyncpg + Postgres — OpenAI-compatible /v1 proxy, billing, keys,
            portal API, Telegram internal API, admin API
bot/        Python long-polling Telegram store bot (button-only, single edited panel)
skills/     Agent skills written/extended while building this (read these first)
docs/       PRD, design references, DB schema, runtime notes, secrets contract
```

## 60-second orientation

- **One Postgres is the source of truth**: users, balances (micro-IDR), api_keys, orders,
  buyers, usage_events, model_prices, link_codes, auth_failures, app settings.
- **Money**: 1 IDR = 1_000_000 micro-IDR. `balances.balance_micro` is the wallet;
  `usage_events.cost_micro` is the ledger. Never sum balance per key — several keys of one buyer
  share a single `balances` row (sum per `DISTINCT user_id`).
- **Three faces, one backend**:
  - Telegram bot = sales/account channel. Button-only, one edited message per flow.
  - Web portal `/portal` + Mini App `/tg` = read-only dashboards over a JWT.
  - Admin web `/admin/*` = control plane (models, prices, keys, buyers, orders, live usage).
- **9Router** (`:20128`) is the upstream router; `gateway` calls it with `mk/<model>` ids and
  records usage. It is not a wallet.
- **Identity**: buyers have no password. Telegram `tg_id` is the account. Two ways in:
  bot deep link (`/start link_<code>`) or Mini App `initData` signature. Both end in the same
  buyer JWT (`sub=buyer:<id>`, 12 h, read-only).

## Run it

Ringkas: `./deploy.sh` (build frontend + restart gateway + smoke check). Panduan lengkap
dari nol sampai domain + TLS: **[DEPLOY.md](DEPLOY.md)**. Unit systemd dan vhost nginx
yang dipakai server ada di `deploy/`.

Manual:

```bash
# 0. Postgres 16 running locally, database + role created, see docs/SECRETS.md
# 1. gateway
cd gateway
python -m venv .venv && ./.venv/bin/pip install -r requirements.txt
cp ../docs/env.gateway.example .env        # fill real values
psql "$DATABASE_URL" -f db/002_portal.sql
psql "$DATABASE_URL" -f db/003_link.sql
./run.sh                                   # uvicorn 127.0.0.1:8080

# 2. frontend (dev, proxies /api + /v1 to :8080)
cd frontend && npm i && npm run dev        # :5173
# static preview for the Mini App / tunnel target:
npm run build && npm run preview           # :4173

# 3. bot
cd bot && python -m venv .venv && ./.venv/bin/pip install -r requirements.txt
BOT_ENV_FILE=../docs/env.bot.example ./.venv/bin/python bot.py   # or pm2
```

## Where to look first

| Question | File |
|---|---|
| How is the API shaped? | `gateway/app/main.py`, `gateway/app/portal.py` |
| How is money metered? | `gateway/app/db.py` (`record_usage`, `credit_user`, `find_key`) |
| How does auth work? | `gateway/app/auth.py`, `gateway/app/portal.py` (`portal_identity`, `_verify_init_data`) |
| How does the bot keep one panel? | `bot/bot.py` (`show_home`, `edit`, `handle_callback`) |
| What did the client ask for? | `docs/AETHINKAI_TELEGRAM_BOT_UI_PRD_HERMES.md` |
| Current DB shape | `docs/schema.sql` |
| Secrets contract | `docs/SECRETS.md` |
| Runtime facts (ports, pm2 names, tunnels) | `docs/RUNTIME.md` |
| Tests | `gateway/tests/e2e_access.py`, `gateway/tests/e2e_link.py`, `bot/tests/e2e_bot.py` |

Tests were green at handoff: access 35/35, link 32/32, bot 12/12. Run them before changing
auth, keys, or balance logic.
