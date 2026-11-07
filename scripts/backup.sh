#!/usr/bin/env bash
# AethinkAI — backup Postgres + credentials + nginx/systemd config.
#   ./scripts/backup.sh [target-dir]     (default /root/backups/aethink)
# Keeps 14 daily dumps. Everything lands chmod 600 inside a 700 directory.
set -euo pipefail

DEST="${1:-/root/backups/aethink}"
STAMP="$(date +%Y%m%d-%H%M%S)"
DB_URL="$(grep '^DATABASE_URL=' /root/.secrets/aethink-db.env | cut -d= -f2-)"
mkdir -p "$DEST" && chmod 700 "$DEST"

log() { printf '\033[38;5;208m[backup]\033[0m %s\n' "$*"; }

# 1. database — custom format, restorable with pg_restore, no owner/ACL noise
pg_dump --format=custom --no-owner --no-privileges --dbname="$DB_URL" \
        --file="$DEST/aethink-$STAMP.dump"
chmod 600 "$DEST/aethink-$STAMP.dump"
log "db  → $DEST/aethink-$STAMP.dump ($(du -h "$DEST/aethink-$STAMP.dump" | cut -f1))"

# 2. secrets + credentials (the files a migration cannot regenerate)
tar -czf "$DEST/secrets-$STAMP.tar.gz" \
    -C / root/.secrets \
    /root/ops/aethinkai/gateway/.admin \
    /root/ops/aethinkai/gateway/.devkey 2>/dev/null || true
chmod 600 "$DEST/secrets-$STAMP.tar.gz"
chmod 600 "$DEST/boxconf-$STAMP.tar.gz" 2>/dev/null || true
log "secrets → $DEST/secrets-$STAMP.tar.gz"

# 3. box config that is not in git
tar -czf "$DEST/boxconf-$STAMP.tar.gz" \
    /etc/nginx/sites-available/aethink.conf \
    /etc/nginx/conf.d/aethink-limits.conf \
    /etc/systemd/system/aethink-gateway.service \
    /etc/systemd/system/aethink-bot.service \
    /etc/fail2ban/jail.d/aethink.local \
    /etc/fail2ban/filter.d/nginx-req-limit.conf 2>/dev/null || true
log "boxconf → $DEST/boxconf-$STAMP.tar.gz"

# 4. retention
find "$DEST" -name 'aethink-*.dump' -mtime +14 -delete
find "$DEST" -name 'secrets-*.tar.gz' -mtime +14 -delete
find "$DEST" -name 'boxconf-*.tar.gz' -mtime +14 -delete

log "done — $(ls -1 "$DEST" | wc -l) artefak di $DEST"
