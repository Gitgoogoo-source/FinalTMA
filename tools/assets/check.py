#!/usr/bin/env python3
"""Validate development placeholders and production asset locks."""

from __future__ import annotations

import argparse
import hashlib
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
PUBLIC = ROOT / "apps/web/public"
CATALOG = ROOT / "generated/catalog/catalog-v1.json"
PLACEHOLDERS = ROOT / "generated/assets/placeholders.json"
PLACEHOLDER_PATHS = [
    "apps/web/public/assets/dev/placeholder.webp",
    "apps/web/public/assets/share/preview.webp",
    "apps/web/public/assets/ton/tonconnect-icon.png",
]


def digest(path: Path) -> str:
    if not path.is_file() or path.stat().st_size == 0:
        raise SystemExit(f"Missing or empty asset: {path.relative_to(ROOT)}")
    return hashlib.sha256(path.read_bytes()).hexdigest()


def placeholder_hashes() -> dict[str, str]:
    return {name: digest(ROOT / name) for name in PLACEHOLDER_PATHS}


def required_assets() -> list[str]:
    catalog = json.loads(CATALOG.read_text(encoding="utf-8"))
    paths = [f"apps/web/public{item['image_path']}" for item in catalog["templates"]]
    paths += [
        "apps/web/public/assets/boxes/normal.webp",
        "apps/web/public/assets/boxes/rare.webp",
        "apps/web/public/assets/boxes/legendary.webp",
        "apps/web/public/assets/share/preview.webp",
        "apps/web/public/assets/ton/tonconnect-icon.png",
    ]
    if len(paths) != 215 or len(set(paths)) != 215:
        raise SystemExit("Expected exactly 215 unique production assets")
    return paths


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("mode", choices=["development", "production"])
    parser.add_argument("--pin-placeholders", action="store_true")
    args = parser.parse_args()
    if args.pin_placeholders:
        PLACEHOLDERS.parent.mkdir(parents=True, exist_ok=True)
        PLACEHOLDERS.write_text(json.dumps({"files": placeholder_hashes()}, indent=2) + "\n", encoding="utf-8")
    if not PLACEHOLDERS.is_file():
        raise SystemExit("Placeholder hashes are not pinned")
    expected_placeholders = json.loads(PLACEHOLDERS.read_text(encoding="utf-8")).get("files")
    if not isinstance(expected_placeholders, dict) or expected_placeholders != placeholder_hashes():
        raise SystemExit("Development placeholder hash drift detected")
    if args.mode == "development":
        print("development placeholder assets are present and pinned")
        return
    catalog = json.loads(CATALOG.read_text(encoding="utf-8"))
    expected_assets = catalog.get("assets")
    required = required_assets()
    if not isinstance(expected_assets, dict) or set(expected_assets) != set(required):
        raise SystemExit("Production asset hashes are not pinned for all 215 files")
    forbidden = set(expected_placeholders.values())
    for name in required:
        actual = digest(ROOT / name)
        if actual in forbidden:
            raise SystemExit(f"Production asset is still a development placeholder: {name}")
        if expected_assets[name] != actual:
            raise SystemExit(f"Production asset hash mismatch: {name}")
    print("all 215 production assets are present, non-placeholder, and hash-locked")


if __name__ == "__main__":
    main()
