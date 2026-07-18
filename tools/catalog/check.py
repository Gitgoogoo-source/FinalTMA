#!/usr/bin/env python3
"""Generate catalog artifacts in a temporary directory and compare read-only."""

from __future__ import annotations

import shutil
import subprocess
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
MIGRATION = ROOT / "supabase/migrations/20260718182513_catalog_v1.sql"
MANIFEST = ROOT / "generated/catalog/catalog-v1.json"


def main() -> None:
    with tempfile.TemporaryDirectory(prefix="pokepets-catalog-") as temporary:
        directory = Path(temporary)
        migration = directory / MIGRATION.name
        manifest = directory / "catalog-v1.json"
        shutil.copy2(MANIFEST, manifest)
        subprocess.run([
            "python3", "tools/catalog/build.py",
            "--migration-path", str(migration),
            "--manifest-path", str(manifest),
        ], cwd=ROOT, check=True)
        drift = [name for name, expected, actual in [
            (MIGRATION.name, MIGRATION, migration),
            ("generated/catalog/catalog-v1.json", MANIFEST, manifest),
        ] if expected.read_bytes() != actual.read_bytes()]
        if drift:
            raise SystemExit("Catalog drift detected: " + ", ".join(drift))
    print("catalog SQL and generated catalog match the frozen product document")


if __name__ == "__main__":
    main()
