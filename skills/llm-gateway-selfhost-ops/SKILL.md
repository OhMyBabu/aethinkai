---
name: llm-gateway-selfhost-ops
description: Use when self-hosting an LLM gateway or billing in front.
version: 1.0.0
author: Ganteng
license: MIT
metadata:
  hermes:
    tags: [gateway, selfhost, 9router, llm, billing, pm2]
    related_skills: [llm-gateway-masking-audit, prd-to-frontend-app, linux-server-ops]
---

# Self-hosted LLM gateway: run, secure, integrate

Class of work: standing up a model gateway on the box (9Router, one-api/new-api, LiteLLM),
getting its dashboard reachable from the LAN, then wiring your own product gateway in front of it
with auth, metering and billing. The upstream gateway owns provider credentials and routing;
your gateway owns users, keys, money.

## When to Use

- "Install 9Router / one-api / LiteLLM here and I'll add providers in the dashboard."
- "Dashboard should be reachable from my LAN", "can't log in from another machine".
- Building a product API (`/v1/chat/completions`) on top of a local gateway, with credits/billing.
- Reconciling billed usage against what the upstream gateway reports.

## Procedure

1. **Read the package's real runtime shape before installing.** An npm CLI can be a thin wrapper over a
   prebuilt app, not a source tree. Inspect first:

   ```bash
   npm view <pkg> bin dependencies --json
   npm pack <pkg> --silent && tar -tzf <pkg>-*.tgz | grep -E '\.next|dist/|standalone' | head
   ```

   A shipped `.next-cli-build`-style dot-directory means the app is already built: the server entrypoint
   (`app/server.js`, `custom-server.js`) is the thing to run. Only build from source when the tarball
   actually contains route sources.
2. **Never rely on the CLI's daemon/tray mode on a headless box.** Run the server entrypoint directly under
   a process manager with explicit bind env, then prove the listener exists:

   ```bash
   cd <pkg>/app
   PORT=20128 HOSTNAME=0.0.0.0 NODE_ENV=production pm2 start server.js --name 9router --cwd "$PWD"
   ss -ltnp | grep 20128 ; curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1:20128/api/health
   pm2 save && pm2 startup systemd -u root --hp /root   # survives reboot
   ```
3. **Bootstrap dashboard auth from the code path, not by guessing the password.** When remote login is
   refused, read the login route/handler for its guard: gateways commonly block the *default* password on
   non-loopback requests and accept an env-provided initial password instead.

   ```bash
   export INITIAL_PASSWORD='<new>'
   pm2 restart <name> --update-env && pm2 save
   curl -s -X POST http://<lan-ip>:20128/api/auth/login -H 'Content-Type: application/json' \
     -d '{"password":"<new>"}'   # expect {"success":true,"mustChangePassword":false}
   ```

   `307` on `/dashboard` is the guard working; `200` with a cookie is the fix landing.
4. **Find out how the upstream authenticates before hunting a key.** Inspect the store: if API keys are
   persisted masked (`sk-abc...1234`), the plaintext is intentionally unrecoverable and key auth cannot be
   replayed. Use the gateway's loopback/peer credential instead, and confirm with a real completion (step 5).
   Details and exact headers for 9Router: `references/9router.md`.
5. **Verify with inference, not `/models`.** Auth is evaluated before billing and upstream health, so a 200
   on the model list proves nothing. One 8-token chat completion that returns text and a `usage` block is
   the only accepted proof.
6. **Inventory what metering and pricing need** from the upstream's own API before designing your schema:
   model catalogue, per-model price card, aggregated usage history. Cache the price card; do not re-derive
   prices from provider docs.
7. **Put your gateway in front and keep the upstream on loopback.** Client authenticates to you
   (`sk-...` hashed at rest), you attach upstream credentials server-side, strip client headers, forward,
   and stream the upstream body back unchanged. Upstream port never faces the internet; the LAN exposure
   that remains is dashboard-only.
8. **Meter on the way through, never after the fact.** Write one `usage_events` row per request
   (`tokens_in`, `tokens_out`, `cost`, `latency`, `status`, `request_id`) plus a ledger entry when money
   moves; reconcile nightly against the upstream's aggregated usage and alert on >1% drift.
9. **Serve the browser frontend same-origin through a proxy, not a hardcoded host.** Point the dev/preview
   server at the gateway so the app calls `/api/*` and `/v1/*` relatively:

   ```ts
   // vite.config.ts — server AND preview need it, they are separate configs
   proxy: { "/api": { target: "http://127.0.0.1:8080" }, "/v1": { target: "http://127.0.0.1:8080" } }
   ```

   Then the page works identically on LAN, on a tunnel, and on a future domain with no rebuild. Rebuild the
   frontend after editing the proxy block: a running `preview`/`dev` process serves the previous bundle and
   the new routes silently 404.
10. **Wire auth to the gateway before polishing screens.** Replace any client-side credential check with a
   real `POST /api/auth/login` that returns a JWT, keep the token in storage, and have the role guard read
   that session. A local-store login makes every admin screen look live while editing nothing. Expect the
   gateway's role enum to differ from the UI's (`customer` vs `user`): map it explicitly, and treat the token
   as the authority while any fixture user only supplies chrome (name, avatar).
11. **Expose the customer catalogue from the admin table, not from fixtures.** One public endpoint
   (`GET /api/models`, no key) reading `model_prices WHERE active AND priced`, joined with upstream metadata
   at read time; the workspace page and any landing catalogue render that. Ship the projection in the same pass
   as the admin screen, and prove it by disabling one priced model and recounting both views. Details:
   `references/billing-design.md` (Customer catalogue).
12. **Layer your own brand over the upstream model namespace.** A resale gateway sells *its* catalogue, not
   the router's. Keep two ids per model in the price table — `model_id` (upstream route such as
   `mk/claude-fable-5`, internal only) and `public_id` (customer-facing slug such as `claude-fable-5`) — plus a
   `provider_label` the admin sets. Every public surface (`/api/models`, `/v1/models` with
   `owned_by: "aethink"`, the landing catalogue) emits `public_id`; the chat handler resolves slug → route and
   rewrites `payload["model"]` before calling upstream. Accept the raw route as an alias for compatibility but
   never advertise it, and skip priced rows whose route is missing from the upstream catalogue so a dead row
   cannot be bought.
13. **Finish a wiring pass by sweeping fixtures out of shared helpers, layout chrome and logs.** The page
   body is the easy part; four other places keep demo data and look healthy:

   - **Chart/series helpers** carry a demo time anchor (`now = new Date("2026-11-04T09:00:00+07:00")`). Live
     events fall outside that window, so tables show rows while every KPI and chart reads 0. Grep the shared
     `lib/` for hardcoded dates and default `now` to `new Date()`.
   - **Layout chrome** (sidebar credit balance, plan badge, user name) reads the client store. Fetch
     `/api/me` in the shell and pass the value down — otherwise the dashboard says Rp24.954 while the sidebar
     still says the seeded fixture number.
   - **Usage/log rows** store the upstream route id, so they leak `mk/...` even when the catalogue is clean.
     Join `model_prices` in the requests endpoints and return `display_name`, then merge row names with the
     catalogue map in the view.
   - **Load fans out with `Promise.all`**, so one 404 (an endpoint added but the gateway not restarted)
     rejects the whole batch and the screen renders zeros instead of an error. Restart and `curl` every new
     endpoint before wiring it, and surface per-call failures rather than defaulting to 0.
14. **Sweep the public marketing surface against the gateway, not just the dashboard.** The landing page is
   routinely the last fixture island: a hardcoded catalogue (dead vendors still advertised, live ones
   missing), prices that disagree with the billing table, uptime/latency badges invented in JSX, docs
   snippets pointing at a domain that does not resolve, and an endpoint list the gateway answers `404` for.
   Audit claim-by-claim before calling the product wired:

   ```bash
   curl -s $B/api/models | jq -r '.data[] | "\(.id) \(.pricing_idr_per_1m.input)/\(.pricing_idr_per_1m.output)"'
   for p in /v1/chat/completions /v1/models /v1/embeddings /v1/usage; do
     printf '%s ' "$p"; curl -s -o /dev/null -w '%{http_code}\n' -X POST "$B$p"; done
   ```

   Then replace the fixture store with one hook that fetches the public endpoints (~30 s poll), maps API rows
   to the view model in a single function, and falls back to fixtures only when the fetch fails, so the page
   never blanks. Every number on it must be computed server-side and reachable by `curl`; a hardcoded
   `99.98% uptime`, `<200 ms` or "Rp25.000 free credits" (when signup grants nothing) becomes a support
   ticket the first time a customer measures it.

## Always-on rules

- **The upstream gateway is infrastructure, not a public API.** Bind it where it must be reachable
  (loopback or LAN for the dashboard), and let only your gateway talk to `/v1`.
- **Provider credentials never leave the server.** No upstream key in frontend code, no key echoed in chat,
  no key in a report — store in env or a `chmod 600` file and reference it by name.
- **Platform test accounts are the opposite: hand them over in the reply.** When the operator asks to test the
  admin and customer roles, print email, password, role and landing route inline. Answering with a path
  (`cat .admin`) or a masked hint blocks the very test you were asked to enable; upstream provider keys stay
  secret, your own seeded accounts do not.
- **Prepaid beats postpaid for a resale gateway.** Hold an estimate, settle the actual, refuse at zero
  balance. Postpaid accrues uncollectable debt the moment a key leaks.
- **Every claim of "running" carries a listener check and one real request.** "Ready in 0ms" is a cached
  build banner, not a bound port.
- **Re-running the install must not drop auth.** Re-export the auth env before `pm2 delete`/re-create; a
  fresh process without the env falls back to the default password and remote login breaks again.
- **Wallet balance must equal Σ ledger entries, always.** Every credit and every charge writes its ledger row
  in the same transaction as the balance update; an admin summary exposes `ledger_diff_micro` and
  `negative_wallets` so drift is one number. A balance seeded by SQL needs a matching `opening` row or the
  invariant is false from the first day.
- **When the UI is right and the data is wrong, fix the projection in the backend.** If the operator says the
  frontend already looks correct, do not restructure components — add the missing field or resolution on the
  server (slug, provider label, price) and leave the view untouched.
- **A gateway needs the account and money verbs, not just inference.** Signup, admin-created users, manual
  top-up, ledger read, and a hold-expiry janitor are product surface: without them keys have no owner and
  balances have no history, and the billing table is decorative.
- **Apply the option the operator picked, exactly.** When you present a price sheet or a design fork and the
  operator answers "use the cheapest like you said", write those numbers in — do not substitute the
  safer-looking alternative (cost-plus, a smaller jump) because you judged it better. Presenting option A,
  then shipping B, forces the same instruction twice and reads as ignoring the order. If B is genuinely
  dangerous (sub-cost pricing), ship A and state the consequence in one line: revenue vs upstream cost for
  existing traffic, and the fix (cheaper route or raise price).
- **Never invent the operator's cost basis — derive it or say it is unknown.** Cost comes from the upstream
  usage ledger (`usageHistory.cost` × FX), not from a guess dressed up as "their modal"; when the operator
  says the prices were arbitrary, present the derived cost, the current sell price and the cheapest market
  reference side by side, and let the numbers choose. If derived cost sits above the cheapest market route,
  say plainly that matching the market is a loss and offer the real fork: price at ≥1.3× cost, or add a
  cheaper upstream route.

## Billing design

Credits, rounding, holds, payment intents, idempotent webhooks, reconciliation and the milestone split:
`references/billing-design.md`. Read it before writing the balance schema — the micro-unit decision and
hold/settle ordering are the two choices that are expensive to change later.

## Buyer access without passwords

Reselling through a chat bot means the buyer never signs up on the web: the bot takes payment, your
gateway mints the key, and the buyer proves identity by *pasting that key*.

1. **Provisioning is a server-to-server call, signed over the raw body.** `POST /api/internal/grant`
   with `X-Timestamp` (±300 s) and `X-Signature = HMAC-SHA256(secret, ts + "." + raw_body)`. Verify the
   signature **before** parsing JSON, otherwise an anonymous caller learns the payload schema from a 422.
   Idempotency key is the order id: a retried webhook must return `already_granted: true` with no new key
   and no second ledger credit (`orders.status='granted'` inside the same transaction, `FOR UPDATE`).
2. **The key is exchanged for a read-only session, never stored in the dashboard.** `POST /api/portal/session`
   returns a JWT (`scope=read`, `purpose=portal`, 12 h, `aud=aethink-portal`). Portal endpoints re-read the
   key row on every request, so revocation and rotation take effect instantly. Keep the raw key out of
   `localStorage`; `sessionStorage` dies with the tab.
3. **Rate limits are two different mechanisms.** Per-key RPM on `/v1` (sliding 60 s window, store `rpm_limit`
   per key, return `X-RateLimit-*` and `429 rate_limited` + `Retry-After`). Credential guessing needs
   escalating lockout, and its keys must be **scoped per (identity, ip)** — a global per-email or per-prefix
   counter lets one attacker lock a paying customer (or the admin) out.
4. **Admin visibility is three lists, not one.** Buyers (bot identity, balance, 30-day spend), keys (prefix,
   owner, RPM, spend, last used, suspend/rotate), orders (bot order ↔ granted key). Plus a failures table fed
   by every rejected portal/admin login — that is how you notice enumeration.

### Telegram store bot

- **Order first, key later.** The bot creates a `pending` order (`POST /api/internal/order`) with the
  amount, credits and RPM; it never re-sends those numbers when granting. Granting by order id
  (`POST /api/internal/order/{id}/grant`) reads them from the row and only flips `status='granted'` once —
  a double tap on the inline button cannot mint two keys.
- **Bot storage is an order id, nothing else.** Buyer identity is the Telegram id; the key is hashed in
  Postgres and delivered exactly once in chat. A **Rotate key** button (with a confirm step) revokes every
  live key of that buyer and returns a fresh one, rate-limited per user.
- **Signed GETs need a canonical string, not just the body.** For endpoints with no body sign
  `f"{ts}.{resource}"` (e.g. `{ts}.buyer:12345`) and verify the same server-side; keep the POST scheme
  (`{ts}.` + raw body) unchanged so one secret serves both.
- **One panel, edited in place — a store bot is an app, not a chat log.** Every navigation and state
  change must call `editMessageText` on the same message; `sendMessage` is only for cross-chat
  notifications (order alert to the admin) and for a buyer with no panel yet. To make the receipt land in
  the same bubble the invoice occupied, persist the message id at order creation
  (`orders.telegram_msg_id`) and have the grant path edit that message. Rotate/confirm flows edit the
  panel too — never “key lama dicabut” followed by a fresh key message. Verify with a stubbed harness by
  counting calls: a full purchase→grant→rotate pass should be `sends == 0` inside the buyer chat.
  `editMessageText` returns `400 message is not modified` when a user taps the same button twice — that is
  a no-op, not a failure; swallow it.
- **Sell from the web without inventing passwords: Telegram is the identity provider.** Buyers keep
  zero credentials. `POST /api/portal/telegram/start` mints a one-time code and returns
  `https://t.me/<bot>?start=link_<code>`; the bot handles `/start link_…` by calling a signed
  `POST /api/internal/link/confirm`; the browser polls `GET /api/portal/telegram/status?code=` every
  2 s and receives a read-only JWT for `sub=buyer:<id>`. Mark the code `consumed_at` on first issue —
  otherwise the code is a bearer token for anyone who sees it. Keep admin email+password on a separate
  route (`/admin/login`); point `/signup` at `/login` so the old form cannot be reached.
  Orders created from the web need only that session (`POST /api/portal/order`), so the purchase is
  attributable to a real Telegram account without a second login.
- **Two session shapes in one portal dependency.** `sub=buyer:<id>` may own zero keys (fresh buyer),
  `sub=<key_id>` is the legacy key session. Any endpoint that truly needs a key (rotate) must answer
  `409 no_key` rather than crashing on a NULL row.
- **Sum balances per DISTINCT user_id, never per key.** Multiple keys of one buyer share a single
  `balances` row, so `JOIN balances ON balances.user_id = k.user_id` multiplies the displayed balance
  by the key count.
- **Telegram Mini App: verify initData server-side, and serve it from the same origin as the API.**
  `secret = HMAC_SHA256(key="WebAppData", msg=bot_token)`, then compare `HMAC_SHA256(secret,
  sorted key=value lines without hash)` against `hash`, and reject `auth_date` older than 24 h. Exchange it
  for the same read-only buyer JWT the web portal uses — one session shape for both surfaces. Never trust
  `initDataUnsafe` (client-controlled). A Mini App opened from a bot button needs an HTTPS URL, so expose
  the current public URL from the gateway (env override, else scrape the tunnel log with a short cache)
  and emit `{"web_app": {"url": …}}` inline buttons; fall back to a plain `url` button when no HTTPS
  origin exists.
- **A bot cannot DM anyone who never pressed Start.** `sendMessage` returns `400 Bad Request: chat not
  found` and the onboarding message silently dies — that is not a token bug. Verify delivery by reading
  the returned `message_id`, and tell the operator to `/start` the bot once.
- **Parse mode HTML, escape everything user-provided.** `html.escape()` on names/usernames; use `<pre>` for
  curl snippets and `<code>` for keys so Telegram does not mangle underscores in `sk-aeth_…`.
- **Load the env file inside the process.** pm2 does not read `.env`; a small `_load_env()` at import
  (key=value, `os.environ.setdefault`) keeps secrets at `chmod 600` and removes the need for shell wrappers.
- **The storefront is a menu, not a command line.** Every feature gets an inline button; free-text and
  commands are only shortcuts that render the same view. Namespace callbacks (`m:home|buy|bal|keys|portal|help`
  for navigation, `buy:<sku>`, `paid:<order>`, `g:<order>`, `rot:ask|yes`) and put a `⬅️` back row on every
  screen. Call `deleteMyCommands` so Telegram shows no command list at all, and turn any unrecognised text
  into the main menu instead of "unknown command". Destructive actions (rotate, cancel) get a confirm screen
  before the write; the panel that only admins may see is a conditional extra row on the same menu, not a
  separate chat surface.
- **Order ids need per-attempt entropy, not just uid+epoch.** `f"TG{uid}-{int(time.time())}"` collides when
  the same buyer taps two packages inside one second; `ON CONFLICT (id) DO NOTHING` then returns the earlier
  pending order and the buyer gets the wrong package. Add a short random or sku suffix
  (`TG{uid}-{epoch}-{secrets.token_hex(2)}`).
- **Let the operator test the loop alone.** When the buyer is also an admin, send the admin notification to
  that same chat as well as the buyer invoice — otherwise the only person testing cannot see the grant
  button they just built, and every check needs a second Telegram account. Ship a `STORE_TEST_MODE` env that
  auto-settles on package tap (default off, never left on in production) so the buy→key→portal path can be
  proven before a payment provider exists.

- **A shadowed router path also breaks POST bodies silently.** Registering `/api/internal/order/{id}/grant`
  in the same module as `/api/internal/order` is fine, but two routers defining `/grant` will resolve to
  whichever was included first — the second handler simply never runs. Grep the route inventory
  (`grep -n '^@.*\.post\|^@.*\.get' app/*.py`) after adding internal endpoints, before wiring a bot to them.
- **Provisioning endpoints must be idempotent at the *order* level, not the key level.** Keep
  `orders.status` as the single source of truth: `pending → granted`, key id stored on the row. Anything
  that mints before checking status produces duplicate credit on a retried webhook.

## Pitfalls

- **Restart by listening PID, then prove the new code is serving.** `pkill -f "uvicorn app.main:app"` matches
  the shell that launched it, returns SIGTERM to your own command, and can leave the old worker bound — the
  port answers on stale code and every later test validates the previous build. Resolve the pid from
  `ss -ltnp | grep :<port>`, kill that pid, start the new process, then assert a changed response (new field,
  new endpoint) rather than trusting `/health`. A dev/preview proxy that logs `ECONNREFUSED` on `/v1` during
  that window is expected noise — re-test with one proxied request instead of debugging the proxy.
- **Never rebuild a module by slicing at a marker and appending.** `content = src[:index_of("@router.post(...)")]
  + new_block` silently deletes every route defined *after* that marker — the file still imports, the server
  still boots, and the lost endpoints only surface as `{"detail":"Not Found"}` from the UI, which reads like a
  routing bug rather than a missing file section. Prefer a targeted patch; when the edit is genuinely
  structural, append the new block instead of re-slicing, and assert the inventory afterwards
  (`grep -n '^@router\.\|^def \|^class ' app/modules.py` and compare the count to before). A green
  `python -c "import ast; ast.parse(...)"` proves syntax only, never that the routes survived.
- **Drop knobs the data model no longer uses.** When a program becomes one shared key, a per-user limit field
  left in the admin form is worse than dead code: it sets an expectation the backend no longer honours. Remove
  the field and its label from the payload path in the same pass you change the semantics, and rewrite any
  subtitle that still says `limit N/user`.
- **A file rewritten through tool output can be silently corrupted.** Redaction and pagination markers
  (`|` → `***`, line-number prefixes) survive a round-trip and produce syntax errors like `str *** None`.
  After any read-modify-write that passed through displayed output, run
  `python -c "import ast; [ast.parse(open(f).read()) for f in files]"`, and prefer a targeted patch over a
  full-file rewrite.
- **The upstream price card is often auth-gated, but its usage ledger is local.** A loopback peer token that
  works for `/v1` returns `401` on `/api/pricing` in 9Router. Read the gateway's own SQLite
  `usageHistory`: `model`, `promptTokens`, `completionTokens`, `cost`) instead. Do **not** join on exact
  token counts: the ledger stores `promptTokens` *without* the cached prefix while the provider reports
  `prompt_tokens` *with* it, so every cached call fails an exact match and silently falls through. Match by
  model inside a short window, accept rows whose completion tokens are within ±2, and take the smallest
  prompt delta (score history rows, never `LIMIT 1`). Only when nothing matches use a per-model USD/1M rate
  **derived from that same ledger** (Σcost / Σtokens), not a blended figure computed another way — a bad
  blended rate turned Rp1 008 of revenue into a "Rp28 651 cost" and a −3 019% margin. Sanity-check the total
  against `SELECT sum(cost) FROM usageHistory` for the same window before believing any margin number.
  Repair already-written rows the same way: nearest ledger timestamp (± a few seconds, same model) wins,
  otherwise scale by the model's observed USD/token. Broker: `references/billing-design.md`
  (Upstream cost reconciliation).
- **A CLI that exits 0 with "running in system tray" started nothing.** Tray/daemon mode needs a display;
  `--skip-update` plus a non-TTY stdin is enough to flip some CLIs into tray mode, which then dies silently.
  Run the server entrypoint under pm2 instead, and always confirm with `ss -ltnp`.
- **`npm run build` fails with "Couldn't find any `pages` or `app` directory" on a shipped prebuilt app.**
  The published tarball excludes route sources, so the build output (a dot-directory) is the artifact. Do
  not rebuild; run the provided server entrypoint, and delete any stray `.next` your failed build created so
  it cannot shadow the real dist dir.
- **"Default password must be changed before remote access" is a guard, not a wrong password.** The handler
  compares the submitted password to `INITIAL_PASSWORD || default` and only allows the default from
  loopback. Set the env, restart, retest — don't reset the DB.
- **Masked keys in the datastore are a design choice, not corruption.** Editing the row or brute-forcing the
  mask format fails; the auth path compares the full key. Switch to peer/loopback auth (or create a key
  through the UI and capture it at creation, where it is shown once).
- **`pm2 delete` takes the environment with it.** Re-export `PORT`, `HOSTNAME`, `NODE_ENV`, the initial
  password and the peer token before starting the app again, then `pm2 save` so a reboot resurrects a
  working instance.
- **A gateway can serve 200 on `/api/health` while inference is broken.** Health checks liveness only; the
  provider connection may be inactive or the key gated. Keep one smoke completion in your runbook.
- **Verify LAN reachability from the LAN IP, not localhost.** `curl http://127.0.0.1:PORT` passes even when
  the bind is loopback-only or the interface is NAT'ed; hitting `http://<lan-ip>:PORT` is what the user will
  actually do.
- **Keys created through the API may come back masked even in the creation response.** Only the dashboard's
  one-time reveal (or the local peer token) is a usable credential; a masked id that round-trips through
  `/v1/models` will 401 on `/v1/chat/completions`.
- **Pass upstream error bodies through unchanged.** Collapsing a 4xx/5xx into `{}` hides the only useful
  signal — a frozen provider account, a dead key, a model that no longer exists all arrive as a provider
  message inside the upstream error. Parse the body even when `status >= 400` and return it
  (`{"error":{"message":"..."}}`) so the operator sees the real cause from the client side.
- **An upstream 5xx is usually the provider, not your proxy.** Replay the same request straight against the
  upstream `/v1` with its peer credential before touching gateway code; a provider-side 403 wrapped as 503
  with a cooldown timer is a billing/account state, not a bug you can fix in the proxy.
- **Quick-tunnel hostnames are disposable, and the URL lives in the process's stderr log.**
  `trycloudflare.com` issues a new subdomain per process and the old one dies permanently (Cloudflare
  1033/530). Run `cloudflared` under pm2 so it restarts, then read the current URL from the tunnel's *error*
  log — quick tunnels print the hostname to stderr, so the pm2 out log is usually empty:

  ```bash
  grep -o 'https://[a-z0-9-]*\.trycloudflare\.com' /root/.pm2/logs/<tunnel>-error.log | tail -1
  ```

  Only a named tunnel + DNS record gives a stable hostname; persisting the URL to a file you control is the
  fallback when the process is not under pm2.
- **A tunnel that answers `000`/`530` is usually innocent: check the chain downstream first.**
  `curl -o /dev/null -w '%{http_code}' https://<tunnel>/` returning `000` while `pm2 list` shows the tunnel
  `online` means cloudflared is up and has nothing to serve. Walk the three links before restarting anything:
  `ss -ltnp | grep -E ':(4173|8080)'` → `curl 127.0.0.1:4173/` → `curl 127.0.0.1:8080/health`. In practice the
  preview server and the gateway both die over a long session, so the fix is starting them, not touching
  cloudflared; only a fresh URL is needed when the hostname itself stopped resolving.
- **Price/toggle edits from a table need per-row state, not one shared draft map.** A single
  `drafts[modelId]` object owned by the page, coupled to a refetch after save, swallows keystrokes and makes a
  toggle snap back because the save reads the pre-click closure. Give each row an explicit Edit mode with its
  own state and one Save that writes price **and** active together — see `references/billing-design.md`
  (Admin pricing surface).
- **"Is the database safe?" is answered with bind and auth evidence, not reassurance.** Show
  `ss -ltnp | grep 5432` bound to `127.0.0.1`, non-`trust` `pg_hba` lines (`peer` local,
  `scram-sha-256` loopback), a non-superuser app role, an env-file password at `chmod 600`, parameterised
  queries, and a `CHECK (balance_micro >= 0)` on the balance column. Exposure comes from an open port, a weak
  or default password, string-concatenated SQL, and unencrypted dumps — name the five and close them.
- **A customer-facing model list fed by fixtures contradicts the admin table within days.** The admin screen
  can look perfect while the customer page still renders a hardcoded catalogue; both must read the same
  `model_prices` rows, and a catalogue that ignores `active`/price also advertises models the data plane
  rejects with `403 model_not_allowed`. Project it before calling the admin work done.
- **A model with no price row must be rejected, not served free.** Return `403 model_not_allowed` when the
  price lookup yields zero — otherwise every newly added upstream model is an unbilled hole.
- **A live data plane with demo-derived helpers still reads empty.** Wiring the fetch is half the job: chart
  binning, date-range tabs and "today" labels often come from a shared helper seeded with a fixture date, so
  real events land outside the window and every number is 0 while the table below is full. Fix the anchor in
  the helper, not the page.
- **A dashboard that renders 0 is usually an un-restarted endpoint, not an empty database.** When a view
  fetches several endpoints in parallel, one `404` collapses the batch and the UI silently shows zeros.
  Probe each endpoint with `curl` after every restart, and treat a new route as unfinished until it answers.
- **Model badges must resolve per model id, not per provider.** A provider-level fallback paints Claude with
  the DeepSeek mark and nothing looks broken in CI. Import vendor marks (`@lobehub/icons-static-svg`, `?raw`),
  match `modelId` against `/claude|anthropic/`, `/deepseek/`, `/qwen/`, `/glm|zhipu/`, `/kimi/`, `/minimax/`,
  render a neutral letter tile when nothing matches, and use the Zhipu/Z.ai mark for GLM. Verify by reading
  `<svg><title>` text out of the rendered DOM, not by eyeballing the page.

- **"One message produced 4 requests" is a claim about the client, not the gateway — prove it with a 1:1
  join.** Before touching metering code, line up `usage_events` against the upstream's own ledger
  (`usageHistory` in 9Router's SQLite) on timestamp + completion tokens: if every gateway row has a matching
  upstream row with a distinct `request_id`, those were N real upstream calls and the engine billed once
  each. A burst pattern like 2K → 10K → 11K → 2K input tokens with matching growing `cached_tokens` is an
  agent client resending a ~2K system prompt plus history, plus title/summary helper calls per message — a
  plain one-word prompt is ~30 prompt tokens, so token counts alone identify the caller. Log `client_ua`
  and `ip` on `usage_events` so the next burst is attributable in one query instead of an afternoon of
  guessing.
- **Only the cached slice may be priced at the cached rate.** `prompt_tokens` already includes
  `cached_tokens`; charging full input rate for all of `tokens_in` and then adding the cached rate bills the
  cache block twice (a 4 864-token block cost 12.9x the correct charge). Formula and the two-call proof
  probe: `references/billing-design.md` (Cached prompt tokens).
- **Behind a CDN or tunnel the socket IP is the proxy's.** Resolve the caller as
  `CF-Connecting-IP` → `X-Real-IP` → first entry of `X-Forwarded-For` → `request.client.host`, and write
  `client_ip` + `client_ua` onto every usage row at insert time. A quick tunnel makes `request.client.host`
  the local cloudflared socket, so every customer logs as `127.0.0.1`, and there is no retro-fix: upstream
  routers keep no IP ledger (`requestDetails` empty). Render the pre-instrumentation bucket as a labelled
  state (`IP belum tercatat`) instead of a bare `unknown`.
- **Admin monitoring is a hierarchy, not a flat request log.** The question operators actually ask is
  "this key — how many IPs used it, from where, and what in/out did it burn". Answer it with one endpoint that
  returns user → key → provider/model → IP+UA → daily in/out (a handful of `GROUP BY` queries folded in
  Python beats N per-key calls), and give the page a master list plus a detail panel keyed on the selected
  key. Classify the provider from brand tokens in the model id when `provider_label` is NULL, or the column
  reads `—` for every row the admin never renamed. Shape and SQL: `references/aethinkai-gateway.md`
  (Client attribution & key monitor).
- **"No refresh needed" means two transports, not one.** Cloudflare quick tunnels and most CDN/WAF layers
  buffer `text/event-stream`: the SSE route answers `200`, keeps the connection open and delivers nothing, so
  an `EventSource`-only dashboard sits on "connecting" forever while polling-free code looks correct. Ship
  both paths from one client module: `EventSource` + a watchdog (~3.5 s with no `ready` frame) that switches
  to a JSON poll (~2.5 s) carrying the same payload (`{rows, summary, server_time}`), server-side as
  `/api/live/{channel}` plus `/api/live/poll/{channel}?since=<cursor>`. Also set `Cache-Control: no-cache,
  no-transform`, `X-Accel-Buffering: no` and `Content-Encoding: identity` on the stream — they help some
  proxies but do not replace the fallback. Drive the status pill from real transitions
  (`connecting | live | offline`), never from "component mounted".
- **A search/filter input that feeds a live table eats the caret unless it owns its own buffer.** With a
  fully controlled input, every keystroke re-renders the parent (row filter, count-up, live append), and any
  stale `value` written during that render resets the caret to the end — the operator sees the cursor jump
  after one character. Keep a local `useState` buffer, mirror `value` only when an external reset is
  detectably different, and debounce the `onChange` propagation (~140 ms); never put
  `onFocus={e => e.target.select()}` on a text field (reserve select-on-focus for numeric price fields).
  Verify by typing 10 characters with a 50 ms gap and asserting `document.activeElement` focus plus the exact
  final value, not by eyeballing the field.
- **Popup forms lose the caret for a different reason: the modal's focus effect re-runs.** A dialog that
  focuses its first control inside `useEffect(..., [open, onClose])` re-fires on every keystroke whenever the
  page passes an inline `onClose={() => setOpen(false)}` — each render creates a new function identity, the
  effect refocuses the first focusable node (the close button) and the caret leaves the field after one
  character. Keep `onClose` in a ref and depend only on `[open, dismissable]` (drawers: `[open]`); repeat for
  every portal component, and verify by typing ~10 characters into the dialog's first input and asserting
  `document.activeElement === input` plus the exact value.
- **asyncpg returns `jsonb` as a string.** A list column (`models jsonb`) reaches the browser as
  `'["a","b"]'`, so `.map()` throws inside render and the whole page blanks out — with no server error,
  because the response was 200. Decode every jsonb column to a real list in the serializer
  (`json.loads` when `isinstance(value, str)`) before returning it, and re-check every endpoint that writes
  jsonb through a PATCH.
- **A free tier ("bansos") is ONE shared public key per program, not a key per visitor.** The operator's model
  is collective burn: everyone copies the same key, the same grant drains, credit is gone together. Mint one
  key lazily on read (`ensure_program_key(program_id)`: return the live `public_keys` row or create
  `api_keys` + `public_keys.key_plain` in one call), expose it as `shared_key {id, masked, key, created_at,
  last_used_at}` plus `total/used/remaining_micro`, and let the landing panel poll that so the number moves
  for everyone. Do **not** ship a per-visitor mint button: it fragments the shared experience, invites
  unbounded key creation, and needs quota/cap logic nobody asked for. Admin keeps one verb instead —
  `POST /api/admin/bansos/programs/{id}/rotate-key`, which revokes **both** the `api_keys` row (auth) and the
  `public_keys` row (display), then mints a fresh pair; the old key must 401 immediately. Masked display with
  a copy button needs `key_plain`: `api_keys` only stores a hash and can never show the key again.
- **Fallback routes are a chain, and streaming needs the first chunk to decide.** Resolve the ordered
  fallback list for the requested route, then loop candidates treating both an exception and a `5xx` as
  "try the next"; a `for … else` after the loop is what detects that every route failed (otherwise an empty
  body bills zero and reports `ok`). For streaming, pull one chunk from each candidate generator before
  yielding to the client — you cannot retry after bytes are on the wire. Bill at the price of the model the
  customer chose, but compute `cost_usd` from the route that actually served it.
- **A KPI card stuck at 0 while its hint is already correct is the animation, not the data.** When a
  count-up card mounts at 0 and the value arrives later, the tween can stay frozen at its initial frame; the
  summary line under it ("8 models touched") proves the state is right. Remount the card with a `key` tied to
  the value, or drop the tween for async-updating KPIs.
- **A public status strip computed over 24 h reads 0 on a quiet product — widen the window, keep the honest
  number.** Any real deployment has hours with no traffic, and `p95` over an empty window is `0`, which
  renders as "0 ms" and looks broken. Compute `requests_24h` **and** `requests_7d` plus `last_request_at`,
  take p95 over the 7-day window with `latency_ms > 0`, and render `—` when a metric has no samples. Showing
  "0 req / 24h · 89 / 7d" is credible; a fabricated 99.98% is not, and neither is `0 ms`.
- **Adding a vendor to a `Provider` union breaks every `Record<Provider, string>` mark map at compile time.**
  `tsc` fails on `Property 'Anthropic' is missing` in each brand-logo file. Switch those maps to
  `Partial<Record<Provider, string>>`, return `null` when the mark is missing (renderer falls back to the
  neutral tile), and add the new glyph — do not widen the union back or alias the new vendor onto an existing
  logo.
- **Marketing snippets must derive the base URL from the origin serving them.** A hardcoded
  `https://api.<domain>/v1` in the docs panel, terminal preview and curl examples is wrong on every tunnel,
  staging host and pre-DNS deploy, and copy-paste then fails for the customer. Use
  `import.meta.env.VITE_GATEWAY_BASE_URL ?? `${window.location.origin}/v1`` in one module and import it
  everywhere; the same rule kills the "endpoints we plan to build" list — only advertise routes that answer.

- **A second router with the same path prefix is silently shadowed.** Adding `GET /api/admin/keys` in a new
  module while an older admin router already defines it returns the *old* row shape, so the new page throws
  `KeyError: 'rpm_limit'` on data that looks present. Register new admin surface under its own prefix
  (`/api/admin/access/...`) instead of relying on Router include order, and check collisions with
  `grep -rn 'admin/keys' app/` before wiring the client.
- **Error shape: wrap both.** FastAPI serialises `HTTPException(429, {"error": {...}})` as
  `{"detail": {"error": ...}}`, so a client reading `body.error.message` shows `undefined`. Add one handler
  that emits the object **and** a `detail` copy — every existing caller keeps working while new UI reads the
  top level.
- **A React `onBlur` handler does not fire from a synthetic `blur` event; it is `focusout`.** Autosaving
  inline table inputs works in a real browser, but a scripted test that dispatches `new Event('blur')` proves
  nothing and makes a broken save look green. Drive `focus()` → native value setter → `input` →
  `new FocusEvent('focusout', {bubbles:true})`, then assert the *server* value, not the optimistic local one.
- **A scripted handler test trips the bot's own per-user rate limiter.** Firing 20+ synthetic updates from
  one Telegram id in a loop makes the last assertions receive "terlalu cepat" instead of the menu, which
  reads like a broken handler. Clear the limiter dict between scenarios, use a fresh uid per scenario, or
  assert on the handler's return path rather than the last sent message.
- **The store's UI session is not the API session.** When login writes a JWT to `localStorage` but the role
  guard reads an in-memory fixture store, every refresh redirects a signed-in admin to `/login`. Restore the
  store identity from the stored `{token, user}` on mount (map the gateway's `customer` → the UI's `user`),
  gate the first render on that restore, and verify by reloading a deep admin route directly.

## References

- `references/9router.md` — package layout, headless run, auth env, peer-token headers, endpoint map,
  pm2 ops.
- `references/billing-design.md` — prepaid credit model, micro-unit accounting, holds/settle, payment
  intents, reconciliation, market-anchored repricing (cheapest-market reference → new price sheet → verify),
  milestones.
- `references/aethinkai-gateway.md` — worked FastAPI + Postgres + React implementation: routes, brand/slug
  layer, cost derived from the upstream usage ledger, wallet invariant, admin inline-edit UX, per-vendor
  model icons, realtime feed (SSE + tunnel-safe polling), free tier + fallback chains, modal focus trap,
  public `/api/status` + landing-sync audit table, verify checklist.
