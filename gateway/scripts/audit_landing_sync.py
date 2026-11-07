#!/usr/bin/env python3
"""Audit: does the landing page tell the truth about the gateway?

The landing is the shop window. Every number on it — model count, price per 1M,
context window, on/gangguan status, success rate, p95 — must be derivable from the
database, with no fixture, no cache and no hardcoded marketing value in between.

Checks
  1. /api/models  vs model_prices   (id, prices, availability, context, max_output)
  2. /api/status  vs model_prices   (models_active counts only availability='on')
  3. frontend source: no fixture catalogue may feed a public page
  4. no private/upstream leak in the public payload (no upstream route, no cost)
  5. /api/packages vs packages + topup_policy (price, credit, RPM, min top-up)

Exit code 0 = in sync, 1 = drift found.

    gateway/.venv/bin/python gateway/scripts/audit_landing_sync.py
"""

from __future__ import annotations

import json
import os
import re
import sys
import urllib.request
from pathlib import Path

BASE = os.environ.get("GW", "https://router.aethink.ai.id")
ROOT = Path(__file__).resolve().parents[2]
FRONTEND = ROOT / "frontend" / "src"

# (db column, key inside /api/models pricing_idr_per_1m)
FIELDS = (("price_in_idr", "input"),
          ("price_out_idr", "output"),
          ("price_cached_idr", "cached_input"))

failures: list[str] = []


def db_url() -> str:
    path = os.environ.get("AETHINK_DB_ENV", "/root/.secrets/aethink-db.env")
    with open(path, "r", encoding="utf-8") as fh:
        for line in fh:
            if line.startswith("DATABASE_URL="):
                return line.split("=", 1)[1].strip().strip('"').strip("'")
    return os.environ.get("DATABASE_URL", "")


def psql_json(sql: str) -> list[dict]:
    import subprocess

    out = subprocess.run(
        ["psql", db_url(), "-tA", "-c",
         f"SELECT coalesce(json_agg(t), '[]'::json) FROM ({sql}) t"],
        capture_output=True, text=True, check=True).stdout
    return json.loads(out or "[]")


def get(path: str) -> dict:
    with urllib.request.urlopen(f"{BASE}{path}", timeout=20) as resp:
        return json.loads(resp.read())


def check(ok: bool, label: str, detail: str = "") -> None:
    print(f"{'PASS' if ok else 'FAIL'}  {label}{('  [' + detail + ']') if detail else ''}")
    if not ok:
        failures.append(label)


def main() -> int:
    rows = {r["public_id"]: r for r in psql_json(
        """SELECT public_id, price_in_idr, price_out_idr, price_cached_idr,
                  availability, context_window, max_output
             FROM model_prices WHERE public_id IS NOT NULL""")}
    public = {m["id"]: m for m in get("/api/models")["data"]}

    check(set(rows) - {"_"} != set(), "katalog DB tidak kosong", str(len(rows)))

    # 1. catalogue
    off_db = {k for k, v in rows.items() if v["availability"] == "off"}
    check(not (set(public) & off_db), "model off tidak bocor ke katalog publik",
          ", ".join(sorted(set(public) & off_db)) or "bersih")

    missing = set(rows) - off_db - set(public)
    check(not missing, "semua model on/gangguan tampil di /api/models", ", ".join(sorted(missing)) or "lengkap")

    drift = []
    for name, api in public.items():
        row = rows.get(name)
        if not row:
            drift.append(f"{name}: tidak ada di DB")
            continue
        for column, api_key in FIELDS:
            if int(api["pricing_idr_per_1m"][api_key]) != row[column]:
                drift.append(f"{name}.{column}: api {api['pricing_idr_per_1m'][api_key]} db {row[column]}")
        if api["status"] != row["availability"]:
            drift.append(f"{name}.status: api {api['status']} db {row['availability']}")
        if int(api["context_length"] or 0) != int(row["context_window"] or 0):
            drift.append(f"{name}.context: api {api['context_length']} db {row['context_window']}")
        if int(api["max_completion_tokens"] or 0) != int(row["max_output"] or 0):
            drift.append(f"{name}.max_output: api {api['max_completion_tokens']} db {row['max_output']}")
    check(not drift, "harga/status/context di /api/models == DB", "; ".join(drift[:4]) or "identik")

    # 2. status panel
    status = get("/api/status")
    expected_active = sum(1 for v in rows.values()
                          if v["availability"] == "on" and (v["price_in_idr"] > 0 or v["price_out_idr"] > 0))
    check(status.get("models_active") == expected_active,
          "models_active == model on berharga", f"{status.get('models_active')} vs {expected_active}")
    check("window_minutes" in status and "window_error_pct" in status,
          "status memakai jendela 15 menit, bukan tail 24 jam",
          f"{status.get('window_requests')} req / {status.get('window_error_pct')}%")

    # 3. no fixtures in public data path
    bad = []
    for path in FRONTEND.rglob("*.ts*"):
        if "fixtures" in path.name:
            continue
        text = path.read_text(encoding="utf-8", errors="ignore")
        if "SEED_MODELS" in text:
            bad.append(str(path.relative_to(ROOT)))
    check(not bad, "tidak ada halaman yang memakai SEED_MODELS", ", ".join(bad) or "bersih")

    # 5. packages: the shop must quote the same numbers the admin owns
    shop = get("/api/packages")
    db_pkgs = {r["sku"]: r for r in psql_json(
        "SELECT sku, name, price_idr, credits_micro, rpm_limit, active "
        "FROM packages WHERE active ORDER BY sort, price_idr")}
    api_pkgs = {p["sku"]: p for p in shop.get("packages", [])}
    check(set(db_pkgs) == set(api_pkgs),
          "paket di /api/packages == paket aktif di DB",
          f"db={len(db_pkgs)} api={len(api_pkgs)}")
    bad_pkg = []
    for sku, row in db_pkgs.items():
        p = api_pkgs.get(sku) or {}
        if (int(p.get("price_idr", -1)) != int(row["price_idr"])
                or int(p.get("credits_micro", -1)) != int(row["credits_micro"])
                or int(p.get("rpm_limit", -1)) != int(row["rpm_limit"])
                or int(p.get("idr", -1)) != int(row["price_idr"])
                or int(p.get("rpm", -1)) != int(row["rpm_limit"])):
            bad_pkg.append(sku)
    check(not bad_pkg, "harga/kredit/RPM paket identik DB & API", ", ".join(bad_pkg) or "cocok")
    check(all(int(p["rpm_limit"]) > 0 and int(p["price_idr"]) > 0 and int(p["credits_micro"]) > 0
              for p in api_pkgs.values()),
          "setiap paket punya harga, kredit, dan RPM", f"{len(api_pkgs)} paket")
    rpms = {int(p["rpm_limit"]) for p in api_pkgs.values()}
    check(len(rpms) <= 1, "RPM flat: semua paket memakai angka yang sama",
          f"rpm={sorted(rpms)}")
    policy = shop.get("topup") or {}
    db_policy = (psql_json("SELECT min_idr, max_idr, enabled FROM topup_policy WHERE id = 1") or [{}])[0]
    check(bool(policy) and int(policy.get("min_idr", -1)) == int(db_policy.get("min_idr", -2))
          and bool(policy.get("enabled")) == bool(db_policy.get("enabled")),
          "aturan top-up identik DB & API",
          f"min={policy.get('min_idr')} enabled={policy.get('enabled')}")

    # 6. no package price hardcoded in the guide page
    docs = (FRONTEND / "pages" / "public" / "Docs.tsx").read_text(encoding="utf-8", errors="ignore")
    hard = [lit for lit in ('"Starter"', '"Pro"', '"Max"') if lit in docs]
    check(not hard, "panduan tidak punya daftar paket hardcoded", ", ".join(hard) or "bersih")

    # 4. no upstream/cost leakage in the public payload
    blob = json.dumps(public)
    leaks = [p for p in ("mr/", "ky/", "upstream", "cost", "myrikko") if p in blob]
    check(not leaks, "payload publik tidak membocorkan route/cost provider", ", ".join(leaks) or "bersih")

    print()
    if failures:
        print(f"DRIFT: {len(failures)} masalah")
        return 1
    print(f"IN SYNC: {len(public)} model diperiksa, landing == backend")
    return 0


if __name__ == "__main__":
    sys.exit(main())
