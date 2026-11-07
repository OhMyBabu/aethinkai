# AethinkAI gateway (worked example on this box)

Resale gateway in front of a local 9Router. Owns users, keys, money; 9Router owns providers.

## Layout / endpoints

```
/root/projects/aethinkai-gateway    FastAPI, 127.0.0.1:8080, run.sh
  app/main.py    /v1/chat/completions (SSE passthrough), /v1/models, /api/models (public), /health
  app/user.py    /api/auth/signup|login, /api/me(/summary,/usage,/ledger), /api/keys CRUD
  app/admin.py   /api/admin/models|keys|users|summary|usage|reconciliation|pricing/suggest|maintenance/*
  app/db.py      pool, find_key, resolve_model, credit_user, list_ledger, expire_holds, balance_liability
  app/auth.py    PBKDF2-SHA256 120k + JWT (secret /root/.secrets/aethink-jwt)
  db/001_init.sql
Postgres 16, 127.0.0.1:5432, role aethink, secret /root/.secrets/aethink-db.env (0600)
9Router 0.5.112, 0.0.0.0:20128, pm2 "9router", peer token /root/services/.9router-peer
Frontend proxy: vite /api + /v1 -> 127.0.0.1:8080 (dev and preview)
```

## Brand layer (own catalogue, upstream hidden)

`model_prices` carries both identities; only `public_id` is ever published.

```sql
model_id        'mk/claude-fable-5'   -- 9Router route, internal
public_id       'claude-fable-5'      -- what customers send and see (unique index)
provider_label  'Claude'              -- admin-set display brand
```

```python
alias = payload["model"]                       # customer slug
row = await db.resolve_model(alias)            # WHERE public_id=$1 OR model_id=$1 AND active
payload["model"] = row["model_id"]             # rewrite to the upstream route
```

- `/v1/models` emits `{id: public_id, owned_by: "aethink", name, provider, pricing_idr_per_1m}`; the raw
  route never appears. `/api/models` (public, no key) returns the same ids for the UI catalogue.
- Drop rows where `model_id` is absent from the live upstream catalogue, otherwise a stale price row is
  advertised and 4xx/5xx at request time.
- Unknown alias → `403 model_not_allowed`; never fall through to upstream with the client's string.

## Billing math (no rounding drift)

Store money as integer micro-IDR (1 IDR = 1e6). Price row is IDR per 1M tokens, so:

```
cost_micro = (tokens_in - tokens_cached)*price_in_idr
           + tokens_out*price_out_idr
           + tokens_cached*price_cached_idr
```

`prompt_tokens` already contains the cached block, so subtract it before charging full input rate — otherwise
the cache slice is billed twice. Clamp `cached = min(cached, tokens_in)` before the subtraction. Exact
integer; `tokens/1e6 * price * 1e6` cancels. Snapshot `price_in_idr`/`price_out_idr` onto every
`usage_events` row so later price edits never rewrite history.

## Upstream cost (real, not guessed)

9Router's `/api/pricing` returns `401` to the loopback peer token, so read its own ledger instead:
`/root/.9router/db/data.sqlite` → `usageHistory(model, promptTokens, completionTokens, cost, timestamp)`.

```python
# exact: same model + token counts inside a short window
SELECT cost FROM usageHistory
WHERE model=? AND promptTokens=? AND completionTokens=?
  AND julianday(timestamp) > julianday('now', ?)   -- '-300 seconds'
ORDER BY timestamp DESC LIMIT 1

# fallback: blended USD/1M per model over 30 days
SELECT model, sum(cost) c, sum(promptTokens+completionTokens) t
FROM usageHistory WHERE status='ok'
  AND julianday(timestamp) > julianday('now','-30 days') GROUP BY model
```

Store the result in `usage_events.cost_usd` and `cost_delta_micro = cost_micro - round(usd*FX*1e6)`; margin,
reconciliation and price suggestions all read from there. Backfill old rows with a maintenance endpoint
(`window_seconds` wide) rather than leaving zeros — zeros read as 100% margin.

`GET /api/admin/pricing/suggest?margin_pct=35` returns `upstream_idr_per_1m`, `suggested_price_idr` and
`healthy` per model; that is how a sub-cost price list gets caught (`Claude Fable 5` cost Rp165k/1M vs a
Rp9k sell price is a −1700% margin, not a rounding issue).

## Wallet invariant + janitor

- Every credit/charge writes `ledger_entries(kind, amount_micro, balance_after)` in the same transaction as
  the `balances` update; kinds used: `opening`, `topup`, `charge`, `hold_release`.
- Balances seeded directly by SQL need an `opening` adjustment equal to `balance - Σ ledger`, or
  `summary.ledger_diff_micro` is non-zero forever.
- `holds` rows carry `expires_at`; a 60-second janitor task (or `POST /api/admin/maintenance/expire-holds`)
  marks stale ones `expired`, refunds the hold and writes a `hold_release` row — otherwise money vanishes on
  a crashed or aborted stream.

## Hard-won details

- **9Router streams even when `stream:false`**, and may emit a full JSON object followed by `data: [DONE]`.
  Parse with `json.JSONDecoder().raw_decode` first, else aggregate the SSE chunks. A plain `json.loads(body)`
  throws "Extra data" and surfaces as a 500 after metering already ran.
- **On upstream error, return the upstream body**, not `{}` — otherwise the operator sees 503 with no reason.
  Provider freezes arrive as `503` wrapping a `403 ... account has been frozen`.
- **Only expose priced+active models** on both `/api/models` and `/v1/models`; anything else must 403
  `model_not_allowed`. A price row whose `model_id` does not exist upstream (`mk/glm-5-3` vs `mk/glm-5.3`)
  silently never appears — worth flagging in the admin UI.
- **API key pages must call the gateway, not a client store.** A fixture-backed create button produces keys
  that exist only in `localStorage`: nothing in `api_keys`, nothing for admin to see, and `401` on `/v1`. Pair
  every user-side key screen with `GET/POST/PATCH/DELETE /api/keys` plus an admin `GET /api/admin/keys` that
  joins owner email and per-key requests/cost.
- **Admin inline-edit UX**: keep row state local (one component per row, `useState`), select-all on focus,
  digits-only, and save price+toggle+label in ONE `PUT`. A shared drafts object re-saved after a reload is what
  makes a toggle look like it reverts by itself.
- **Model icons**: map by model id (`/claude|anthropic/`, `/deepseek/`, `/qwen/`, `/glm|zhipu/`, `/kimi/`,
  `/minimax/`) from `@lobehub/icons-static-svg` imported `?raw`. Never fall back to another vendor's logo;
  use a neutral letter tile. GLM models want the Zhipu/Z.ai mark, not `glmv`.
- **Sync the customer catalogue from the admin table**, not from fixtures: public `GET /api/models` reading
  `model_prices WHERE active AND (price_in>0 OR price_out>0)` plus upstream metadata for context/capabilities.
- **Restarting uvicorn**: resolve the listener pid (`ss -ltnp | grep :8080`), kill that pid, start the new
  process, and confirm the served code changed. `pkill -f` on the module string can signal the launching
  shell and leave the old worker answering on stale code.

## Fixture → live wiring (what still holds demo data)

Every dashboard surface can look wired while four layers are not. Order of attack:

| Surface | Wrong source | Fix |
|---|---|---|
| Page body (tables, KPIs) | client store / fixtures | fetch the gateway endpoint in `useEffect` |
| Chart + range helpers | shared `lib/series.ts` with a hardcoded `now` | anchor to `new Date()` |
| Layout chrome (sidebar balance, plan) | `state.users[0]` from store | `me()` in `AppShell`, pass `credits` |
| Log rows' model names | `usage_events.model_id` (`mk/...`) | join `model_prices`, return `display_name` |

Endpoints the wired UI needs beyond inference:

```
GET  /api/me/requests?days&limit      per-request log for the customer
GET  /api/me/summary                  spend today, tokens, key counts
GET  /api/me/ledger                   billing history (topup/charge/hold_release/opening)
GET  /api/admin/requests              all users, join email + key name + display_name
GET  /api/admin/audit?limit           audit feed for the admin overview
GET  /api/admin/summary               revenue, cost, margin, liability, ledger_diff, negative_wallets
POST /api/admin/users                 create user with initial credit
POST /api/admin/users/{id}/credit     manual top-up (writes ledger)
POST /api/auth/signup                 self-serve, role customer
```

Row-level display name, so no upstream prefix reaches the UI:

```sql
SELECT e.*, k.name AS key_name, coalesce(p.display_name, e.model_id) AS display_name
FROM usage_events e
LEFT JOIN api_keys k ON k.id = e.key_id
LEFT JOIN model_prices p ON p.model_id = e.model_id
```

`AppShell` also needs a `me()` refresh on `location.pathname` so a top-up made on the billing page shows in
the sidebar without a hard reload. Anything still on fixtures after this pass (`settings`, `packages`,
 landing catalogue) should be listed to the operator as remaining work, not implied done.

## Client attribution & key monitor

Store the caller at insert time — the socket IP is the tunnel process, not the customer:

```python
def _client(request) -> tuple[str | None, str | None]:
    h = request.headers
    ip = (h.get("cf-connecting-ip") or h.get("x-real-ip")
          or (h.get("x-forwarded-for") or "").split(",")[0].strip()
          or (request.client.host if request.client else None))
    return (ip or None), (h.get("user-agent") or "").strip()[:300] or None
```

Columns: `usage_events.client_ip text`, `client_ua text`, index on `client_ip`. Rows written before the
migration stay NULL forever (9Router stores no IPs — its `requestDetails` table is empty), so show them as a
labelled "IP belum tercatat" bucket.

One endpoint answers the whole admin question, folding four `GROUP BY` queries in Python (`keys`,
`by_model`, `by_ip`, `daily`):

```
GET /api/admin/monitor?days=7
 → users[] : keys_total, keys_active, requests, tokens_in/out, cost_micro, ip_count
 → keys[]  : id, name, prefix, status(active|revoked), requests, tokens_in/out/cached, cost_micro,
             ip_count, models[]{provider, public_id, display_name, requests, tokens_in/out, cost_micro},
             ips[]{ip, user_agent, requests, cost_micro, first_seen, last_seen},
             daily[]{day, requests, tokens_in, tokens_out}
```

- `status` derives from `revoked_at IS NULL`; `LEFT JOIN usage_events` with the interval inside the join,
  otherwise every key with zero traffic disappears from the list.
- Provider: `coalesce(nullif(p.provider_label,''), '—')` then classify from brand tokens in `model_id`
  (`claude→Anthropic`, `deepseek→DeepSeek`, `glm|zhipu→Zhipu`, `kimi→Moonshot`, …) — un-renamed models
  otherwise all read `—`.
- Page shape: master list of user groups → key rows (name, prefix, IP count, req, model ×n), detail panel for
  the selected key with its own stats, provider/model table, IP+UA table, and per-day in/out bars. Group by
  user, not a flat table: operators scan "who owns what" before "which request".

Burst analysis shortcut: when one prompt yields several billed rows, join gateway `usage_events` to the
upstream `usageHistory` on timestamp + completion tokens. 1:1 with distinct `request_id`s = real client calls;
the caller then shows up as a single `client_ip` + UA (e.g. `node` from a cloud VM) firing 3–4 calls per
message (agent loop with a ~2K cached system prompt + title/summary helpers).

Model-first view ("model apa yang lagi dipakai siapa, dari IP mana"): one `GROUP BY model_id, user_id,
client_ip, client_ua` query folded into `models[] → users[] → ips[]`, each level carrying
`requests, tokens_in/out, cost_micro, last_seen`, done in Python rather than N per-model calls. Render it as
an accordion (model row expands to user rows, each with IP chips + UA tooltip) instead of a flat table; the
question is "who is hammering this model right now", which a per-key page cannot answer.

## Realtime feed (dashboards without reload)

Operator ask: "grafik dan log update sendiri, gaperlu reload". One module, two transports, identical payloads.

Server (`app/live.py`, included as a router):

```
GET /api/live/me?token=…          SSE, user-scoped   (AND e.user_id = $2)
GET /api/live/admin?token=…       SSE, all users
event: ready      once, {server_time}
event: requests   {rows:[…]} every 2 s (new rows only, cursor on created_at/id)
event: summary    {revenue_micro, cost_micro, margin_micro, requests_24h, …} every ~6 s
```

Client rules that made it work:

- `EventSource` cannot send an `Authorization` header — put the JWT in the query string and validate it
  server-side; never put the API key there.
- Watchdog: if no `ready` frame in ~3.5 s, close the stream and start polling; two failed reconnects also
  switch modes. A buffering proxy passes the handshake and then silence, so `onerror` never fires.
- Poll endpoint returns the same envelope plus `server_time`, which the client sends back as `since` so each
  poll is incremental rather than a full table dump.
- Merge rows by `id` and cap the array (~400–800 rows); a naive append grows unbounded in a tab left open all
  day.
- Per-page throttles: log/usage pages append every tick, but chart/KPI pages that refetch aggregate endpoints
  throttle to ~4–5 s (`onRows` → `setTick`, `onSummary` → throttled reload).
- One `useLive(channel, handlers)` hook with handlers held in a ref, so changing inline callbacks does not
  tear down and rebuild the connection each render.
- Badge only from the hook's `onStatus`: `Connecting` → `Live` → `Reconnecting`. Screenshot-free proof is
  reading the badge text plus the row count before/after one real request.

Verify through the public tunnel, not localhost — localhost hides the buffering:

```bash
# backend: does the stream emit at all?
T=$(curl -s -X POST $B/api/auth/login -H 'Content-Type: application/json' -d "{…}" | jq -r .token)
timeout 10 curl -sN "$B/api/live/admin?token=$T" | head -c 400
# through the tunnel: expect a buffered/empty body → this is why polling exists
timeout 10 curl -sN "https://<tunnel>/api/live/admin?token=$T" | head -c 200
```

UI proof without a screenshot: open the page, record the row count / a KPI, fire one request with a valid key
(or insert a `usage_events` row with a `request_id` like `probe-%`), wait one poll interval, re-read the same
text and assert it changed. Delete the probe rows and any probe key afterwards — synthetic rows otherwise
show up in the operator's revenue numbers.

## Free tier (bansos) + fallback chains

Public "free credit" lane: **one shared key per program**, everyone copies it and burns the same quota together,
admin sets the models and can rotate the key.

```sql
bansos_programs(id, name, active, credit_micro, models jsonb, auto_grant bool, per_user_limit)
bansos_grants  (id, program_id, user_id, amount_micro, used_micro, status)   -- status: active|exhausted|revoked
public_keys    (id, program_id, api_key_id, key_plain, label, created_by_ip, created_at, revoked_at)
```

- One **public user** (`bansos@aethink.ai`, role customer, random password) owns every public key; one grant
  per program is what all keys spend from, so the "remaining credit" the landing page shows is the truth.
- Key lifecycle: `ensure_program_key(program_id)` returns the live `public_keys` row joined to `api_keys`, or
  creates both (`api_keys` hash + prefix, `public_keys.key_plain`) in one call — lazy creation on first read
  means the landing panel never shows an empty state and there is no mint button to abuse. Rotate is the only
  mutating verb (`POST /api/admin/bansos/programs/{id}/rotate-key`): revoke the old `api_keys` row **and** its
  `public_keys` row, then mint a fresh pair; the previous key must 401 within the same second. Keep
  `key_plain` in `public_keys` only — `api_keys` stores a hash and can never reproduce the key for a copy
  button.
- Bearer guard must accept the new prefix:

  ```python
  if not (raw.startswith("sk-aeth_") or raw.startswith("sk-bansos_")): 401
  ```

  (A shared key means no per-program key cap is needed; the single row is created once.)
- Metering: wallet dry → look up an active grant whose program `models` contains the resolved `public_id`;
  if found, skip the hold (`hold_id=None`) and charge the grant after the response via
  `used_micro = least(amount_micro, used_micro + charged)`; status flips to `exhausted` at the ceiling. Any
  model outside the program still returns `402`. `auto_grant` creates the grant at signup.
- Public read endpoint: `{program:{id,name,models,credit_idr}, total_micro, used_micro, remaining_micro,
  shared_key:{id,masked,key,created_at,last_used_at}, keys:[shared_key], stats:{requests,tokens_in,tokens_out}}`;
  the landing panel polls it every ~5 s, shows the masked key with a copy button (full value from `shared_key.key`)
  and the live remaining credit. No mint endpoint on the public side.
- Admin program form has no "limit per user" knob in the shared-key model: `per_user_limit` only governs
  `auto_grant` signups. If the column stays in the schema, keep it at 1 and hide it; leaving a visible field
  implies a rule the backend does not enforce.
- Present small amounts with cents (`Rp 0,13`), not a rounder that prints `Rp 0`.

Fallback chains:

```sql
model_fallbacks(id, model_id, fallback_model_id, provider_label, priority, active)
```

```python
chain = [payload] + [{**payload, "model": m} for m in await fallbacks_for(route)]
for candidate in chain:
    try: status, body = await upstream.chat(candidate)
    except Exception: continue
    if status >= 500: continue
    served_route = candidate["model"]; break
else:                     # every route failed → release hold, record upstream_error, 502
    ...
```

Streaming: `agen = stream_chat(candidate); first = await agen.__anext__()` inside `try/except` per candidate,
and raise `RuntimeError` after the loop's `else` — a silent fall-through otherwise returns an empty 200 and
bills zero. Price stays the customer's model; `cost_usd` uses `served_route`. Admin surface lists chains
ordered by `priority` with an active toggle; the fallback picker is the upstream catalogue
(`GET /api/admin/upstream/models`, ~48 ids behind a reseller route).

## Modal / drawer focus trap (caret jumps in popup forms)

`useEffect(..., [open, onClose])` re-runs on every keystroke because pages pass inline arrows; it refocuses
the first focusable node and the caret leaves the input after one character. Hold the callback in a ref
(`onCloseRef.current = onClose`) and depend on `[open, dismissable]` only. Test: focus the first input,
insert 10 characters (CDP `Input.insertText` at ~50 ms), assert `document.activeElement === input` and the
full value. Drive the typing from the harness as one `cdp("Input.insertText", …)` call per character — an
in-page `setInterval` loop wrapped in an awaited Promise blocks the browser RPC and the evaluate times out
before the assertion ever runs.

## Public status + landing sync

Marketing pages lie by default because they are built before the data plane exists. One public endpoint and
one hook make them honest without touching layout.

`GET /api/status` — no auth, aggregates only (never per-user rows):

```python
STARTED_AT = time.time()

@app.get("/api/status")
async def public_status():
    row = await db.pool().fetchrow("""
        SELECT count(*) FILTER (WHERE created_at > now()-interval '24 hours') AS requests_24h,
               count(*) FILTER (WHERE created_at > now()-interval '7 days')   AS requests_7d,
               coalesce(sum(tokens_in+tokens_out)
                 FILTER (WHERE created_at > now()-interval '24 hours'), 0)    AS tokens_24h,
               count(*) FILTER (WHERE status <> 'ok'
                 AND created_at > now()-interval '24 hours')                 AS errors_24h,
               max(created_at) AS last_request_at,
               percentile_cont(0.95) WITHIN GROUP (ORDER BY latency_ms)
                 FILTER (WHERE created_at > now()-interval '7 days' AND latency_ms > 0) AS p95_ms
        FROM usage_events""")
    models_active = await db.pool().fetchval(
        "SELECT count(*) FROM model_prices WHERE active AND (price_in_idr>0 OR price_out_idr>0)")
```

Return `{status, db, uptime_seconds, models_active, requests_24h, requests_7d, last_request_at, tokens_24h,
 errors_24h, p95_latency_ms, success_rate}`; `success_rate` = `1 - errors/requests` over 24 h, `100.0` when
the denominator is 0. Reuse the 7-day p95 so a quiet day does not print `0 ms`.

Client (`src/lib/landing-data.ts`) — poll both public endpoints every 30 s, map once, fixture only as
last-resort fallback:

```ts
const PROVIDER_MAP: Record<string, Provider> = {
  anthropic: "Anthropic", deepseek: "DeepSeek", zhipu: "GLM", glm: "GLM",
  moonshot: "Kimi", kimi: "Kimi", alibaba: "Qwen", qwen: "Qwen",
};

export function useLandingData() {
  const [apiModels, setApiModels] = useState<ApiModel[]>([]);
  const [status, setStatus] = useState<LandingStatus | null>(null);
  useEffect(() => {
    const pull = async () => {
      try { setApiModels((await getJSON<{data: ApiModel[]}>("/api/models")).data); } catch {}
      try { setStatus(await getJSON<LandingStatus>("/api/status")); } catch {}
    };
    void pull();
    const t = setInterval(() => void pull(), 30_000);
    return () => clearInterval(t);
  }, []);
  const models = useMemo(
    () => (apiModels.length ? apiModels.map(toAIModel) : SEED_MODELS.filter(m => m.enabled)),
    [apiModels]);
  return { models, status, live: apiModels.length > 0 };
}
```

Audit table — every row was a real defect in the same pass:

| Claim on the page | Wrong source | Fix |
|---|---|---|
| Catalogue (12 models, Qwen/vision) | `SEED_MODELS` in `data/fixtures.ts` | `/api/models`; dead vendors vanish, Claude appears |
| Prices (e.g. Kimi Rp2.200/1M) | fixture rates | `pricing_idr_per_1m` from the same rows billing uses |
| "Plans" Starter/Growth/Scale | invented packages, no `packages` table | per-model price cards (3 cheapest by input rate) or hide the section |
| `99.98% uptime`, `p95 118ms`, `1.2s` | literals in JSX | `/api/status`; `—` when no samples |
| Docs endpoint list (`/v1/embeddings`, `/v1/usage`) | aspirational | real routes only; `curl` each one first |
| `https://api.<domain>/v1` in snippets | hardcoded prod host | `env ?? location.origin + "/v1"` |
| "Free tier · Rp25.000 credits" | never granted by signup | the actual mechanism (shared bansos key) |

Verification is DOM text, not screenshots: read the catalogue heading count, search for a removed vendor
name (must be 0 hits), regex the rendered `Rp …` cards, open the status popover and assert its numbers against
`curl /api/status`, then set 390×844 and assert `scrollWidth === innerWidth`.

## Verify checklist

```bash
curl -s localhost:8080/health
curl -s -H "Authorization: Bearer $KEY" $BASE/models | jq '.data[].id'          # must be public slugs
curl -s $BASE/chat/completions -H "Authorization: Bearer $KEY" -H 'Content-Type: application/json' \
  -d '{"model":"<public-slug>","messages":[{"role":"user","content":"ping"}],"max_tokens":8}' | jq '.usage'
psql "$DATABASE_URL" -tAc "select model_id,tokens_in,tokens_out,cost_micro,cost_usd from usage_events order by created_at desc limit 1"
psql "$DATABASE_URL" -tAc "select (select sum(balance_micro) from balances) - (select sum(amount_micro) from ledger_entries) as drift"
```

`cost_micro` must equal `(tokens_in-tokens_cached)*price_in + tokens_out*price_out + tokens_cached*price_cached`;
balance delta must equal it too; `drift` must be `0`. Full E2E in one pass: signup → admin credit → create key
→ chat → `/api/me`, `/api/me/ledger`, `/api/admin/summary` all agree.
