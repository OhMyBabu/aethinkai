#!/usr/bin/env python3
"""Cash, liability and margin in one page.

    python gateway/scripts/profit_report.py [--months 6]

The upstream is farmed, so cost-per-token is ~0: what actually decides whether this
business makes money is

  cash in        money that arrived (paid orders)
  deferred       credits sold but not consumed yet — a liability, not profit
  consumed       credits burned as tokens (revenue recognised)
  infra          what the box costs per month (INFRA_COST_MONTHLY_IDR)

Profit is not "revenue": until a credit is spent it is a promise. Selling Rp10jt of
credit and serving Rp1jt means Rp9jt of oxygen you still owe.
"""
from __future__ import annotations

import asyncio
import os
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from app import db  # noqa: E402

MONTHS = int(next((a.split("=")[1] for a in sys.argv if a.startswith("--months=")), 6))
INFRA = int(os.environ.get("INFRA_COST_MONTHLY_IDR", "0") or 0)
IDR = 1_000_000          # micro-IDR per rupiah


def rp(micro: int | None) -> str:
    return f"Rp{(int(micro or 0) / IDR):,.0f}".replace(",", ".")


async def main() -> int:
    await db.init_pool()
    try:
        p = db.pool()
        REAL = """FROM orders o JOIN buyers b ON b.id = o.buyer_id
                  WHERE o.status='granted' AND NOT b.is_test"""
        cash = await p.fetchval(f"SELECT coalesce(sum(o.price_idr),0) {REAL}")
        granted = await p.fetchval(f"SELECT count(*) {REAL}")
        deferred = await p.fetchval("SELECT coalesce(sum(balance_micro),0) FROM balances")
        held = await p.fetchval("SELECT coalesce(sum(amount_micro),0) FROM holds WHERE state='open' AND expires_at > now()")
        consumed = await p.fetchval("SELECT coalesce(sum(cost_micro),0) FROM usage_events")
        reqs = await p.fetchval("SELECT count(*) FROM usage_events")
        buyers = await p.fetchval("SELECT count(*) FROM buyers WHERE NOT is_test")
        active_keys = await p.fetchval("SELECT count(*) FROM api_keys WHERE revoked_at IS NULL AND status='active'")

        print("=== CASH ===")
        print(f"  pesanan lunas        : {granted}  ({rp(cash)})")
        print(f"  saldo belum terpakai : {rp(deferred)}   <- utang layanan, bukan laba")
        print(f"  sedang di-hold       : {rp(held)}")
        print(f"  sudah terpakai       : {rp(consumed)}   <- pendapatan yang benar-benar jasa")
        print(f"  request dilayani     : {reqs}")

        print("\n=== PER BULAN ===")
        rows = await p.fetch(
            """SELECT to_char(date_trunc('month', o.created_at),'YYYY-MM') AS m,
                      count(*) AS orders, coalesce(sum(o.price_idr),0) AS cash
                 FROM orders o JOIN buyers b ON b.id = o.buyer_id
                WHERE o.status='granted' AND NOT b.is_test
                GROUP BY 1 ORDER BY 1 DESC LIMIT $1""", MONTHS)
        use = await p.fetch(
            """SELECT to_char(date_trunc('month', created_at),'YYYY-MM') AS m,
                      coalesce(sum(cost_micro),0) AS consumed, count(*) AS reqs
                 FROM usage_events GROUP BY 1 ORDER BY 1 DESC LIMIT $1""", MONTHS)
        use = {r["m"]: r for r in use}
        print(f"  {'bulan':8} {'order':>6} {'cash in':>14} {'terpakai':>14} {'req':>6} {'laba kotor*':>14}")
        for r in rows:
            u = use.get(r["m"])
            gross = (u["consumed"] if u else 0) - INFRA
            print(f"  {r['m']:8} {r['orders']:>6} {rp(r['cash']):>14} "
                  f"{rp(u['consumed'] if u else 0):>14} {(u['reqs'] if u else 0):>6} {rp(gross):>14}")
        print(f"  * laba kotor = terpakai - infra {rp(INFRA)}/bulan (modal token ~0: hasil farm)")

        print("\n=== MODEL PALING MENGUNTUNGKAN ===")
        rows = await p.fetch(
            """SELECT model_id, count(*) AS reqs,
                      coalesce(sum(tokens_in),0) AS tin, coalesce(sum(tokens_out),0) AS tout,
                      coalesce(sum(cost_micro),0) AS billed
                 FROM usage_events GROUP BY 1 ORDER BY billed DESC LIMIT 8""")
        if rows:
            print(f"  {'model':28} {'req':>5} {'tok in':>12} {'tok out':>12} {'ditagih':>14}")
            for r in rows:
                print(f"  {r['model_id']:28} {r['reqs']:>5} {r['tin']:>12,} {r['tout']:>12,} {rp(r['billed']):>14}")
        else:
            print("  belum ada pemakaian tercatat")

        print("\n=== PELANGGAN ===")
        print(f"  buyer terdaftar      : {buyers}")
        print(f"  key aktif            : {active_keys}")
        top = await p.fetch(
            """SELECT b.tg_id, b.username, coalesce(sum(u.cost_micro),0) AS spent
                 FROM buyers b LEFT JOIN usage_events u ON u.user_id = (
                      SELECT user_id FROM api_keys k WHERE k.buyer_id=b.id AND k.user_id IS NOT NULL LIMIT 1)
                WHERE NOT b.is_test
                GROUP BY 1,2 ORDER BY spent DESC LIMIT 5""")
        for r in top:
            print(f"  tg {r['tg_id']:<12} @{r['username'] or '-':<16} {rp(r['spent'])}")

        print("\n=== VERDICT ===")
        print(f"  uang masuk           : {rp(cash)}")
        print(f"  kewajiban layanan    : {rp(deferred)}")
        print(f"  sudah jadi jasa      : {rp(consumed)}")
        print(f"  infra (env)          : {rp(INFRA)}/bulan")
        print(f"  neraca               : {rp(cash)} masuk - {rp(deferred)} belum diserahkan = "
              f"{rp(cash - deferred)} milik lu")
        return 0
    finally:
        await db.close_pool()


if __name__ == "__main__":
    raise SystemExit(asyncio.run(main()))
