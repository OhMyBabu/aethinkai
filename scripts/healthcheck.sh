#!/usr/bin/env bash
# AethinkAI — healthcheck. Exit 0 = healthy, 1 = something is off.
#   ./scripts/healthcheck.sh            (human output)
#   ./scripts/healthcheck.sh --quiet    (one line, for cron/telegram)
set -uo pipefail

ORIGIN="${AETHINK_ORIGIN:-https://router.aethink.ai.id}"
QUIET="${1:-}"
FAIL=0
LINES=()

add() { LINES+=("$1"); [ "${2:-ok}" = "fail" ] && FAIL=1; return 0; }
code() { curl -s -o /dev/null -m 10 -w '%{http_code}' "$1"; }

# services
for unit in postgresql nginx aethink-gateway aethink-bot fail2ban; do
    state=$(systemctl is-active "$unit" 2>/dev/null || echo inactive)
    [ "$state" = "active" ] && add "$unit=active" || add "$unit=$state" fail
done

# endpoints
h=$(curl -s -m 10 "$ORIGIN/health" || true)
case "$h" in *'"db":true'*) add "health=db-ok" ;; *) add "health=BAD ($h)" fail ;; esac

m=$(curl -s -m 15 "$ORIGIN/api/models" | python3 -c 'import sys,json;print(json.load(sys.stdin).get("count",-1))' 2>/dev/null || echo -1)
[ "$m" -gt 0 ] 2>/dev/null && add "models=$m" || add "models=none" fail

l=$(code "$ORIGIN/");      [ "$l" = "200" ] && add "landing=200" || add "landing=$l" fail
d=$(code "$ORIGIN/docs");  [ "$d" = "404" ] && add "docs=closed" || add "docs=EXPOSED($d)" fail

# tls expiry
exp=$(echo | openssl s_client -servername "${ORIGIN#https://}" -connect "${ORIGIN#https://}:443" 2>/dev/null \
      | openssl x509 -noout -enddate 2>/dev/null | cut -d= -f2)
if [ -n "$exp" ]; then
    days=$(( ( $(date -d "$exp" +%s) - $(date +%s) ) / 86400 ))
    [ "$days" -gt 14 ] && add "tls=${days}d" || add "tls=${days}d (renew!)" fail
else
    add "tls=unreadable" fail
fi

# firewall + bans
ufw status 2>/dev/null | grep -q "Status: active" && add "ufw=active" || add "ufw=inactive" fail
bans=$(fail2ban-client banned 2>/dev/null | grep -o "'[0-9]" | wc -l)
add "fail2ban_bans=$bans"

# disk + wallet invariant
use=$(df --output=pcent / | tail -1 | tr -dc '0-9')
[ "$use" -lt 90 ] && add "disk=${use}%" || add "disk=${use}%" fail

diff=$(PGPASSWORD="$(grep -oP '(?<=aethink:)[^@]+' /root/.secrets/aethink-db.env)" \
       psql "postgresql://aethink:$(grep -oP '(?<=aethink:)[^@]+' /root/.secrets/aethink-db.env)@127.0.0.1:5432/aethink" -tAc \
       "SELECT (SELECT coalesce(sum(balance_micro),0) FROM balances) + (SELECT coalesce(sum(amount_micro),0) FROM holds WHERE state='held') - (SELECT coalesce(sum(amount_micro),0) FROM ledger_entries);" 2>/dev/null || echo "?")
[ "$diff" = "0" ] && add "ledger=balanced" || add "ledger=DRIFT($diff)" fail

if [ "$QUIET" = "--quiet" ]; then
    printf '%s | %s\n' "$([ "$FAIL" = "0" ] && echo OK || echo FAIL)" "$(IFS=' '; echo "${LINES[*]}")"
else
    for line in "${LINES[@]}"; do echo "  $line"; done
    [ "$FAIL" = "0" ] && echo "HEALTHY" || echo "UNHEALTHY"
fi
exit "$FAIL"
