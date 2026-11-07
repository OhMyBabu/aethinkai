# Billing design for a resale LLM gateway

Scope: you run a gateway in front of an upstream (9Router/LiteLLM/one-api), you sell access, users
top up, requests consume credit.

## Model choice: prepaid credits

```
top-up IDR -> balance (micro-IDR) -> hold at request start -> settle on completion -> ledger row
```

Postpaid loses to a leaked key: the attacker burns unbilled credit for a month. Prepaid caps exposure at
the balance. Hybrid (auto-recharge below a threshold) is a later option, not the first build.

## Accounting unit

Store money as **integer micro-IDR** (1 IDR = 1e6). A cheap request can cost Rp 0.003; float accumulates
drift across millions of rows and breaks audit sums. Convert to rupiah only at render time.

```
cost_micro = ceil( (tokens_in/1e6 * price_in_usd + tokens_out/1e6 * price_out_usd)
                   * usd_idr * (1 + margin) * 1e6 )
```

Price card per model (`price_in_usd`, `price_out_usd`, `price_cached_usd`, `margin_pct`); seed from the
upstream's `/api/pricing` and let an admin override per model. Keep the FX rate in config, not in code.

### Sell price in IDR per 1M tokens = exact integer arithmetic

When the sell price is stored as **IDR per 1M tokens**, the per-request charge in micro-IDR collapses to a
multiplication — no division, no rounding, no float:

```
cost_idr   = tokens / 1e6 * price_idr_per_1M
cost_micro = cost_idr * 1e6 = tokens * price_idr_per_1M      # integer, exact
```

Assert the identity in a unit test and in the smoke test (e.g. 16 in / 14 out at 2_000 / 8_000 per 1M →
`16*2000 + 14*8000 = 144_000` micro = Rp 0,144) and compare it to the balance delta. If the two numbers
diverge, the bug is in hold/settle, not in pricing.

### Cached prompt tokens are already inside `prompt_tokens`

Providers report `usage.prompt_tokens` **including** `prompt_tokens_details.cached_tokens`. Multiplying the
whole `tokens_in` by `price_in_idr` and then adding `tokens_cached * price_cached_idr` bills the cached
slice twice — a 4 864-token cached prefix overcharged ~17x, which the customer notices as "why did one
message cost so much" long before reconciliation finds it.

```
cached     = clamp(tokens_cached, 0, tokens_in)
fresh      = tokens_in - cached
cost_micro = fresh * price_in_idr + tokens_out * price_out_idr + cached * price_cached_idr
```

Prove it with a two-call probe instead of reading the code: send the same long system prompt twice (~5K
tokens of filler), the second response returns `cached_tokens > 0`; then assert the stored
`cost_micro` equals the formula and the balance delta equals `cost_micro`. Retro-audit existing rows with:

```sql
SELECT count(*) FILTER (WHERE e.tokens_cached > 0) AS events_with_cache,
       sum(e.tokens_cached * (p.price_in_idr - p.price_cached_idr)) AS overcharge_micro
FROM usage_events e JOIN model_prices p ON p.model_id = e.model_id;
```

Holds stay conservative (`tokens_in + max_tokens`) — over-holding is released at settle, under-holding
overdraws the wallet.

Reject unpriced models before the hold (`403 model_not_allowed`): a model present in the upstream catalogue
but absent from `model_prices` otherwise serves traffic for free the moment a provider is added.

## Pricing strategy: locked IDR sell price + cost guardrail

Sell in the currency the customer pays (IDR per 1M tokens), keep cost in USD, and never let one silently
rewrite the other.

- `model_prices` holds the **sell** price (`price_in_idr`, `price_out_idr`, `price_cached_idr`) with
  `effective_at`; `cost_snapshots` holds the **cost** (`usd_in/out`, FX, implied IDR) refreshed from the
  upstream price card.
- Snapshot the applied prices into each `usage_events` row. A later price change must not alter history.
- Charge by the **requested** model, never by whatever the upstream fallback actually served. Fallback cost
  delta is platform margin, recorded as `cost_delta_micro`, not billed to the customer.
- Alert (do not auto-apply) when implied margin < threshold or FX moves > 3%: silent repricing is both a
  trust failure and a reconciliation nightmare.

### Market-anchored repricing (what to actually charge)

When the operator says "I guessed these prices", do not invent a cost basis and do not call the upstream
charge "their modal" — the cost number is **derived** from the router's usage ledger
(`usageHistory.cost`, USD, × FX). Say where it came from in one line, then price against the market.

Build a three-column worksheet per model, in IDR per 1M tokens:

| Column | Source |
|---|---|
| observed cost | Σ`cost`/Σtokens per model from the upstream ledger |
| current sell | `model_prices` |
| cheapest market | aggregator listings, input and output separately |

Market references that are queryable and current: `llmprice.org` (per-model cheapest provider),
`benchgecko.ai` (arbitrage/cheapest per model), `computeprices.com` (per-provider comparison),
`models.litellm.ai` (canonical list price), plus OpenRouter/sale listings. Most aggregators quote a blend as
`(3·in + out)/4` — compute that yourself from the in/out pair instead of trusting a single blended number.

Decisions the table drives:

- **Cost below the market floor** (cheap DeepSeek routes): sell at the market floor, keep the spread. No reason
  to undercut — the operator's price list is not a promo.
- **Cost above the market floor** (a reseller charging near list price for Claude/Kimi/GLM while discount
  providers sell 40–70 % lower): matching the market is a guaranteed loss at any volume. Two honest options —
  price at ≥1.3× observed cost and accept being uncompetitive, or add a second upstream/provider route and
  move that model. Never silently publish a below-cost rate.
- **Thin ledger samples** (1–2 requests on a model) make the per-model cost noise, especially when the sample
  is output-heavy. Flag it as an estimate; do not restate it as a rate card.
- Cache price ≈ 10 % of input price on DeepSeek/GLM-style routes (the cached slice is what makes long
  agent contexts affordable) and inside the output spread on premium models.

Applying and proving a retune:

1. One `PUT /api/admin/models/{model_id}` per model carrying `price_in_idr`, `price_out_idr`,
   `price_cached_idr`, `public_id`, `provider_label`, `active` — prices and enablement in the same call, so the
   audit row and the data plane agree.
2. Duplicate/ghost rows (a `mk/glm-5-3` row when upstream exposes `mk/glm-5.3`) get `active=false` with zero
   prices, not `DELETE`: historical `usage_events` still join to them for display names.
3. Read the public projection back (`GET /api/models` → 7 ids, `pricing_idr_per_1m`), then fire one real
   completion and assert `cost_micro == (in−cached)*new_in + out*new_out + cached*new_cached`.
4. Quantify the change by replaying history at the new sheet — same events, new prices:

```sql
SELECT round(sum((e.tokens_in-e.tokens_cached)*p.price_in_idr + e.tokens_out*p.price_out_idr
                 + e.tokens_cached*p.price_cached_idr)/1e6, 2) AS revenue_new,
       round(sum(e.cost_usd)*:fx, 2)                              AS cost,
       round(sum(e.cost_usd)*:fx, 2) * -1
         + round(sum((e.tokens_in-e.tokens_cached)*p.price_in_idr + e.tokens_out*p.price_out_idr
                 + e.tokens_cached*p.price_cached_idr)/1e6, 2)    AS margin_new
FROM usage_events e JOIN model_prices p ON p.model_id = e.model_id;
```

A margin that flips from negative to positive on the same traffic is the whole point of the exercise; report
that number instead of a generic "prices updated".

## Admin pricing surface

The operator-facing screen is part of the billing system, not decoration. One row per model with:
`model_id` (the exact `provider/model` the data plane accepts), editable `price_in_idr` / `price_out_idr` /
`price_cached_idr`, an enabled toggle, and 30-day requests + revenue. Requirements that keep it honest:

- Listing must be the **union** of the upstream catalogue and local price rows, with a `priced` flag, so a
  newly added provider model is visible and obviously unpriced instead of silently free.
- Save is a single `PUT` per model that returns the stored row; refetch after saving so the number on screen
  is the number in the database, not local component state.
- Every price change writes an audit row (`actor`, `action`, `target`, new values) — the price table is the
  money path, and "who changed this rate" must be answerable months later.
- Show the derived display value next to the raw input (`Rp 3.000`) and keep the raw integer as the source
  of truth.

### Row editing mechanics (the part users file bugs about)

A price table that is always-editable looks simpler and behaves worse: keystrokes get lost, toggles snap back,
and the operator cannot tell what is saved.

- **One row = one edit session.** Read mode shows formatted prices and a status pill with an `Edit` button;
  edit mode shows the three inputs plus the enable toggle plus `Save` / `Batal`. Never auto-save per keystroke.
- **State lives in the row, seeded from the server row on `Edit`.** A page-level draft map (`drafts[id]`) is
  overwritten by the post-save refetch and by re-renders, which is what makes typing feel broken and makes a
  toggle revert to its old value.
- **One `PUT` carries `price_in_idr`, `price_out_idr`, `price_cached_idr` and `active`.** Saving the toggle in
  a separate call races the refetch and resurrects the previous status.
- **Numeric inputs: digits only, `maxLength` ~12, select the value once when the row enters edit mode.**
  The row's `Edit` handler should render the inputs focused with the value selected (`autoFocus` + a mount-time
  `select()`), so typing replaces `4000` instead of concatenating into `40006000`. Do **not** put
  `onFocus={e => e.currentTarget.select()}` on the input: it re-fires every time the caret is clicked back in,
  so the first keystroke silently wipes the number and the operator reports a "jumping cursor". `Enter` in any
  price field should save; `Escape` cancels.
- **Verify a UI save from the database, not the toast:** read back `model_prices` (prices *and* `active`,
  `updated_by`) plus the audit row for that model. One save must produce exactly one audit entry.
- **Driving a numeric field from a browser harness:** send the whole value with `Input.insertText`. Sending a
  `keyDown` + `char` pair per character inserts each digit twice and produces numbers like `55550000` that look
  like an application bug.

## Customer catalogue is a projection of the admin price table

The admin table is the control plane; every customer-visible list (workspace model page, landing catalogue,
SDK integrations) must be a projection of the same rows, never a fixture or a hand-maintained second list.

- **One predicate, one place:** `model_prices WHERE active AND (price_in_idr > 0 OR price_out_idr > 0)`.
  Enabled-but-unpriced and priced-but-disabled must both be invisible, because the data plane already
  rejects them (`403 model_not_allowed`) — if the catalogue is wider than the predicate it advertises
  models that `/v1` refuses, and if it is narrower the admin sees a model that never ships.
- **Serve it unauthenticated** from a public `GET /api/models`, separate from the key-protected
  `/v1/models`. Browsing must not need an API key, and a public page must not be able to reach the data
  plane through the same call.
- **Join upstream metadata at read time** (context window, capabilities, display name from the upstream
  catalogue) onto the price row; do not persist a second catalogue copy that can drift.
- **Verify by mutating one row and recounting both views in the same pass:** disable a priced model → the
  customer page count drops by one and the id disappears; re-enable → it returns. Drive the mutation from
  the API/DB and then read the rendered page, not the other way round.

## Request lifecycle

1. Resolve key -> user, plan, balance, rate limits.
2. Reject early: `402 insufficient_credits`, `429 rate_limited`, `403 model_not_allowed`.
3. **Hold** an estimate (`tokens_in + max_tokens`) so a concurrent burst cannot overdraw.
4. Proxy upstream, stream the body back unchanged.
5. Read `usage` from the final chunk; settle the real cost, release the hold.
6. Persist `usage_events` (tokens, cost, latency, status, request_id) + `ledger_entries`
   (`charge`, `balance_after`).
7. Stream aborted / upstream 5xx -> settle 0 or partial, mark `status`, still write the event; silent
   drops make reconciliation impossible.

Holds expire (e.g. 5 min) and are swept by a cron — a crashed worker must not freeze a user's balance.

## Schemas (minimum)

| Table | Core columns |
|---|---|
| `users` | id, email, password_hash, role, plan, status |
| `api_keys` | id, user_id, prefix, hash, name, last_used_at, revoked_at |
| `balances` | user_id, balance_micro, updated_at |
| `holds` | id, user_id, key_id, amount_micro, expires_at, state |
| `usage_events` | id, key_id, model, tokens_in, tokens_out, cost_micro, latency_ms, status, request_id |
| `ledger_entries` | id, user_id, kind(topup/charge/refund/adjust), amount_micro, balance_after, ref |
| `payment_intents` | id, user_id, provider, provider_ref, amount_idr, status, paid_at |
| `model_prices` | model_id, usd_in, usd_out, usd_cached, margin_pct, active |

Skip `invoices`, `organizations`, `plans`, `audit_logs` until a B2B or invoicing requirement exists.

## Payments

- Create a payment intent server-side, hand the user the provider's redirect/QR payload.
- Webhook: verify signature, then **idempotent credit by `provider_ref`** — retries are normal.
- Expired/failed intents mutate nothing; gateway fees are a margin line, never deducted from the user's
  balance.
- Refunds are admin-only ledger entries with a reason, never row deletion.

## Reconciliation (the part that gets skipped)

Nightly: aggregate `usage_events` per model/day and compare with the upstream's usage endpoint
(`/api/usage/history` style, cost in USD). Drift >1% means the upstream rerouted to a fallback model or
changed prices — alert, don't auto-correct. Without this, a silent model fallback bills the wrong rate
forever.

### Upstream cost reconciliation (per request, from the local ledger)

A self-hosted router usually keeps no price API but does keep a local ledger
(9Router: `usageHistory(model, promptTokens, completionTokens, cost, timestamp)` in SQLite). Read it
read-only (`file:...?mode=ro&uri=true`) and attach the real USD cost to each `usage_events` row.

```python
rows = con.execute(
    """SELECT cost, coalesce(promptTokens,0) p, coalesce(completionTokens,0) c
       FROM usageHistory WHERE model = ?
         AND julianday(timestamp) > julianday('now', ?)
       ORDER BY timestamp DESC LIMIT 25""", (slug, "-300 seconds")).fetchall()
best = None
for cost, p, c in rows:                       # completion identifies the call
    if cost is None or abs(int(c) - completion_tokens) > 2:
        continue
    delta = abs(int(p) - prompt_tokens)
    if best is None or delta < best[0]:
        best = (delta, float(cost))
return best[1] if best else rate_from_ledger(slug) * (prompt_tokens + completion_tokens) / 1e6
```

Why not exact match: the router writes `promptTokens` **without** the cached prefix (223 stored vs 2 223
reported), so `WHERE promptTokens = ?` never hits a cached call and the fallback rate silently takes over.
Why not a blended rate: an independently computed blended USD/1M inflated 72 small requests into
"Rp 28 651 of cost" against Rp 1 008 of revenue (−3 019% margin), which reads as a broken dashboard.
Derive any fallback from the same ledger (`Σcost / Σtokens` per model) and sanity-check the total:
`SELECT sum(cost) FROM usageHistory` for the window must be in the same order of magnitude.

Repairing rows already written: match each event to the nearest ledger row of the same model within a few
seconds of `created_at` (one ledger row consumed once), rewrite `cost_usd`, then for leftovers scale by the
model's observed USD/token. Recompute revenue − cost afterwards; a margin that flips from −3 000% to a
believable number is the check that the join is right. Expect some genuinely negative margin: a model sold
at Rp 2 000/1M against an upstream ~Rp 9 100/1M loses money on big-context calls, and the dashboard should
say so rather than hide it.

## Abuse controls

- Per-key RPM and TPM (token bucket; Redis or a `rate_counters` table).
- `max_tokens` ceiling per plan; free tier limited to cheap models.
- Balance <= 0 -> `402` with a machine-readable code the UI can render into a top-up CTA.
- One default key per account; new keys behind email verification.

## Build order

| Milestone | Content | Proof |
|---|---|---|
| M1 | gateway + Postgres + proxy + metering | real completion through your endpoint, `usage_events` populated |
| M2 | credits, holds, ledger, key CRUD, rate limits | balance decreases by measured tokens, 402 at zero |
| M3 | payment provider (sandbox) + webhook + top-up page | balance increases only after webhook, replay is idempotent |
| M4 | pricing admin, reconciliation job, tunnel + static hosting | public host serves `/v1`, nightly drift report |

## Decisions to settle before M1

1. Payment provider (Midtrans vs Xendit) — QRIS/VA coverage vs documentation quality.
2. Pricing source: auto-seed from the upstream price card + global margin, or per-model manual override.
3. Free tier: signup credit vs minimum top-up — decides whether abuse controls ship in M1.
