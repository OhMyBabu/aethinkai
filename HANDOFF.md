# HANDOFF — AethinkAI Gateway (state at migration, 2026-11-07)

Written by the operator who built this. Read this before touching anything;
it lists what exists, why it is shaped this way, and what is still open.

---

## 1. What the product is

A reseller-grade LLM gateway in Rupiah:

```
buyer ── Telegram bot (@AethinkBot) ──  sells packages, mints keys, rotates keys
      └─ web /portal + Mini App /tg ──  read-only dashboard (balance, usage, models, orders)
admin ── web /admin/*  ───────────────  prices, models, buyers, keys, orders, live monitor
                     │
              gateway (FastAPI, /v1 OpenAI-compatible)
                     │
                  9Router (:20128) ── upstream providers
```

One Postgres holds identity, wallet, keys, orders and the usage ledger. The bot never
computes usage or prices; it only calls signed internal endpoints.

## 2. Runtime (dev box at handoff)

| Piece | Port | Process |
|---|---|---|
| gateway (uvicorn) | 127.0.0.1:8080 | `gateway/run.sh` |
| frontend dev (vite) | 5173 | `npm run dev` |
| frontend preview (static build) | 4173 | `npm run preview` |
| Postgres 16 | 127.0.0.1:5432 | db `aethink`, role `aethink` |
| 9Router | 0.0.0.0:20128 | pm2 id 0 |
| bot | — | pm2 `aethink-store-bot` (long polling) |
| quick tunnel → 4173 | — | pm2 `aethink-tunnel` (URL changes every restart) |

Never expose 5432 or 20128 publicly.

## 3. Money model

- `1 IDR = 1_000_000 micro-IDR`. All integers.
- `balances.balance_micro` — spendable wallet per **user** row.
- `usage_events.cost_micro` — what a request cost, computed from `model_prices`
  (`price_in_idr`, `price_out_idr`, `price_cached_idr`, per 1M tokens).
- `orders` — package purchase: `price_idr`, `credits_micro` (price × 1e6), `status`
  (`pending` → `granted`), `telegram_msg_id` (the chat bubble to edit), `key_id`.
- Granting is idempotent: `POST /api/internal/order/{id}/grant` flips `status` once inside a
  row lock; a second tap returns `already_granted` and never mints a second key.
- **Gotcha that already bit us:** summing `balances` by joining `api_keys` multiplies the
  balance by key count (keys share one `user_id`). Always
  `sum(balance_micro) WHERE user_id IN (SELECT DISTINCT user_id …)`.

## 4. Identity

Buyers **never have a password**.

1. **Bot deep link** — web calls `POST /api/portal/telegram/start`, gets
   `https://t.me/AethinkBot?start=link_<code>`; the bot receives `/start link_<code>`, calls
   `POST /api/internal/link/confirm` (HMAC), the browser polls
   `GET /api/portal/telegram/status?code=` and receives a buyer JWT once (`consumed_at` guard).
2. **Mini App** — `POST /api/tg/session {init_data}` verifies Telegram's `initData`:
   `secret = HMAC_SHA256("WebAppData", bot_token)`, then compare
   `HMAC_SHA256(secret, sorted "k=v" lines)`. Reject `auth_date` older than 24 h. Never read
   `initDataUnsafe`.

Both produce `sub=buyer:<id>`, `scope=buyer`, `purpose=portal`, `aud=aethink-portal`, TTL 12 h,
read-only. Key-based sessions (`sub=<key_id>`) still exist for legacy flows; endpoints that
need real key material (rotate) answer `409 no_key` for buyer sessions with no key.

Admin login is separate and still email + password (`/api/auth/login`, `/admin/login`).
Lockout is per `(identity, ip)`, IP thresholds are higher to survive NAT.

## 5. API surface (as built)

### Public
| Method | Path | Notes |
|---|---|---|
| GET | `/health` | liveness |
| GET | `/api/status` | live counters (`requests_24h`, `requests_7d`, tokens, success rate) |
| GET | `/api/models` | catalogue + `pricing_idr_per_1m` (only active/priced models) |
| GET | `/api/packages` | store packages, single source for bot + web |
| GET | `/api/miniapp` | public Mini App URL (env override, else newest tunnel URL) |
| POST | `/api/tg/session` | initData → buyer JWT |
| POST | `/api/portal/telegram/start` | one-time link code |
| GET | `/api/portal/telegram/status?code=` | `pending` / `confirmed`+token / `consumed` / `expired` |

### Buyer portal (JWT: `Authorization: Bearer <buyer token>`)
`POST /api/portal/session` (key → JWT) · `GET /me` · `/usage?days=` · `/models?days=` ·
`/requests?limit=` · `/keys` · `POST /keys/rotate` · `POST /order {sku}` · `GET /orders`

### Internal (bot → gateway, HMAC)
Header `X-Timestamp` (±300 s) + `X-Signature`.
POST bodies sign `f"{ts}." + raw_body`; GET signs the canonical resource string.

| Method | Path | Signed string |
|---|---|---|
| POST | `/api/internal/link/confirm` | body |
| POST | `/api/internal/order` | body |
| POST | `/api/internal/order/{id}/grant` | body |
| GET | `/api/internal/order/{id}` | `{ts}.{order_id}` |
| GET | `/api/internal/pending` | `{ts}.pending` |
| GET | `/api/internal/buyers` | `{ts}.buyers` |
| GET | `/api/internal/buyer/{tg_id}` | `{ts}.buyer:{tg_id}` |
| POST | `/api/internal/rotate` | body |
| POST | `/api/internal/grant` (legacy) | body |

### Admin
`/api/admin/*` (models, prices, keys, live, fallbacks, bansos) plus
`/api/admin/access/{keys,buyers,orders,auth-failures}` and
`PATCH /api/admin/access/keys/{id}` (rpm), `POST …/rotate`, `POST …/credit`.

### Data plane
`POST /v1/chat/completions` (+ embeddings/models passthrough) — requires a live API key
(`sk-aeth_…` or `sk-bansos_…`), enforces RPM sliding window, writes `usage_events`,
returns `X-RateLimit-*` and OpenAI-shaped errors.

## 6. Telegram bot (bot/bot.py)

- Button-only. `deleteMyCommands` is called; `/start`, `/menu`, `/saldo`, `/portal` exist as
  fallbacks that open the same panels.
- **One message per flow.** Every navigation is `editMessageText` on the same bubble;
  `sendMessage` only for cross-chat notifications (admin alert on new order) and for a buyer
  with no panel yet. Order rows store `telegram_msg_id` so the grant can turn the buyer's
  invoice bubble into the key receipt.
- Home panel: brand line, greeting, balance, `N key aktif · N request 24 jam`, real gateway
  status, update time. Keyboard: Top Up / API Keys · Models / Usage · Rewards / Support,
  full-width `🌐 Buka Dashboard` (`web_app` button when an HTTPS Mini App URL exists, else URL),
  `Admin Panel` for admins only.
- Menus: Top Up → packages → invoice → "Saya sudah bayar" → admin grant; API Keys → masked keys
  + rotate (one-time reveal); Models → live catalogue with in/out per 1M; Usage → 24 h/7 d/total;
  Rewards → honest "no active program"; Support → forwards a ping to admins.
- Text input is never required; unknown text re-renders home.

## 7. Frontend

- Design tokens: `#18191B` bg, `#232426` card, `#2B2D30` hover, `#383A3E` border,
  `#FAF8F4` text, `#A1A3A7` muted, `#E7893C` accent, `#9C542F` secondary. No blue/purple/neon.
- Routes: `/` landing (data-driven from `/api/models` + `/api/status`), `/login` (Telegram only),
  `/portal` (buyer dashboard + store), `/tg` (Mini App), `/admin/login` (email+password),
  `/admin/*` (control plane), `/signup` → redirect to `/login`.
- Mini App: 4 tabs (Home/Models/Usage/Akun), bottom nav, sheets for top-up and model detail,
  token in `sessionStorage` (`aethink-tg-token`), `Telegram.WebApp` `ready/expand/theme`.
- Buyer portal: Telegram connect (polling) with API-key paste as a fallback in a `<details>`,
  package cards → `POST /api/portal/order`, order list.

## 8. Tests (all green at handoff)

```bash
cd gateway && ./.venv/bin/python tests/e2e_access.py   # 35/35 — hardening, RPM, rotate, lockout
cd gateway && ./.venv/bin/python tests/e2e_link.py     # 32/32 — link, session, web order, grant
cd bot     && ./.venv/bin/python tests/e2e_bot.py      # 12/12 — order→grant→key→chat→rotate
cd frontend && npx tsc -b && npm run build
```

## 9. Known gaps / next steps

1. **Payment is manual** (transfer/QRIS + admin confirmation). No gateway integration yet —
   intentionally deferred by the client ("payment terakhiran"). When adding one: make credit
   idempotent per `payment_id`/webhook event id, verify signature, never credit from a client
   callback.
2. `/app/settings`, `/admin/settings`, `/admin/pricing` are still fixtures.
3. Selling prices are **below cost** for Kimi K3 and GLM 5.3/Flash (client chose cheapest market
   price on purpose). Fix pricing before real scale.
4. Refund of over-billed cache for 29 events (~Rp273) never created.
5. 64 legacy `usage_events` rows have `client_ip = NULL`.
6. Mini App public URL is an ephemeral `trycloudflare` tunnel; set `AETHINK_MINIAPP_URL` to a
   real domain (or mount the SPA behind the gateway) before production.
7. Bansos (free shared key) program exists in the admin API but no active campaign is shown in
   the bot — the bot says so instead of inventing a promo.

## 10. Conventions the client enforces (do not regress)

- Indonesian UI copy, `[GANTENG]` operator persona in chat replies.
- Never show real credentials in docs/screens/chat; mask `Bearer ***` / `sk-•••`.
- Don't restructure the frontend while working on the backend.
- Don't touch the landing page unless the task is the landing page.
- All bot features must be buttons; every transition edits the same message.
- Buyer login must stay Telegram-only; purchases from the web require a linked Telegram account.
- Every claim ships with reproducible evidence (status code, byte count, command output).
