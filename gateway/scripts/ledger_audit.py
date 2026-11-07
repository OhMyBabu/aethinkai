#!/usr/bin/env python3
"""Ledger audit — prove the books, and repair them when they don't balance.

    ./gateway/.venv/bin/python gateway/scripts/ledger_audit.py          # report
    ./gateway/.venv/bin/python gateway/scripts/ledger_audit.py --fix    # post adjustments

Invariant: wallet + open holds == ledger. A hold leaves the wallet the moment it is
created but is only posted when it settles, so an in-flight request makes the naive
`Σbalance == Σledger` look broken. Anything else is a real discrepancy: a crash
between two writes, a manual SQL edit, or a bug that refunded without a ledger row.
"""
from __future__ import annotations

import sys


def main() -> int:
    fix = "--fix" in sys.argv
    db_url = [l.split("=", 1)[1].strip() for l in open("/root/.secrets/aethink-db.env")
              if l.startswith("DATABASE_URL=")][0]

    import subprocess

    def sql(q: str) -> list[list[str]]:
        out = subprocess.run(["psql", db_url, "-tAF", "|", "-c", q],
                             capture_output=True, text=True)
        if out.returncode != 0:
            raise SystemExit(out.stderr.strip())
        return [line.split("|") for line in out.stdout.strip().splitlines() if line]

    rows = sql("""
        with b as (select user_id, balance_micro from balances),
             h as (select user_id, sum(amount_micro) amt from holds where state='held' group by 1),
             l as (select user_id, sum(amount_micro) amt from ledger_entries group by 1),
             u as (select coalesce(b.user_id, h.user_id, l.user_id) user_id,
                          coalesce(b.balance_micro,0) bal, coalesce(h.amt,0) held, coalesce(l.amt,0) led
                     from b full join h on h.user_id = b.user_id
                     full join l on l.user_id = coalesce(b.user_id, h.user_id))
        select user_id, bal, held, led, bal + held - led as drift
          from u where bal + held - led <> 0 order by abs(bal + held - led) desc
    """)

    total = sql("""select (select coalesce(sum(balance_micro),0) from balances)
                        + (select coalesce(sum(amount_micro),0) from holds where state='held')
                        - (select coalesce(sum(amount_micro),0) from ledger_entries);""")
    ts = sql("select now()")[0][0]
    print(f"ledger audit @ {ts}")
    if not rows:
        print("  all users balance (wallet + open holds == ledger)")
        return 0

    print(f"  {len(rows)} user(s) out of balance")
    for user_id, bal, held, led, drift in rows:
        print(f"  {user_id}  wallet={bal} held={held} ledger={led} drift={drift}")
        if fix:
            sql(f"""
                insert into ledger_entries(id, user_id, kind, amount_micro, balance_after, ref, note)
                values (gen_random_uuid()::text, '{user_id}', 'adjustment', {int(drift)},
                        {bal}, 'ledger_audit', 'auto-adjustment: ledger += {int(drift)}')
            """)
            print("    → adjustment posted")
    if fix:
        left = sql("""select count(*) from (
            select b.user_id from balances b
            where b.balance_micro + coalesce((select sum(amount_micro) from holds h
                    where h.user_id=b.user_id and h.state='held'),0)
                  <> coalesce((select sum(amount_micro) from ledger_entries l
                    where l.user_id=b.user_id),0)) z""")
        print(f"  after fix: {left[0][0]} user(s) still out of balance")
    return 0 if fix or not rows else 1


if __name__ == "__main__":
    raise SystemExit(main())
