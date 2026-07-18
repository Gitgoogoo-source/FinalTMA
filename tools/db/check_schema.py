#!/usr/bin/env python3
"""Fail when declarative schemas, generated migrations, or migration inventory drift."""

from __future__ import annotations

import subprocess
import sys
from pathlib import Path


ROOT = Path(__file__).resolve().parents[2]
EXPECTED = {
    "20260718000100_baseline.sql",
    "20260718000200_catalog_v1.sql",
    "20260718000300_api_grants.sql",
}


def main() -> None:
    migrations = ROOT / "supabase/migrations"
    actual = {path.name for path in migrations.glob("*.sql")}
    if actual != EXPECTED:
        print(f"migration inventory mismatch: {sorted(actual)}", file=sys.stderr)
        raise SystemExit(1)
    before = {name: (migrations / name).read_bytes() for name in EXPECTED}
    subprocess.run(["python3", "tools/db/build_baseline.py"], cwd=ROOT, check=True)
    subprocess.run(["python3", "tools/catalog/build.py"], cwd=ROOT, check=True)
    after = {name: (migrations / name).read_bytes() for name in EXPECTED}
    drift = sorted(name for name in EXPECTED if before[name] != after[name])
    if drift:
        print(f"generated migrations were stale: {drift}", file=sys.stderr)
        raise SystemExit(1)
    print("declarative schemas and three migrations are synchronized")


if __name__ == "__main__":
    main()
