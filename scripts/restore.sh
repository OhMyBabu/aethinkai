#!/usr/bin/env bash
# AethinkAI — restore a backup onto a fresh box.
#   ./scripts/restore.sh /root/backups/aethink/aethink-20261107-1200.dump
#   ./scripts/restore.sh /root/backups/aethink/secrets-20261107-1200.tar.gz
#
# The DB restore assumes the role/db already exist (see DEPLOY.md step 2) and
# DROPS the current public schema — it is meant for a fresh server, not a live one.
set -euo pipefail

SRC="${1:?usage: restore.sh <dump|secrets.tar.gz>}"
DB_URL="$(grep '^DATABASE_URL=' /root/.secrets/aethink-db.env | cut -d= -f2-)"

log() { printf '\033[38;5;208m[restore]\033[0m %s\n' "$*"; }

case "$SRC" in
  *.dump)
    log "restoring database from $SRC"
    psql "$DB_URL" -q -c "DROP SCHEMA public CASCADE; CREATE SCHEMA public;"
    pg_restore --no-owner --no-privileges --clean --if-exists --dbname="$DB_URL" "$SRC" || true
    log "tables: $(psql "$DB_URL" -tAc "select count(*) from information_schema.tables where table_schema='public'")"
    log "users:  $(psql "$DB_URL" -tAc "select count(*) from users")"
    log "ledger invariant: $(psql "$DB_URL" -tAc "SELECT (SELECT coalesce(sum(balance_micro),0) FROM balances) - (SELECT coalesce(sum(amount_micro),0) FROM ledger_entries)") (must be 0)"
    ;;
  *.tar.gz)
    log "restoring secrets from $SRC"
    tar -xzf "$SRC" -C /
    chmod 700 /root/.secrets
    chmod 600 /root/.secrets/* 2>/dev/null || true
    log "secrets in place: $(ls /root/.secrets | tr '\n' ' ')"
    ;;
  *)
    echo "unknown archive: $SRC" >&2; exit 2 ;;
esac

log "next: ./deploy.sh && ./scripts/healthcheck.sh"
