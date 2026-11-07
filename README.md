# AethinkAI Gateway — full stack (frontend + gateway + Telegram store bot + Mini App)

Monorepo. Everything needed to run and continue the project, minus credentials.

```
frontend/   Vite 7 + React 19 + TS + Tailwind v4 — landing page, buyer portal (/portal),
            Mini App (/tg), admin panel (/admin/*)
gateway/    FastAPI + asyncpg + Postgres — OpenAI-compatible /v1 proxy, billing, keys,
            portal API, Telegram internal API, admin API
bot/        Python long-polling Telegram store bot (button-only, single edited panel)
skills/     Agent skills written/extended while building this
docs/       PRD, design references, DB schema, runtime notes, secrets contract
deploy/     systemd units, nginx vhost + edge limits, SECURITY.md (posture + 9Router plan)
scripts/    backup / restore / migrate-bundle / healthcheck / price_audit
audit/      PRICING-AUDIT.md — sell price vs cost, per model
```

## Start here

| Kebutuhan | Dokumen |
|---|---|
| Jalanin dari nol (Postgres → domain → TLS) | **[DEPLOY.md](DEPLOY.md)** |
| Pindah server | **[MIGRATE.md](MIGRATE.md)** |
| Postur keamanan + rencana akses 9Router | **[deploy/SECURITY.md](deploy/SECURITY.md)** |
| Audit harga / margin | **[audit/PRICING-AUDIT.md](audit/PRICING-AUDIT.md)** |
| Kondisi terakhir project | **[HANDOFF.md](HANDOFF.md)** |

Perintah harian:

```bash
./deploy.sh                  # build frontend + restart gateway + smoke check
./deploy.sh backend          # restart gateway saja
./scripts/healthcheck.sh     # 14 cek: unit, endpoint, TLS, ufw, fail2ban, ledger
./scripts/backup.sh          # dump DB + secrets + boxconf (retensi 14 hari)
./scripts/migrate-bundle.sh  # kode (git archive) + manifest untuk box baru
```

## 60-second orientation

- **One Postgres is the source of truth**: users, balances (micro-IDR), api_keys, orders,
  buyers, usage_events, model_prices, link_codes, auth_failures, ledger_entries, holds.
- **Money**: 1 IDR = 1_000_000 micro-IDR. `balances.balance_micro` is the wallet;
  `usage_events.cost_micro` is the charge; `ledger_entries` must always sum to the wallet
  (`healthcheck` gagal kalau drift). Never sum balance per key — several keys of one buyer
  share a single `balances` row (sum per `DISTINCT user_id`).
- **Three faces, one backend**:
  - Telegram bot = sales/account channel. Button-only, one edited message per flow.
  - Web portal `/portal` + Mini App `/tg` = read-only dashboards over a JWT.
  - Admin web `/admin/*` = control plane (models, prices, keys, buyers, orders, live usage).
- **9Router** is the upstream router. `model_prices.model_id` holds its real route
  (`<provider>/<model>`, e.g. `mr/glm-5.3-flash`); customers only ever see `public_id`.
  A model with no price row is rejected (`403 model_not_allowed`), never served free.
- **Identity**: buyers have no password. Telegram `tg_id` is the account. Two ways in:
  bot deep link (`/start link_<code>`) or Mini App `initData` signature. Both end in the same
  buyer JWT (`sub=buyer:<id>`, 12 h, read-only). Admin is a separate realm at `/admin/login`.

## Where to look first

| Question | File |
|---|---|
| How is the API shaped? | `gateway/app/main.py`, `gateway/app/portal.py` |
| How is money metered? | `gateway/app/main.py` (`cost_micro`, cached slice priced once), `gateway/app/db.py` |
| How does auth work? | `gateway/app/auth.py`, `gateway/app/portal.py` (`portal_identity`, `_verify_init_data`) |
| How does the bot keep one panel? | `bot/bot.py` (`show_home`, `edit`, `handle_callback`) |
| What did the client ask for? | `docs/AETHINKAI_TELEGRAM_BOT_UI_PRD_HERMES.md` |
| Who logs in where | `docs/ACCESS.md` |
| Current DB shape | `docs/schema.sql` (snapshot, 19 tabel) |
| Secrets contract | `docs/SECRETS.md`, `docs/env.gateway.example`, `docs/env.bot.example` |
| Harga & margin | `gateway/scripts/price_audit.py`, `audit/PRICING-AUDIT.md` |
| Tests | `gateway/tests/e2e_access.py`, `gateway/tests/e2e_link.py`, `bot/tests/e2e_bot.py`, `gateway/tests/adversarial.py` |
| Books don't balance | `gateway/scripts/ledger_audit.py` (`--fix` posts an adjustment row) |

## Verification (wajib sebelum bilang "live")

```bash
cd gateway && ./.venv/bin/python tests/e2e_access.py   # 35/35
cd gateway && ./.venv/bin/python tests/e2e_link.py     # 32/32
cd bot     && ./.venv/bin/python tests/e2e_bot.py      # 12/12
./gateway/.venv/bin/python gateway/tests/adversarial.py # 20/20 — money + authz attacks
cd frontend && npx tsc -b && npm run build             # 0 error
./scripts/healthcheck.sh                               # HEALTHY
```

Satu completion nyata ke `/v1/chat/completions` adalah satu-satunya bukti data plane
hidup — `/models` bisa 200 sementara upstream mati.
