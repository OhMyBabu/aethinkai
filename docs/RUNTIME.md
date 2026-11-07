# Runtime notes (dev box at handoff)

## pm2

```
pm2 list
# id 0  9router            :20128   (upstream router, not part of this repo)
# aethink-store-bot        bot/bot.py (long polling)
# aethink-tunnel           cloudflared --url http://127.0.0.1:4173
```

Quick tunnel URL changes on every restart:

```
grep -o 'https://[a-z0-9-]*\.trycloudflare\.com' /root/.pm2/logs/aethink-tunnel-error.log | tail -1
```

The gateway exposes it as `GET /api/miniapp` (cached 30 s); the bot turns it into a `web_app`
button. For a stable deployment set `AETHINK_MINIAPP_URL=https://app.example.com`.

## Manual start (no pm2)

```bash
cd gateway && ./run.sh                        # uvicorn app.main:app --host 127.0.0.1 --port 8080
cd frontend && npm run dev -- --host 0.0.0.0  # :5173 dev with /api and /v1 proxy
cd frontend && npm run build && npm run preview -- --host 0.0.0.0   # :4173 static
cd bot && ./.venv/bin/python bot.py
```

`panel` = the web admin UI (`/admin/*`). Stopping it means stopping the frontend preview and the
gateway; the bot cannot work without the gateway.

## Postgres

```bash
psql "$DATABASE_URL" -f gateway/db/002_portal.sql
psql "$DATABASE_URL" -f gateway/db/003_link.sql
psql "$DATABASE_URL" -f docs/schema.sql      # only for a fresh empty database
```

Migrations applied in order: `001` (base, already folded into schema), `002_portal.sql`,
`003_link.sql` (+ `ALTER TABLE link_codes ADD COLUMN consumed_at`). `docs/schema.sql` is the
authoritative snapshot of the final shape.

## Smoke checks

```bash
curl -s localhost:8080/health
curl -s localhost:8080/api/status
curl -s localhost:8080/api/models | head -c 200
curl -s localhost:8080/api/packages
```

## Current catalogue (prices per 1M tokens, IDR)

| model_id | in | out | cached |
|---|---|---|---|
| claude-fable-5 | 96 500 | 482 500 | 22 000 |
| kimi-k3 | 40 600 | 203 000 | 4 050 |
| glm-5.3 | 1 140 | 22 750 | 1 000 |
| glm-5.3-flash | 700 | 2 350 | 490 |
| deepseek-v4.1-flash-1017 | 2 400 | 9 750 | 240 |
| deepseek-v4.1-flash | 570 | 8 125 | 163 |
| deepseek-v4-flash-0731 | 2 275 | 4 875 | 200 |

Packages (Rp): Starter 5 000 · 60 rpm · Pro 25 000 · 180 rpm · Max 100 000 · 600 rpm.
