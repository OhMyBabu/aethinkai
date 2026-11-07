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

**Add a model price** → insert into `model_prices` with BOTH ids: `model_id` = the real upstream
route (`<provider>/<model>`, e.g. `mr/glm-5.3-flash`) and `public_id` = the customer-facing slug
(`glm-5.3-flash`), plus `provider_label`/`display_name`. Then set `active`. `/api/models`, `/v1/models`,
the bot Models panel and the Mini App pick it up automatically (cached 5 min in the bot). A row whose
`model_id` is not in the upstream catalogue is skipped from the public list on purpose, and a row with
no price is un-buyable — so verify with `curl -s localhost:8080/api/models | jq '.count'` after insert.

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

**Audit prices** → `./.venv/bin/python scripts/price_audit.py --json audit.json`. It prints, per model, the
USD/1M ceiling (`price_idr / USD_IDR` — the upstream cost at which that model stops making money), the
out/in ratio, how many upstream routes exist and any `:free` route. Use the ceiling when the relay's price
card is unreachable; deliver `audit/PRICING-AUDIT.md` with a market-reference column that names source and
access date, never a single invented "modal".

**Activate the bot** → the token must exist in TWO files: `BOT_TOKEN` in `/root/.secrets/aethink-bot.env`
(the bot process) and `AETHINK_BOT_TOKEN` in `/root/.secrets/aethink-db.env` (the gateway verifying Mini App
`initData`). Put it in the bot env only and the bot answers Telegram fine while every Mini App session dies
on `401 bad_init_data`. Then set `PORTAL_URL` and `AETHINK_MINIAPP_URL` to the HTTPS origin, restart both,
and prove it with `getMe`, `getWebhookInfo` (`url: ''`, `pending_update_count: 0` = long polling healthy),
the `[bot] online as @… test_mode=False` log line, and a signed-`initData` probe (below).

## 5. Pitfalls seen in production

- **Edge headers and app headers duplicate with different values.** nginx sets
  `X-Frame-Options: SAMEORIGIN`, the FastAPI middleware set `DENY`; proxied responses carried
  both and browsers pick one. nginx also DROPS the server-level `add_header` set inside any
  `location` that declares its own, so `/api` silently lost XFO/CSP. Rule: nginx owns
  HSTS/XFO/Referrer/Permissions/CSP on every location (re-declare per location), the app sets
  only `X-Content-Type-Options` + API `Cache-Control`.
- **A hardening pass must be measured, not asserted.** `curl` the endpoints after each change:
  secret paths `/.git/config`, `/.env`, `/backup.sql` → 403; `/docs` → 404 at the edge AND on
  :8080; burst `/api/auth/login` → 429 after the limit; forged `alg=none` JWT → 401;
  `DELETE /api/models` → 405. `scripts/healthcheck.sh` folds services, TLS days, ufw, fail2ban
  bans, disk and the ledger invariant into one verdict.
- **SSH hardening without a key locks the operator out.** `PermitRootLogin prohibit-password`
  with an empty `authorized_keys` ends the session for good. Keep password auth, add
  `MaxAuthTries 3` + fail2ban, and only flip to key-only after the operator's public key is
  installed and tested from a second session.
- **fail2ban `backend = systemd` in `[DEFAULT]` kills the log-file jails.** With it, jails that
  declare `logpath` never start (`UnknownJailException`). Set `backend = auto` in `[DEFAULT]`
  and `backend = systemd` only on `[sshd]`.
- **A test that reuses a fixed Telegram id is not idempotent.** The buyer wallet is cumulative,
  so `saldo Rp5.000` passes once and fails on every rerun; mint a fresh `tg_id` per run.

- **A fresh clone cannot build or run: check for missing files first.** `gateway/requirements.txt`,
  `bot/requirements.txt`, `src/data/store.tsx` and `src/data/fixtures.ts` were referenced but absent —
  twelve components import `useStore` and `StoreProvider`, so `tsc -b` fails with "Cannot find module
  '@/data/store'" and the SPA never builds. Run `tsc -b` and a bare `python -c 'import app.main'` before
  trusting the handoff note.
- **`UPSTREAM_KEY` is promised by the docs and ignored by the client.** `app/upstream.py` only sent
  `x-9r-peer-token` (loopback). A remote relay answers `401 API key required` — send
  `Authorization: Bearer $UPSTREAM_KEY` when it is set, keep the peer header for a local 9Router, and
  read `UPSTREAM_BASE_URL` (the doc example's `UPSTREAM_BASE` name is not what `config.py` reads).
- **`upstream.list_models()` returns ~1.2k models in ~7 s, and every panel calls it.** Without a cache
  the admin Overview waits 7 s before it can paint and reads as "dashboard broken"; wrap it in a
  short TTL cache (`UPSTREAM_MODELS_TTL`, 60 s) — `/api/admin/models` drops to 40 ms.
- **Model ids are `<provider>/<model>` now, not `mk/...`.** Any `regexp_replace(model_id, '^mk/', '')`
  either leaks `mr/claude-fable-5` to the buyer or fails a per-model assertion — join `model_prices`
  and return `coalesce(public_id, split_part(model_id,'/',2))` instead.
- **`nginx` cannot serve `root /root/...`** (home dir is `drwx------`, workers run as `www-data` →
  403/404 with an empty error log). Build to `/var/www/aethink` and point the vhost there; `deploy.sh`
  does the rsync + reload.
- **Seed a balance and you must seed its ledger row.** The admin summary reports `ledger_diff_micro`,
  and every SQL-seeded wallet without an `opening` entry makes it non-zero from day one — write the
  `ledger_entries` row in the same pass (`kind='opening'`, `balance_after` = new balance).
- **Test files carry stale operator credentials.** `tests/e2e_access.py` hardcoded the previous box's
  admin password and died with `401` on a fresh install; read `AETHINK_ADMIN_PASSWORD` or parse
  `gateway/.admin` (written by `seed_admin.py`) instead, and never commit a real password.
- **One slow or dead endpoint blanks a whole dashboard, so fan out with `settle()`.** `src/lib/async.ts`
  exports `settle(promise)` / `failedCount(values)`; every dashboard effect does
  `Promise.all([settle(a()), settle(b())] as const)` and applies each result behind `if (value)`, plus a
  visible "N endpoint gagal dimuat" banner. Plain `Promise.all` without `.catch` leaves the page on the
  loading state or on zeros, which reads as "no traffic" instead of "the call failed".
- **A KPI card frozen at 0 while its hint shows the real number is the count-up hook, not the data.**
  `useCountUp` must snap to the target when the tab is hidden / `prefers-reduced-motion` / no rAF, and
  carry a `setTimeout(target, span + 150)` safety net; a tween that only advances on
  `requestAnimationFrame` never finishes in a backgrounded tab or a headless check.

- **After `certbot --redirect`, a smoke test against `http://127.0.0.1` proves nothing.** Port 80 answers
  `301` only, and a probe with a mismatched `Host` gets nginx's default 404 — `deploy.sh` printed
  `models ? model`. Point the smoke at the HTTPS origin (`AETHINK_ORIGIN`, default
  `https://router.aethink.ai.id`) and keep `curl --retry 3 --retry-connrefused` plus a JSON `try/except`,
  because the first few seconds after `systemctl restart` legitimately return an empty body.
- **`margin 100%` on every request means cost never landed, not that the product is free to run.**
  `usage_events.cost_usd` stays 0 while the relay price card answers `401` and its `usageHistory` SQLite is
  on another box. `/api/admin/summary` now ships `cost_known` / `cost_tracked_requests` and returns
  `margin_pct = null` in that state; the Overview renders "modal belum tercatat". Do not remove that guard
  to make the dashboard look complete.
- **A normalized `public_id` join is the only place a customer may see a model name.** Any portal query
  that still does `regexp_replace(model_id, '^mk/', '')` leaks the live route prefix (`mr/…`, `cn/…`) and
  breaks per-model assertions in `tests/e2e_access.py`. Return
  `coalesce(mp.public_id, split_part(model_id, '/', 2))` via `LEFT JOIN model_prices`.
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
2. Restore secrets into `/root/.secrets/aethink-db.env` (mode 600) — `config.py` loads that file itself,
   so seed scripts, tests and uvicorn all get the env without a shell wrapper. Fill `UPSTREAM_BASE_URL`
   and, for a remote relay, `UPSTREAM_KEY`.
3. Seed: `scripts/seed_admin.py` (writes `gateway/.admin`, mode 600) then `scripts/seed_dev.py` for a
   local key. Prices next (`/admin/models` or the insert above) — an empty `model_prices` makes the whole
   product look broken.
4. Units ship in `deploy/systemd/` (`aethink-gateway`, `aethink-bot` with `BOT_ENV_FILE`), vhost in
   `deploy/nginx/aethink.conf`. Build to `/var/www/aethink` (nginx cannot read `/root`), then
   `nginx -t && systemctl reload nginx`.
5. `./deploy.sh` does backend + frontend + smoke; use `./deploy.sh backend|frontend` for one side.
6. TLS + domain: `certbot --nginx -d <domain> --redirect`, then set `AETHINK_MINIAPP_URL` and the bot's
   `PORTAL_URL` to the HTTPS origin and restart both — a `web_app` button refuses an HTTP origin.
7. Run the three e2e suites against the new box before announcing (35/35, 32/32, 12/12).
8. Rotate `BOT_TOKEN`, `JWT_SECRET`, `INTERNAL_SECRET`; re-issue buyer keys if leaked.
