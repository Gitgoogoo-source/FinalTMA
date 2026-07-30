#!/usr/bin/env python3
"""Validate formal catalog masters, runtime variants, and release asset locks."""

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
SOURCE = ROOT / "assets/source/catalog/v1"
CATALOG = ROOT / "generated/catalog/catalog-v1.json"
PLACEHOLDERS = ROOT / "generated/assets/placeholders.json"
BRAND_MANIFEST = ROOT / "generated/assets/brand-v1.json"
DEVELOPMENT_PLACEHOLDER_PATH = "apps/web/public/assets/dev/placeholder.webp"
PLACEHOLDER_PATHS = [
    DEVELOPMENT_PLACEHOLDER_PATH,
    "apps/web/public/assets/share/preview.webp",
    "apps/web/public/assets/ton/tonconnect-icon.png",
]
BRAND_ASSETS = {
    "apps/web/public/assets/share/preview.webp": ("webp", 1200, 630),
    "apps/web/public/assets/ton/tonconnect-icon.png": ("png", 180, 180),
}
VARIANTS = {
    "image_thumbnail_path": ("thumb", 256, 50 * 1024),
    "image_detail_path": ("detail", 768, 180 * 1024),
}
CATALOG_TOTAL_LIMIT = 50 * 1024 * 1024


def digest(path: Path) -> str:
    if not path.is_file() or path.stat().st_size == 0:
        raise SystemExit(f"Missing or empty asset: {path.relative_to(ROOT)}")
    return hashlib.sha256(path.read_bytes()).hexdigest()


def webp_dimensions(data: bytes) -> tuple[int, int]:
    offset = 12
    while offset + 8 <= len(data):
        chunk = data[offset : offset + 4]
        size = int.from_bytes(data[offset + 4 : offset + 8], "little")
        payload = offset + 8
        if payload + size > len(data):
            break
        if chunk == b"VP8X" and size >= 10:
            return 1 + int.from_bytes(data[payload + 4 : payload + 7], "little"), 1 + int.from_bytes(data[payload + 7 : payload + 10], "little")
        if chunk == b"VP8L" and size >= 5 and data[payload] == 0x2F:
            bits = int.from_bytes(data[payload + 1 : payload + 5], "little")
            return (bits & 0x3FFF) + 1, ((bits >> 14) & 0x3FFF) + 1
        if chunk == b"VP8 " and size >= 10 and data[payload + 3 : payload + 6] == b"\x9d\x01\x2a":
            return int.from_bytes(data[payload + 6 : payload + 8], "little") & 0x3FFF, int.from_bytes(data[payload + 8 : payload + 10], "little") & 0x3FFF
        offset = payload + size + (size % 2)
    raise SystemExit("WebP dimensions are missing or invalid")


def png_dimensions(data: bytes) -> tuple[int, int]:
    if len(data) < 33 or data[12:16] != b"IHDR" or int.from_bytes(data[8:12], "big") != 13:
        raise SystemExit("PNG IHDR is missing or invalid")
    return int.from_bytes(data[16:20], "big"), int.from_bytes(data[20:24], "big")


def has_alpha(path: Path, data: bytes) -> bool:
    if path.suffix == ".png":
        return data[25] in {4, 6} or b"tRNS" in data
    offset = 12
    while offset + 8 <= len(data):
        chunk = data[offset : offset + 4]
        size = int.from_bytes(data[offset + 4 : offset + 8], "little")
        payload = offset + 8
        if payload + size > len(data):
            break
        if chunk == b"ALPH" or (chunk == b"VP8X" and size >= 1 and data[payload] & 0x10):
            return True
        offset = payload + size + (size % 2)
    return False


def assert_format(path: Path) -> tuple[int, int] | None:
    data = path.read_bytes()
    if path.suffix == ".webp":
        if not (len(data) >= 20 and data[:4] == b"RIFF" and int.from_bytes(data[4:8], "little") + 8 == len(data) and data[8:12] == b"WEBP"):
            raise SystemExit(f"Asset is not a valid WebP container: {path.relative_to(ROOT)}")
        return webp_dimensions(data)
    if path.suffix == ".png":
        if not data.startswith(b"\x89PNG\r\n\x1a\n"):
            raise SystemExit(f"Asset is not a valid PNG: {path.relative_to(ROOT)}")
        return png_dimensions(data)
    raise SystemExit(f"Unsupported production asset format: {path.relative_to(ROOT)}")


def placeholder_fingerprints() -> dict[str, str]:
    document = json.loads(PLACEHOLDERS.read_text(encoding="utf-8"))
    files = document.get("files")
    if (
        not isinstance(files, dict)
        or set(files) != set(PLACEHOLDER_PATHS)
        or any(not isinstance(value, str) or re.fullmatch(r"[0-9a-f]{64}", value) is None for value in files.values())
    ):
        raise SystemExit("Placeholder fingerprints are incomplete or invalid")
    return files


def rejected_placeholder_paths(source_hashes: dict[str, str], fingerprints: dict[str, str]) -> list[str]:
    rejected = set(fingerprints.values())
    return sorted(name for name, actual in source_hashes.items() if actual in rejected)


def assert_brand_manifest(source_hashes: dict[str, str]) -> None:
    if not BRAND_MANIFEST.is_file():
        raise SystemExit("Formal brand asset provenance is missing")
    document = json.loads(BRAND_MANIFEST.read_text(encoding="utf-8"))
    palette = document.get("palette")
    generation = document.get("generation")
    rights = document.get("rights")
    assets = document.get("assets")
    if document.get("schema_version") != 1 or document.get("brand") != "PokePets":
        raise SystemExit("Formal brand asset provenance identity is invalid")
    if palette != {
        "source": "apps/web/src/shared/styles/global.css",
        "primary": "#FF7A00",
        "secondary": "#4DBB39",
        "ink": "#36434B",
        "paper": "#FFFDFA",
    }:
        raise SystemExit("Formal brand palette differs from the locked UI design tokens")
    if (
        not isinstance(generation, dict)
        or generation.get("mode") != "built-in imagegen"
        or generation.get("generated_on") != "2026-07-30"
        or generation.get("third_party_inputs") != []
        or not isinstance(generation.get("prompts"), dict)
        or set(generation["prompts"]) != {"icon", "share"}
        or any(not isinstance(prompt, str) or not prompt.strip() for prompt in generation["prompts"].values())
    ):
        raise SystemExit("Formal brand generation provenance is incomplete")
    if rights != {
        "usage": "PokePets project-owned",
        "third_party_licenses": [],
        "license_source": None,
    }:
        raise SystemExit("Formal brand rights record is incomplete or claims an external license")
    if not isinstance(assets, dict) or set(assets) != set(BRAND_ASSETS):
        raise SystemExit("Formal brand asset provenance paths are incomplete")
    for name, (expected_format, width, height) in BRAND_ASSETS.items():
        path = ROOT / name
        item = assets[name]
        if (
            not isinstance(item, dict)
            or item.get("format") != expected_format
            or item.get("width") != width
            or item.get("height") != height
            or item.get("opaque") is not True
            or item.get("sha256") != source_hashes[name]
            or not isinstance(item.get("source_artifact_sha256"), str)
            or re.fullmatch(r"[0-9a-f]{64}", item["source_artifact_sha256"]) is None
            or not isinstance(item.get("postprocessing"), list)
            or not item["postprocessing"]
        ):
            raise SystemExit(f"Formal brand asset provenance mismatch: {name}")
        if assert_format(path) != (width, height) or has_alpha(path, path.read_bytes()):
            raise SystemExit(f"Formal brand asset must be exact-size and opaque: {name}")


def required_assets() -> tuple[list[dict[str, object]], list[str], list[str]]:
    catalog = json.loads(CATALOG.read_text(encoding="utf-8"))
    templates = catalog.get("templates")
    if not isinstance(templates, list) or len(templates) != 210:
        raise SystemExit("Expected exactly 210 catalog templates")
    catalog_paths: list[str] = []
    for item in templates:
        template_id = str(item.get("id"))
        if not re.fullmatch(r"PET-[NAT]-\d{3}-[123]", template_id):
            raise SystemExit(f"Invalid catalog template_id: {template_id}")
        for key, (variant, _, _) in VARIANTS.items():
            expected = f"/assets/catalog/v1/{variant}/{template_id.lower()}.webp"
            if item.get(key) != expected:
                raise SystemExit(f"Catalog {key} does not match template_id: {template_id}")
            catalog_paths.append(f"apps/web/public{expected}")
    if len(catalog_paths) != 420 or len(set(catalog_paths)) != 420:
        raise SystemExit("Expected exactly 420 unique catalog runtime paths")
    required = catalog_paths + [
        "apps/web/public/assets/boxes/normal.webp",
        "apps/web/public/assets/boxes/rare.webp",
        "apps/web/public/assets/boxes/legendary.webp",
        "apps/web/public/assets/share/preview.webp",
        "apps/web/public/assets/ton/tonconnect-icon.png",
    ]
    if len(required) != 425 or len(set(required)) != 425:
        raise SystemExit("Expected exactly 425 unique release assets")
    return templates, catalog_paths, required


def assert_source_tree(templates: list[dict[str, object]]) -> None:
    expected = {f"{str(item['id']).lower()}.webp" for item in templates}
    actual = {path.name for path in SOURCE.iterdir() if path.is_file()} if SOURCE.is_dir() else set()
    if actual != expected:
        raise SystemExit(f"Catalog source mismatch; missing={sorted(expected - actual)}, extra={sorted(actual - expected)}")
    hashes = set()
    for name in expected:
        path = SOURCE / name
        if assert_format(path) != (768, 768):
            raise SystemExit(f"Catalog master must be 768x768: {path.relative_to(ROOT)}")
        hashes.add(digest(path))
    if len(hashes) != 210:
        raise SystemExit("Catalog masters must contain 210 unique files")


def assert_catalog_tree(root: Path, catalog_paths: list[str]) -> None:
    expected = {Path(name).relative_to("apps/web/public").as_posix() for name in catalog_paths}
    catalog_root = root / "assets/catalog/v1"
    actual = {path.relative_to(root).as_posix() for path in catalog_root.rglob("*") if path.is_file()} if catalog_root.is_dir() else set()
    if actual != expected:
        raise SystemExit(f"Catalog asset tree mismatch; missing={sorted(expected - actual)}, extra={sorted(actual - expected)}")


def assert_catalog_files(root: Path, catalog_paths: list[str]) -> dict[str, str]:
    assert_catalog_tree(root, catalog_paths)
    hashes: dict[str, str] = {}
    total = 0
    for name in catalog_paths:
        path = root / Path(name).relative_to("apps/web/public")
        variant = "thumb" if "/thumb/" in name else "detail"
        _, dimension, limit = next(config for config in VARIANTS.values() if config[0] == variant)
        if assert_format(path) != (dimension, dimension):
            raise SystemExit(f"Catalog {variant} dimensions must be {dimension}x{dimension}: {path.relative_to(ROOT)}")
        size = path.stat().st_size
        if size > limit:
            raise SystemExit(f"Catalog {variant} exceeds {limit} bytes: {path.relative_to(ROOT)}")
        total += size
        hashes[name] = digest(path)
    if total > CATALOG_TOTAL_LIMIT:
        raise SystemExit(f"Catalog runtime assets exceed {CATALOG_TOTAL_LIMIT} bytes")
    if len(set(hashes.values())) != 420:
        raise SystemExit("Catalog runtime assets must contain 420 unique files")
    return hashes


def assert_build(required: list[str], source_hashes: dict[str, str], catalog_paths: list[str]) -> None:
    assert_catalog_files(BUILD, catalog_paths)
    for name in required:
        built = BUILD / Path(name).relative_to("apps/web/public")
        if digest(built) != source_hashes[name]:
            raise SystemExit(f"Built asset is missing or differs from public source: {built.relative_to(ROOT)}")
        assert_format(built)


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("mode", choices=["catalog", "development", "production", "environment"])
    parser.add_argument("--pin-placeholders", action="store_true")
    args = parser.parse_args()
    if args.mode == "environment":
        environment = os.environ.get("APP_ENV")
        if environment not in {"development", "test", "production"}:
            raise SystemExit("APP_ENV must be development, test, or production for the delivery asset gate")
        args.mode = "development" if environment == "development" else "production"
    if args.pin_placeholders:
        if not PLACEHOLDERS.is_file():
            raise SystemExit("Placeholder fingerprints must already exist before updating the development placeholder")
        pinned = placeholder_fingerprints()
        pinned[DEVELOPMENT_PLACEHOLDER_PATH] = digest(ROOT / DEVELOPMENT_PLACEHOLDER_PATH)
        PLACEHOLDERS.write_text(json.dumps({"files": pinned}, indent=2) + "\n", encoding="utf-8")
    if not PLACEHOLDERS.is_file():
        raise SystemExit("Placeholder hashes are not pinned")
    expected_placeholders = placeholder_fingerprints()
    if expected_placeholders[DEVELOPMENT_PLACEHOLDER_PATH] != digest(ROOT / DEVELOPMENT_PLACEHOLDER_PATH):
        raise SystemExit("Development placeholder hash drift detected")

    templates, catalog_paths, required = required_assets()
    expected_assets = json.loads(CATALOG.read_text(encoding="utf-8")).get("assets")
    if not isinstance(expected_assets, dict) or set(expected_assets) != set(required) or any(not re.fullmatch(r"[0-9a-f]{64}", str(value)) for value in expected_assets.values()):
        raise SystemExit("Release asset hashes are not pinned for all 425 files")

    assert_source_tree(templates)
    catalog_hashes = assert_catalog_files(PUBLIC, catalog_paths)
    source_hashes: dict[str, str] = {}
    for name in required:
        path = ROOT / name
        actual = digest(path)
        assert_format(path)
        if expected_assets[name] != actual:
            raise SystemExit(f"Release asset hash mismatch: {name}")
        source_hashes[name] = actual
    if any(source_hashes[name] != checksum for name, checksum in catalog_hashes.items()):
        raise SystemExit("Catalog runtime hash validation is inconsistent")
    assert_brand_manifest(source_hashes)
    if args.mode == "catalog":
        print("all 210 formal masters and 420 runtime catalog assets are valid, unique, budgeted, and hash-locked")
        return

    assert_build(required, source_hashes, catalog_paths)
    if args.mode == "development":
        print("all 425 development release assets are path-valid, format-valid, hash-locked, and present in the build")
        return
    placeholders = rejected_placeholder_paths(source_hashes, expected_placeholders)
    if placeholders:
        raise SystemExit("Formal production assets still contain development-only checksums:\n" + "\n".join(placeholders))
    print("all 425 formal production assets are valid, unique, hash-locked, and present in the build")


if __name__ == "__main__":
    main()
