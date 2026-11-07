#!/usr/bin/env bash
# Share the production build publicly through a Cloudflare quick tunnel.
# Requires: cloudflared on PATH, dist/ built (npm run build).
set -euo pipefail
cd "$(dirname "$0")"

PORT="${PORT:-4173}"
[ -d dist ] || { echo "dist/ missing — run: npm run build"; exit 1; }

# preview server (SPA fallback + allowedHosts already configured in vite.config.ts)
if ! curl -sf -o /dev/null "http://127.0.0.1:${PORT}/"; then
  nohup npm run preview -- --host 0.0.0.0 --port "${PORT}" >/tmp/aethink-preview.log 2>&1 &
  sleep 3
fi

LOG=/tmp/aethink-tunnel.log
rm -f "$LOG"
nohup cloudflared tunnel --no-autoupdate --url "http://127.0.0.1:${PORT}" >"$LOG" 2>&1 &

for _ in $(seq 1 30); do
  URL=$(grep -Eo 'https://[a-z0-9-]+\.trycloudflare\.com' "$LOG" | head -1 || true)
  [ -n "${URL:-}" ] && break
  sleep 1
done

[ -n "${URL:-}" ] || { echo "tunnel failed, see $LOG"; exit 1; }
echo "public URL: $URL"
echo "local     : http://127.0.0.1:${PORT}"
