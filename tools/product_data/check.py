#!/usr/bin/env python3
"""Regenerate product data artifacts in a temporary directory and compare read-only."""

from __future__ import annotations

import shutil
import subprocess
import tempfile
from pathlib import Path


ROOT = Path(__file__).resolve().parents[2]
MANIFEST = ROOT / "generated/catalog/catalog-v1.json"


def product_data_migration() -> Path:
    matches = sorted((ROOT / "supabase/migrations").glob("*_product_data_v1.sql"))
    if len(matches) != 1:
        raise SystemExit(f"Expected one product data migration, found {len(matches)}")
    return matches[0]


def main() -> None:
    migration_source = product_data_migration()
    with tempfile.TemporaryDirectory(prefix="pokepets-product-data-") as temporary:
        directory = Path(temporary)
        migration = directory / migration_source.name
        manifest = directory / "catalog-v1.json"
        shutil.copy2(MANIFEST, manifest)
        subprocess.run([
            "python3", "tools/product_data/build.py",
            "--migration-path", str(migration),
            "--manifest-path", str(manifest),
        ], cwd=ROOT, check=True)
        drift = [name for name, expected, actual in [
            (migration_source.name, migration_source, migration),
            ("generated/catalog/catalog-v1.json", MANIFEST, manifest),
        ] if expected.read_bytes() != actual.read_bytes()]
        if drift:
            raise SystemExit("Product data drift detected: " + ", ".join(drift))
    print("product data SQL and generated catalog match the frozen product document")


if __name__ == "__main__":
    main()
