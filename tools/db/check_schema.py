#!/usr/bin/env python3
"""Fail when declarative schemas, generated migrations, or migration inventory drift."""

from __future__ import annotations

import subprocess
import sys
import tempfile
from pathlib import Path


ROOT = Path(__file__).resolve().parents[2]
EXPECTED = {
    "20260718182511_baseline.sql",
    "20260718182513_catalog_v1.sql",
    "20260718182514_api_grants.sql",
}


def main() -> None:
    migrations = ROOT / "supabase/migrations"
    actual = {path.name for path in migrations.glob("*.sql")}
    if actual != EXPECTED:
        print(f"migration inventory mismatch: {sorted(actual)}", file=sys.stderr)
        raise SystemExit(1)
    with tempfile.TemporaryDirectory(prefix="pokepets-db-check-") as temporary:
        output = Path(temporary)
        subprocess.run(["python3", "tools/db/build_baseline.py", "--output-dir", str(output)], cwd=ROOT, check=True)
        subprocess.run([
            "python3", "tools/catalog/build.py",
            "--migration-path", str(output / "20260718182513_catalog_v1.sql"),
            "--manifest-path", str(output / "catalog-v1.json"),
        ], cwd=ROOT, check=True)
        drift = sorted(name for name in EXPECTED if (migrations / name).read_bytes() != (output / name).read_bytes())
    if drift:
        print(f"generated migrations were stale: {drift}", file=sys.stderr)
        raise SystemExit(1)
    print("declarative schemas and three migrations are synchronized without repository writes")


if __name__ == "__main__":
    main()
