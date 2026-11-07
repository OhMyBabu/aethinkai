# Landing ↔ backend data sync

How to make a marketing page tell the truth, and how to prove it.

## 1. Audit before editing

```bash
# what does the landing read?
grep -rn "fixtures\|SEED_\|fetch(\|/api/" src/pages/public src/components/landing
# what does the backend actually expose?
grep -n "@app\.\(get\|post\)" app/main.py
```

Then diff the page's claims against live data: model list and per-model price, endpoint list, uptime/latency.
Count and name each mismatch — "12 models in fixture vs 7 active, one model advertised at 2.2k/1M while billing
40.6k" is actionable; "prices are stale" is not.

## 2. Public status endpoint

Aggregate-only, no IDs, no user data:

```python
@app.get("/api/status")
async def public_status():
    row = await db.pool().fetchrow("""
        SELECT count(*) FILTER (WHERE created_at > now() - interval '24 hours') AS requests_24h,
               count(*) FILTER (WHERE created_at > now() - interval '7 days')  AS requests_7d,
               count(*) FILTER (WHERE status <> 'ok' AND created_at > now() - interval '24 hours') AS errors_24h,
               coalesce(sum(tokens_in + tokens_out)
                 FILTER (WHERE created_at > now() - interval '24 hours'), 0) AS tokens_24h,
               percentile_cont(0.95) WITHIN GROUP (ORDER BY latency_ms)
                 FILTER (WHERE created_at > now() - interval '7 days' AND latency_ms > 0) AS p95_ms,
               max(created_at) AS last_request_at
        FROM usage_events""")
    models_active = await db.pool().fetchval(
        "SELECT count(*) FROM model_prices WHERE active AND (price_in_idr > 0 OR price_out_idr > 0)")
    return {"status": "operational", "db": True, "uptime_seconds": int(time.time() - STARTED_AT),
            "models_active": int(models_active or 0), "requests_24h": ..., "requests_7d": ...,
            "last_request_at": ..., "p95_latency_ms": ..., "success_rate": ...}
```

- Compute a 7-day p95/success when the 24h window is empty; `0 req / 0 ms` on a live product reads as broken.
- Return `0`/`null` sentinels the UI renders as `—`, plus `last_request_at` so the page can say "last request 2d ago".
- Keep it unauthenticated but aggregate-only; never expose per-user or per-key rows.

## 3. Frontend hook

```ts
// one hook, one poll, fixture only as fallback
export function useLandingData() {
  const [apiModels, setApiModels] = useState<ApiModel[]>([]);
  const [status, setStatus] = useState<LandingStatus | null>(null);
  useEffect(() => { /* fetch /api/models + /api/status, 30s interval, keep last good snapshot */ }, []);
  const models = apiModels.length ? apiModels.map(toAIModel) : SEED_MODELS.filter(m => m.enabled);
  return { models, status, live: apiModels.length > 0 };
}
```

Map provider strings to the UI's provider union (`Anthropic`, `Zhipu→GLM`, `Moonshot→Kimi`) and extend that
union plus every `Record<Provider, …>` before the first build, or `tsc` fails on the missing key.

## 4. Claims to delete or rewrite

- Pricing packages with no `packages` table and no checkout → show real per-model prices, or hide the section.
- "Free tier · Rp X credits" when signup credits zero → describe what exists (shared free key, trial program).
- Endpoint lists in docs panels → match the router exactly; drop 404s.
- Uptime/latency strings → the status endpoint, or `—`.

## 5. Prove it

Run these against the rendered DOM, not the source:

```js
(document.body.innerText.match(/Qwen/gi) || []).length                       // retired names: expect 0
/\d+ routes, up to/.test(document.body.innerText)                            // live catalogue heading
 document.body.innerText.includes('Rp 570')                                  // price that exists only in the DB
[...document.querySelectorAll('pre,code')].some(n => n.innerText.includes(location.origin + '/v1'))
```

Also confirm the snippet base URL derives from `import.meta.env.VITE_GATEWAY_BASE_URL ?? `${location.origin}/v1``
— a hardcoded production domain that is not live yet is the same class of lie as a fake price.
