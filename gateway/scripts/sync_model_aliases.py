#!/usr/bin/env python3
"""Map Aethink catalogue slugs to real routes on the local 9Router.

    python gateway/scripts/sync_model_aliases.py            # report + write mappings
    python gateway/scripts/sync_model_aliases.py --dry-run  # report only

The two catalogues name the same model differently: the shop sells `glm-5.3`,
the router serves `neuralwatt:glm-5.3-flex` / `siliconflow-cn:glm-5.3-flash`.
This script reads the router's live catalogue plus the providers that actually
hold credentials, and records the chosen route in `model_aliases`.

A model with no usable provider stays unmapped on purpose — the gateway then
answers `upstream_unavailable` instead of quietly reaching for another host.
"""
from __future__ import annotations

import asyncio
import json
import os
import sqlite3
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

import httpx  # noqa: E402

from app import db  # noqa: E402

ROUTER = os.environ.get("NINEROUTER_URL", "http://127.0.0.1:20128").rstrip("/")
ROUTER_DB = os.environ.get("NINEROUTER_DB", "/root/.9router/db/data.sqlite")


def router_key() -> str:
    key = os.environ.get("NINEROUTER_KEY")
    if key:
        return key
    con = sqlite3.connect(f"file:{ROUTER_DB}?mode=ro", uri=True)
    try:
        return con.execute("SELECT key FROM apiKeys WHERE isActive = 1 LIMIT 1").fetchone()[0]
    finally:
        con.close()


def live_providers() -> list[str]:
    con = sqlite3.connect(f"file:{ROUTER_DB}?mode=ro", uri=True)
    try:
        rows = con.execute(
            "SELECT provider FROM providerConnections WHERE isActive = 1 ORDER BY priority"
        ).fetchall()
        return [r[0] for r in rows]
    except sqlite3.Error:
        return []
    finally:
        con.close()


def route_provider(route: str) -> str:
    """Provider part of a router route: `mr/x` and `github:x` are both 'mr'/'github'."""
    head = route.split("/", 1)[0] if "/" in route else ""
    if ":" in route:
        return route.split(":", 1)[0]
    return head


def pick(candidates: list[str], providers: list[str]) -> str | None:
    """Shortest route wins: `mr/glm-5.3` beats `some-reseller:glm-5.3-flex`."""
    if not candidates:
        return None
    return sorted(candidates, key=lambda s: (len(s), s))[0]


async def probe(client: httpx.AsyncClient, key: str, route: str) -> tuple[bool, str]:
    """One 1-token call. Advertising a model is not the same as being able to serve it."""
    try:
        r = await client.post("/v1/chat/completions",
                              headers={"Authorization": f"Bearer {key}"},
                              json={"model": route, "max_tokens": 1,
                                    "messages": [{"role": "user", "content": "ping"}]},
                              timeout=60)
        if r.status_code == 200:
            return True, "served"
        body = r.text.replace("\n", " ")[:110]
        return False, f"{r.status_code} {body}"
    except Exception as exc:  # noqa: BLE001
        return False, f"error {exc}"


async def main() -> int:
    dry = "--dry-run" in sys.argv
    key = router_key()
    providers = live_providers()
    client = httpx.AsyncClient(base_url=ROUTER, timeout=60)
    r = await client.get("/v1/models", headers={"Authorization": f"Bearer {key}"})
    r.raise_for_status()
    ids = [m["id"] for m in r.json().get("data", [])]

    meta = {m["id"]: m for m in (await client.get(
        "/v1/models", headers={"Authorization": f"Bearer {key}"})).json().get("data", [])}

    by_tail: dict[str, list[str]] = {}
    for i in ids:
        tail = i.rsplit(":", 1)[-1].rsplit("/", 1)[-1]
        by_tail.setdefault(tail, []).append(i)

    await db.init_pool()
    try:
        rows = await db.pool().fetch(
            "SELECT model_id, public_id FROM model_prices ORDER BY model_id")
        print(f"router: {ROUTER} | models advertised: {len(ids)} | providers with credentials: {providers or '-'}")
        print(f"{'catalogue':28} {'local route':40} status")
        mapped = 0
        for row in rows:
            slug = row["public_id"] or row["model_id"]
            tail = slug.split("/")[-1]
            candidates = by_tail.get(tail, [])
            choice = pick(candidates, providers)
            if choice and "--no-probe" not in sys.argv:
                ok, why = await probe(client, key, choice)
                if not ok:
                    print(f"{slug:28} {choice:40} DEAD: {why}")
                    choice = None
            if not choice:
                if not dry:
                    await db.pool().execute("DELETE FROM model_aliases WHERE model_id = $1",
                                            row["model_id"])
                hint = (f"needs provider among {', '.join(sorted({c.split(':')[0] for c in candidates}))}"
                        if candidates else "not in router catalogue")
                print(f"{slug:28} {'—':40} {hint}")
                continue

            mapped += 1
            m = meta.get(choice) or {}
            caps = m.get("capabilities") or {}
            ctx = m.get("context_length") or caps.get("contextWindow")
            out = m.get("max_completion_tokens") or caps.get("maxOutput")
            if not dry:
                await db.pool().execute(
                    """INSERT INTO model_aliases(model_id, upstream_model, note)
                       VALUES ($1, $2, $3)
                       ON CONFLICT (model_id) DO UPDATE
                          SET upstream_model = EXCLUDED.upstream_model,
                              note = EXCLUDED.note, updated_at = now()""",
                    row["model_id"], choice, f"auto: {len(candidates)} candidates")
                # limits are what the provider actually reports, never a claim
                await db.pool().execute(
                    """UPDATE model_prices
                          SET context_window = $2, max_output = $3,
                              capabilities = $4::jsonb, limits_synced_at = now()
                        WHERE model_id = $1""",
                    row["model_id"], ctx or None, out or None, json.dumps(caps))
            print(f"{slug:28} {choice:40} ok   ctx={ctx or '?'} out={out or '?'}")
        print(f"\n{mapped}/{len(rows)} catalogue entries served by the LOCAL router"
              f"{' (dry run)' if dry else ''}")
        return 0
    finally:
        await client.aclose()
        await db.close_pool()


if __name__ == "__main__":
    raise SystemExit(asyncio.run(main()))
