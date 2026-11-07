#!/usr/bin/env bash
# Share a built SPA through a Cloudflare quick tunnel (ephemeral URL).
# Copy into the project root, chmod +x, run after `npm run build`.
set -euo pipefail
cd "$(dirname "$0")"

PORT="${PORT:-4173}"
[ -d dist ] || { echo "dist/ missing — run: npm run build"; exit 1; }
[ -x "$(command -v cloudflared || true)" ] || {
  echo "cloudflared missing — install:"
  echo "  curl -fsSL -o /usr/local/bin/cloudflared https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-amd64 && chmod +x /usr/local/bin/cloudflared"
  exit 1
}

if ! curl -sf -o /dev/null "http://127.0.0.1:${PORT}/"; then
  nohup npm run preview -- --host 0.0.0.0 --port "${PORT}" >/tmp/preview.log 2>&1 &
  sleep 3
fi

LOG=/tmp/tunnel.log
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
