#!/usr/bin/env bash
# AethinkAI Gateway — start script (loads secrets, runs uvicorn)
set -euo pipefail
cd "$(dirname "$0")"
set -a
# shellcheck disable=SC1091
. /root/.secrets/aethink-db.env
set +a
exec ./.venv/bin/uvicorn app.main:app --host 127.0.0.1 --port 8080 --log-level warning
