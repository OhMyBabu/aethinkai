#!/usr/bin/env bash
# AethinkAI — build a migration bundle: code + config templates + manifest.
# Secrets are NOT included; they travel separately (see MIGRATE.md).
#   ./scripts/migrate-bundle.sh [out-dir]
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
OUT="${1:-/root/backups}"
STAMP="$(date +%Y%m%d-%H%M%S)"
NAME="aethink-code-$STAMP"
mkdir -p "$OUT"

cd "$ROOT"
# git archive = exactly what is committed, no .venv/node_modules/dist
git archive --format=tar.gz --prefix="$NAME/" -o "$OUT/$NAME.tar.gz" HEAD

{
    echo "bundle      : $NAME.tar.gz"
    echo "created     : $(date -Is)"
    echo "git commit  : $(git rev-parse HEAD)"
    echo "git subject : $(git log -1 --pretty=%s)"
    echo "python      : $(python3 -V 2>&1)"
    echo "node        : $(node -v 2>/dev/null || echo 'n/a')"
    echo "postgres    : $(psql --version 2>/dev/null || echo 'n/a')"
    echo "schema      : docs/schema.sql (19 tables)"
    echo
    echo "tidak termasuk (kirim terpisah, jangan lewat git):"
    echo "  /root/.secrets/aethink-db.env        DATABASE_URL, INTERNAL_SECRET, JWT_SECRET, UPSTREAM_*, BOT_TOKEN"
    echo "  /root/.secrets/aethink-internal      HMAC bot<->gateway"
    echo "  /root/.secrets/aethink-bot.env       BOT_TOKEN + admin ids + PORTAL_URL"
    echo "  gateway/.admin                       kredensial admin (chmod 600)"
    echo "  gateway/.devkey                      dev API key"
    echo
    echo "ambil dengan: ./scripts/backup.sh   (dump + secrets + boxconf)"
} > "$OUT/$NAME.manifest.txt"

sha256sum "$OUT/$NAME.tar.gz" | tee "$OUT/$NAME.sha256"
echo "→ $OUT/$NAME.tar.gz"
echo "→ $OUT/$NAME.manifest.txt"
