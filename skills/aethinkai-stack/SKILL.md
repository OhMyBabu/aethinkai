---
name: aethinkai-stack
description: Use when working on the AethinkAI gateway monorepo (frontend + FastAPI gateway + Telegram store bot + Mini App). Maps the codebase, invariants, run/test commands, and pitfalls so a new agent can continue the project without re-discovery.
---

# AethinkAI stack — operator map

Reseller LLM gateway in IDR: Telegram bot sells, web portals read, Postgres is truth,
9Router is upstream. Monorepo layout: `frontend/ gateway/ bot/ docs/ skills/`.

Read `HANDOFF.md` at the repo root first — it is the authoritative state note. This skill is the
short path to being productive in the code.

## 1. Mental model (do not break these)

1. **One database = one truth.** Wallet (`balances.balance_micro`), ledger (`usage_events`),
   catalogue (`model_prices`), packages (`PACKAGES` in `gateway/app/portal.py`), orders, buyers,
   keys, `link_codes`.
2. **Micro-IDR everywhere.** 1 IDR = 1_000_000 micro. Format for humans only at the edge.
3. **Balance is per user, not per key.** Several keys of one buyer share one `balances` row.
   Query `sum(balance_micro) WHERE user_id IN (SELECT DISTINCT user_id FROM api_keys WHERE ...)`.
   Joining balances × keys multiplies the number (this bug shipped once already).
4. **Buyers have no password.** Identity = Telegram `tg_id`; the session is a read-only JWT
   `sub=buyer:<id>`. Admin login (email+password) is a separate realm at `/admin/login`.
5. **Two signed paths bot↔gateway:** POST signs `HMAC(secret, ts + "." + raw_body)`, GET signs
   `HMAC(secret, ts + "." + resource)` (`pending`, `buyers`, `buyer:<tg>`, `<order_id>`).
   Verify before parsing JSON, reject clock skew >300 s.
6. **Bot is button-only and edits one message.** `sendMessage` only for cross-chat notifications.
   Persist the bubble id (`orders.telegram_msg_id`) so the key receipt lands where the invoice was.
7. **Everything user-visible is Indonesian**, tokens/money right-aligned, palette
   `#18191B / #232426 / #383A3E / #FAF8F4 / #A1A3A7 / #E7893C / #9C542F`.

## 2. Where things live

| Need | File |
|---|---|
| proxy + metering + catalogue endpoints | `gateway/app/main.py`, `gateway/app/db.py` |
| portal/buyer/internal/admin-access endpoints | `gateway/app/portal.py` |
| auth, signup, login lockout, `/api/keys` | `gateway/app/user.py`, `gateway/app/auth.py` |
| rate limits / lockout ladders | `gateway/app/ratelimit.py` |
| live monitor, admin extras | `gateway/app/live.py`, `gateway/app/extras.py` |
| bot panels + callbacks | `bot/bot.py` (`home_text`, `home_keyboard`, `handle_callback`, `do_grant`) |
| buyer web dashboard | `frontend/src/pages/public/Portal.tsx` |
| Mini App | `frontend/src/pages/tg/MiniApp.tsx`, `frontend/src/lib/tg.ts` |
| admin UI | `frontend/src/pages/admin/*`, `frontend/src/lib/gw.ts` |
| schema | `docs/schema.sql`, `gateway/db/002_portal.sql`, `gateway/db/003_link.sql` |

## 3. Run + verify

```bash
cd gateway && ./run.sh                       # :8080
cd frontend && npm run dev                   # :5173 (proxy /api + /v1)
cd bot && ./.venv/bin/python bot.py          # long polling

cd gateway && ./.venv/bin/python tests/e2e_access.py   # 35/35
cd gateway && ./.venv/bin/python tests/e2e_link.py     # 32/32
cd bot     && ./.venv/bin/python tests/e2e_bot.py      # 12/12
cd frontend && npx tsc -b && npm run build
```

Never claim green without running them; these tests were the gate for every feature.

## 4. Recipes

**Add a model price** → insert into `model_prices` (`model_id` = `mk/<upstream id>`), set
`active`; `/api/models`, the bot Models panel and the Mini App pick it up automatically
(cached 5 min in the bot).

**Change a package** → edit `PACKAGES` in `gateway/app/portal.py`; the bot fetches `/api/packages`
at startup and caches it, the web store reads the same endpoint. Never hardcode prices in the bot.

**New bot screen** → add a `m:<name>` branch in `handle_callback`, render with `edit(...)`, and
always include `⬅️ Menu`. If it needs fresh numbers, extend `/api/internal/buyer/{tg}` rather
than adding a second source.

**New buyer endpoint** → put it under `gateway/app/portal.py` `portal` router and depend on
`portal_identity`; handle `row["key_id"] is None` (a buyer may have no key yet).

**Mini App call** → use `req()` in `frontend/src/lib/tg.ts` so the bearer token and error shape
stay consistent; session lives in `sessionStorage`, never `localStorage`.

**Payment integration (not built)** → credit only from a server-verified event, idempotent per
payment id, inside a transaction that locks the order row.

## 5. Pitfalls seen in production

- `pkill -f "uvicorn app.main"` kills your own shell — use the bracket form `pkill -f "[u]vicorn app.main"`.
- FastAPI wraps `HTTPException` detail; the client reads `body.error ?? body.detail`.
- Telegram `editMessageText` returns `400 message is not modified` on a double tap — treat as no-op.
- A bot cannot DM a user who never pressed Start (`400 chat not found`).
- Quick tunnel URLs rotate on restart; read them from the pm2 log or set `AETHINK_MINIAPP_URL`.
- `web_app` buttons require HTTPS; fall back to a `url` button when no HTTPS origin exists.
- `editMessageText` cannot convert a message that has media; invoice panels must stay text-only.
- Do not restructure the frontend while doing backend work, and do not touch the landing page
  unless the task is the landing page.

## 6. Deploy checklist for the new server

1. Postgres 16 + role/db; apply `docs/schema.sql` (fresh) or `002`/`003` (existing).
2. Restore secrets from `docs/SECRETS.md` — never from git.
3. `gateway/run.sh` under systemd/pm2; bot under pm2 with `BOT_ENV_FILE`.
4. Build the frontend (`npm run build`) and serve `dist/` behind HTTPS; point the bot's
   `PORTAL_URL` and `AETHINK_MINIAPP_URL` at that origin.
5. Rotate `BOT_TOKEN`, `JWT_SECRET`, `INTERNAL_SECRET`; re-issue buyer keys if leaked.
6. Run the three e2e suites against the new box before announcing.
