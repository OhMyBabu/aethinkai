#!/usr/bin/env bash
# AethinkAI — one-command deploy for the gateway box.
#   ./deploy.sh            build + ship everything
#   ./deploy.sh backend    restart gateway only
#   ./deploy.sh frontend   rebuild the SPA only
# Assumes: Postgres + /root/.secrets/aethink-db.env exist, nginx vhost installed.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
WEB_ROOT="${AETHINK_WEB_ROOT:-/var/www/aethink}"
WHAT="${1:-all}"

log() { printf '\033[38;5;208m[aethink]\033[0m %s\n' "$*"; }

restart_gateway() {
  # Restart by unit, then prove the listener and the new code are actually serving.
  systemctl restart aethink-gateway
  for _ in $(seq 1 30); do
    if curl -fsS -m 2 http://127.0.0.1:8080/health >/dev/null 2>&1; then break; fi
    sleep 1
  done
  curl -fsS http://127.0.0.1:8080/health || { log "gateway did not come up"; exit 1; }
  log "gateway healthy"
}

build_frontend() {
  cd "$ROOT/frontend"
  [ -d node_modules ] || npm ci --no-audit --no-fund
  npm run build
  mkdir -p "$WEB_ROOT"
  rsync -a --delete dist/ "$WEB_ROOT/"
  chown -R www-data:www-data "$WEB_ROOT"
  nginx -t >/dev/null
  systemctl reload nginx
  log "frontend synced to $WEB_ROOT"
}

smoke() {
  local base="${AETHINK_ORIGIN:-http://127.0.0.1}"
  printf 'landing      %s\n' "$(curl -s -o /dev/null -w '%{http_code}' "$base/")"
  printf 'health       %s\n' "$(curl -s "$base/health")"
  printf 'models       %s model\n' "$(curl -s --retry 3 --retry-connrefused "$base/api/models" | python3 -c 'import sys,json
try: print(json.load(sys.stdin)["count"])
except Exception: print("?")')"
  printf 'packages     %s paket\n' "$(curl -s --retry 3 --retry-connrefused "$base/api/packages" | python3 -c 'import sys,json
try: print(len(json.load(sys.stdin)["packages"]))
except Exception: print("?")')"
}

case "$WHAT" in
  backend)  restart_gateway ;;
  frontend) build_frontend ;;
  all)
    restart_gateway
    build_frontend
    ;;
  *) echo "usage: $0 [all|backend|frontend]"; exit 2 ;;
esac

smoke
log "done"
