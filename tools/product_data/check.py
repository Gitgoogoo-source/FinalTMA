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
BATTLE_ROOT = ROOT / "generated/battle"
BATTLE_JSON = BATTLE_ROOT / "battle-v1.json"
BATTLE_SHA256 = BATTLE_ROOT / "battle-v1.sha256"
BATTLE_MANIFEST = BATTLE_ROOT / "manifest.json"
BATTLE_SQL = BATTLE_ROOT / "battle-v1.sql"
WEB_EVOLUTION_MANIFEST = (
    ROOT / "apps/web/src/domains/evolution/evolution-catalog-v1.json"
)
PRODUCT = ROOT / "docs/product/功能说明文档.md"


def product_data_migration() -> Path:
    matches = sorted((ROOT / "supabase/migrations").glob("*_product_data_v1.sql"))
    if len(matches) != 1:
        raise SystemExit(f"Expected one product data migration, found {len(matches)}")
    return matches[0]


def main() -> None:
    product_data_source, _ = split_product_document(
        PRODUCT.read_text(encoding="utf-8")
    )
    source_checksum = hashlib.sha256(product_data_source.encode()).hexdigest()
    migration_source = product_data_migration()
    with tempfile.TemporaryDirectory(prefix="pokepets-product-data-") as temporary:
        directory = Path(temporary)
        migration = directory / migration_source.name
        manifest = directory / "catalog-v1.json"
        web_evolution_manifest = directory / "evolution-catalog-v1.json"
        battle_json = directory / "battle-v1.json"
        battle_sha256 = directory / "battle-v1.sha256"
        battle_manifest = directory / "battle-manifest.json"
        battle_sql = directory / "battle-v1.sql"
        shutil.copy2(MANIFEST, manifest)
        subprocess.run([
            "python3", "tools/product_data/build.py",
            "--migration-path", str(migration),
            "--manifest-path", str(manifest),
            "--web-evolution-manifest-path", str(web_evolution_manifest),
            "--battle-json-path", str(battle_json),
            "--battle-sha256-path", str(battle_sha256),
            "--battle-manifest-path", str(battle_manifest),
            "--battle-sql-path", str(battle_sql),
        ], cwd=ROOT, check=True)
        drift = [name for name, expected, actual in [
            (migration_source.name, migration_source, migration),
            ("generated/catalog/catalog-v1.json", MANIFEST, manifest),
            (
                "apps/web/src/domains/evolution/evolution-catalog-v1.json",
                WEB_EVOLUTION_MANIFEST,
                web_evolution_manifest,
            ),
            ("generated/battle/battle-v1.json", BATTLE_JSON, battle_json),
            ("generated/battle/battle-v1.sha256", BATTLE_SHA256, battle_sha256),
            ("generated/battle/manifest.json", BATTLE_MANIFEST, battle_manifest),
            ("generated/battle/battle-v1.sql", BATTLE_SQL, battle_sql),
        ] if expected.read_bytes() != actual.read_bytes()]
        if drift:
            raise SystemExit("Product data drift detected: " + ", ".join(drift))
    print(
        "product data SQL, immutable catalog v1, and battle-v1 artifacts match; "
        f"pre-boundary source checksum: {source_checksum}"
    )


if __name__ == "__main__":
    main()
