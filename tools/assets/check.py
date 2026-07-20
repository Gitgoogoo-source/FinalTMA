#!/usr/bin/env python3
"""Validate development placeholders and production asset locks."""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
PUBLIC = ROOT / "apps/web/public"
BUILD = ROOT / "apps/web/dist"
CATALOG = ROOT / "generated/catalog/catalog-v1.json"
PLACEHOLDERS = ROOT / "generated/assets/placeholders.json"
DEVELOPMENT_CATALOG = ROOT / "generated/assets/catalog-v1.development.json"
PLACEHOLDER_PATHS = [
    "apps/web/public/assets/dev/placeholder.webp",
    "apps/web/public/assets/share/preview.webp",
    "apps/web/public/assets/ton/tonconnect-icon.png",
]


def digest(path: Path) -> str:
    if not path.is_file() or path.stat().st_size == 0:
        raise SystemExit(f"Missing or empty asset: {path.relative_to(ROOT)}")
    return hashlib.sha256(path.read_bytes()).hexdigest()


def assert_format(path: Path) -> None:
    data = path.read_bytes()
    if path.suffix == ".webp" and not (
        len(data) >= 20
        and data[:4] == b"RIFF"
        and int.from_bytes(data[4:8], "little") + 8 == len(data)
        and data[8:12] == b"WEBP"
        and data[12:16] in {b"VP8 ", b"VP8L", b"VP8X"}
    ):
        raise SystemExit(f"Asset is not a valid WebP container: {path.relative_to(ROOT)}")
    if path.suffix == ".png" and not data.startswith(b"\x89PNG\r\n\x1a\n"):
        raise SystemExit(f"Asset is not a valid PNG: {path.relative_to(ROOT)}")
    if path.suffix not in {".webp", ".png"}:
        raise SystemExit(f"Unsupported production asset format: {path.relative_to(ROOT)}")


def placeholder_hashes() -> dict[str, str]:
    return {name: digest(ROOT / name) for name in PLACEHOLDER_PATHS}


def required_assets() -> tuple[list[str], list[str]]:
    catalog = json.loads(CATALOG.read_text(encoding="utf-8"))
    templates = catalog.get("templates")
    if not isinstance(templates, list) or len(templates) != 210:
        raise SystemExit("Expected exactly 210 catalog templates")
    catalog_paths = []
    for item in templates:
        template_id = item.get("id")
        image_path = item.get("image_path")
        expected = f"/assets/catalog/v1/{str(template_id).lower()}.webp"
        if not re.fullmatch(r"PET-[NAT]-\d{3}-[123]", str(template_id)) or image_path != expected:
            raise SystemExit(f"Catalog image path does not match template_id: {template_id}")
        catalog_paths.append(f"apps/web/public{image_path}")
    if len(set(catalog_paths)) != 210:
        raise SystemExit("Catalog image paths are not unique")
    paths = catalog_paths + [
        "apps/web/public/assets/boxes/normal.webp",
        "apps/web/public/assets/boxes/rare.webp",
        "apps/web/public/assets/boxes/legendary.webp",
        "apps/web/public/assets/share/preview.webp",
        "apps/web/public/assets/ton/tonconnect-icon.png",
    ]
    if len(paths) != 215 or len(set(paths)) != 215:
        raise SystemExit("Expected exactly 215 unique production assets")
    return catalog_paths, paths


def development_catalog(catalog_paths: list[str]) -> dict[str, str]:
    manifest = json.loads(DEVELOPMENT_CATALOG.read_text(encoding="utf-8")) if DEVELOPMENT_CATALOG.is_file() else {}
    files = manifest.get("files")
    if (
        manifest.get("catalog_version") != "v1"
        or manifest.get("environment") != "development"
        or not isinstance(files, dict)
        or set(files) != set(catalog_paths)
        or any(not re.fullmatch(r"[0-9a-f]{64}", str(checksum)) for checksum in files.values())
        or len(set(files.values())) != 210
    ):
        raise SystemExit("Development catalog checksum manifest is missing, incomplete, or non-unique")
    return files


def assert_catalog_tree(root: Path, catalog_paths: list[str]) -> None:
    expected = {Path(name).relative_to("apps/web/public").as_posix() for name in catalog_paths}
    catalog_root = root / "assets/catalog/v1"
    actual = {path.relative_to(root).as_posix() for path in catalog_root.rglob("*") if path.is_file()} if catalog_root.is_dir() else set()
    if actual != expected:
        missing = sorted(expected - actual)
        extra = sorted(actual - expected)
        raise SystemExit(f"Catalog asset tree mismatch; missing={missing}, extra={extra}")


def assert_build(required: list[str], source_hashes: dict[str, str], catalog_paths: list[str]) -> None:
    assert_catalog_tree(BUILD, catalog_paths)
    for name in required:
        built = BUILD / Path(name).relative_to("apps/web/public")
        if digest(built) != source_hashes[name]:
            raise SystemExit(f"Built asset is missing or differs from public source: {built.relative_to(ROOT)}")
        assert_format(built)


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("mode", choices=["development", "production", "environment"])
    parser.add_argument("--pin-placeholders", action="store_true")
    args = parser.parse_args()
    if args.mode == "environment":
        environment = os.environ.get("APP_ENV")
        if environment not in {"development", "test", "production"}:
            raise SystemExit("APP_ENV must be development, test, or production for the delivery asset gate")
        args.mode = "development" if environment == "development" else "production"
    if args.pin_placeholders:
        PLACEHOLDERS.parent.mkdir(parents=True, exist_ok=True)
        PLACEHOLDERS.write_text(json.dumps({"files": placeholder_hashes()}, indent=2) + "\n", encoding="utf-8")
    if not PLACEHOLDERS.is_file():
        raise SystemExit("Placeholder hashes are not pinned")
    expected_placeholders = json.loads(PLACEHOLDERS.read_text(encoding="utf-8")).get("files")
    if not isinstance(expected_placeholders, dict) or expected_placeholders != placeholder_hashes():
        raise SystemExit("Development placeholder hash drift detected")
    catalog = json.loads(CATALOG.read_text(encoding="utf-8"))
    expected_assets = catalog.get("assets")
    catalog_paths, required = required_assets()
    if (
        not isinstance(expected_assets, dict)
        or set(expected_assets) != set(required)
        or any(not re.fullmatch(r"[0-9a-f]{64}", str(checksum)) for checksum in expected_assets.values())
    ):
        raise SystemExit("Production asset hashes are not pinned for all 215 files")
    assert_catalog_tree(PUBLIC, catalog_paths)
    approved_development = development_catalog(catalog_paths)
    source_hashes = {}
    for name in required:
        actual = digest(ROOT / name)
        assert_format(ROOT / name)
        if expected_assets[name] != actual:
            raise SystemExit(f"Production asset hash mismatch: {name}")
        source_hashes[name] = actual
    if len({source_hashes[name] for name in catalog_paths}) != 210:
        raise SystemExit("Catalog assets must contain 210 unique files")
    assert_build(required, source_hashes, catalog_paths)
    known_development = set(expected_placeholders.values()) | set(approved_development.values())
    if args.mode == "development":
        mismatched = sorted(name for name, checksum in approved_development.items() if source_hashes[name] != checksum)
        if mismatched:
            raise SystemExit("Development catalog differs from the approved development-only checksum set:\n" + "\n".join(mismatched))
        print("all 215 development assets are path-valid, format-valid, unique, hash-locked, and present in the build")
        return
    placeholders = sorted(name for name, actual in source_hashes.items() if actual in known_development)
    if placeholders:
        raise SystemExit("Formal production assets still contain development-only checksums:\n" + "\n".join(placeholders))
    print("all 215 formal production assets are path-valid, format-valid, unique, hash-locked, and present in the build")


if __name__ == "__main__":
    main()
