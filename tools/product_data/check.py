#!/usr/bin/env python3
"""Regenerate product data artifacts in a temporary directory and compare read-only."""

from __future__ import annotations

import hashlib
import shutil
import subprocess
import tempfile
from pathlib import Path

from build import split_product_document


ROOT = Path(__file__).resolve().parents[2]
MANIFEST = ROOT / "generated/catalog/catalog-v1.json"
PRODUCT = ROOT / "docs/product/功能说明文档.md"


def product_data_migration() -> Path:
    matches = sorted((ROOT / "supabase/migrations").glob("*_product_data_v1.sql"))
    if len(matches) != 1:
        raise SystemExit(f"Expected one product data migration, found {len(matches)}")
    return matches[0]


def main() -> None:
    product_data_source, product_extensions = split_product_document(PRODUCT.read_text(encoding="utf-8"))
    if "## 21. Monster Tamer 独立游戏功能说明" not in product_extensions:
        raise SystemExit("Product extension after the checksum boundary must contain chapter 21 Monster Tamer")
    if "## 21. Monster Tamer 独立游戏功能说明" in product_data_source:
        raise SystemExit("Monster Tamer must remain outside the frozen catalog v1 product-data source")
    source_checksum = hashlib.sha256(product_data_source.encode()).hexdigest()
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
    print(
        "product data SQL and generated catalog match the immutable catalog v1 release; "
        f"pre-boundary source checksum: {source_checksum}"
    )


if __name__ == "__main__":
    main()
