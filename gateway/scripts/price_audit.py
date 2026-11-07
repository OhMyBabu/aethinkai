#!/usr/bin/env python3
"""Pricing audit: sell price vs break-even ceiling vs available upstream routes.

No cost figure is invented here. For every priced model we compute the *ceiling*:
the USD/1M the upstream may charge before the sell price stops covering it. That
number is exact, derived from our own `model_prices` and USD_IDR, and it is what
the 9Router price card must be compared against.

Usage:
    ./.venv/bin/python scripts/price_audit.py [--json out.json]
"""
from __future__ import annotations

import argparse
import asyncio
import json
import math
import os
import sys
from collections import defaultdict
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from app import db, upstream  # noqa: E402

USD_IDR = float(os.environ.get("USD_IDR") or 16250)


def usd(idr_per_1m: float) -> float:
    return idr_per_1m / USD_IDR


async def collect() -> dict:
    await db.init_pool()
    try:
        rows = await db.pool().fetch(
            """
            SELECT model_id, public_id, provider_label, display_name,
                   price_in_idr, price_out_idr, price_cached_idr, active
            FROM model_prices ORDER BY price_in_idr DESC
            """
        )
        usage = await db.pool().fetch(
            """
            SELECT model_id, count(*) AS requests,
                   coalesce(sum(tokens_in),0) AS tin,
                   coalesce(sum(tokens_out),0) AS tout,
                   coalesce(sum(cost_micro),0) AS revenue_micro,
                   coalesce(sum(cost_usd),0) AS cost_usd
            FROM usage_events GROUP BY model_id
            """
        )
    finally:
        await db.close_pool()

    try:
        catalog = await upstream.list_models()
        ids = [m["id"] for m in catalog.get("data", [])]
    except Exception as exc:  # upstream down: audit still runs on local prices
        ids = []
        print(f"# upstream catalogue unavailable: {exc}", file=sys.stderr)

    by_slug: dict[str, list[str]] = defaultdict(list)
    for mid in ids:
        provider, _, slug = mid.partition("/")
        by_slug[slug].append(mid)

    usage_map = {r["model_id"]: dict(r) for r in usage}
    models = []
    for r in rows:
        pub = r["public_id"] or r["model_id"].split("/")[-1]
        u = usage_map.get(r["model_id"], {})
        routes = by_slug.get(pub, [])
        free = [x for x in routes if x.endswith(":free")]
        models.append({
            "model_id": r["model_id"],
            "public_id": pub,
            "name": r["display_name"] or pub,
            "provider": r["provider_label"],
            "active": bool(r["active"]),
            "sell_in_idr": int(r["price_in_idr"]),
            "sell_out_idr": int(r["price_out_idr"]),
            "sell_cached_idr": int(r["price_cached_idr"]),
            # exact ceilings: pay more than this per 1M and the request loses money
            "ceiling_usd_in": round(usd(int(r["price_in_idr"])), 4),
            "ceiling_usd_out": round(usd(int(r["price_out_idr"])), 4),
            "ceiling_usd_cached": round(usd(int(r["price_cached_idr"])), 4),
            "out_in_ratio": round(r["price_out_idr"] / r["price_in_idr"], 2) if r["price_in_idr"] else None,
            "routes_available": len(routes),
            "free_routes": free,
            "requests": int(u.get("requests") or 0),
            "tokens_in": int(u.get("tin") or 0),
            "tokens_out": int(u.get("tout") or 0),
            "revenue_idr": round(int(u.get("revenue_micro") or 0) / 1e6, 4),
            "recorded_cost_usd": float(u.get("cost_usd") or 0),
        })
    return {"usd_idr": USD_IDR, "models": models, "upstream_routes": len(ids)}


def render(data: dict) -> str:
    out = []
    out.append(f"# Audit harga — kurs USD_IDR {data['usd_idr']:,.0f}")
    out.append("")
    out.append("`ceiling` = harga jual per 1M token dikonversi ke USD. Kalau modal upstream")
    out.append("(harga beli per 1M) **di atas** angka ini, request itu rugi. Bukan estimasi —")
    out.append("diturunkan langsung dari `model_prices` + kurs yang dipakai gateway.")
    out.append("")
    out.append("| Model | Jual in (Rp/1M) | Jual out (Rp/1M) | ceiling in (USD) | ceiling out (USD) | rasio out/in | route upstream | route gratis |")
    out.append("|---|---|---|---|---|---|---|---|")
    for m in data["models"]:
        free = ", ".join(m["free_routes"][:3]) if m["free_routes"] else "—"
        out.append(
            f"| {m['public_id']} | {m['sell_in_idr']:,} | {m['sell_out_idr']:,} | "
            f"${m['ceiling_usd_in']:.3f} | ${m['ceiling_usd_out']:.3f} | "
            f"{m['out_in_ratio']}x | {m['routes_available']} varian | {free} |"
        )
    out.append("")
    total_rev = sum(m["revenue_idr"] for m in data["models"])
    total_cost = sum(m["recorded_cost_usd"] for m in data["models"])
    out.append(f"- Revenue tercatat: **Rp {total_rev:,.4f}**")
    out.append(f"- Modal tercatat: **${total_cost:,.8f}** (kolom `usage_events.cost_usd`)")
    out.append(f"- Request tercatat: **{sum(m['requests'] for m in data['models'])}**")
    return "\n".join(out)


async def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--json", default="")
    a = ap.parse_args()
    data = await collect()
    print(render(data))
    if a.json:
        Path(a.json).write_text(json.dumps(data, indent=2))
        print(f"\njson → {a.json}")


if __name__ == "__main__":
    asyncio.run(main())
