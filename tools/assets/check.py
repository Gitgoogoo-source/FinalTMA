#!/usr/bin/env python3
"""Validate Storage pet-art manifests and Vercel-owned release assets."""

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
ART_MANIFEST = ROOT / "generated/assets/art-assets-v2.json"
LEGACY_ART_MANIFEST = ROOT / "generated/assets/releases/catalog-v1-initial.json"
PLACEHOLDERS = ROOT / "generated/assets/placeholders.json"
BRAND_MANIFEST = ROOT / "generated/assets/brand-v1.json"
SILHOUETTE = "apps/web/public/assets/pets/pet-silhouette.svg"
REMOVED_BINARY_ROOTS = (
    ROOT / "assets/source/catalog/v1",
    ROOT / "assets/source/catalog/v2",
    ROOT / "apps/web/public/assets/catalog/v1",
    ROOT / "apps/web/public/assets/catalog/v2",
    ROOT / "apps/web/public/assets/gacha/representatives",
)
DEVELOPMENT_PLACEHOLDER_PATH = "apps/web/public/assets/dev/placeholder.webp"
PLACEHOLDER_PATHS = [
    DEVELOPMENT_PLACEHOLDER_PATH,
    "apps/web/public/assets/share/preview.webp",
    "apps/web/public/assets/ton/tonconnect-icon.png",
]
MVP_PRODUCTION_PLACEHOLDER_PATHS = [
    DEVELOPMENT_PLACEHOLDER_PATH,
    "apps/web/public/assets/share/preview.webp",
]
VERCEL_ASSETS = [
    "apps/web/public/assets/boxes/normal.webp",
    "apps/web/public/assets/boxes/rare.webp",
    "apps/web/public/assets/boxes/legendary.webp",
    "apps/web/public/assets/share/preview.webp",
    "apps/web/public/assets/ton/tonconnect-icon.png",
]
BRAND_ASSETS = {
    "apps/web/public/assets/share/preview.webp": ("webp", 1200, 630),
    "apps/web/public/assets/ton/tonconnect-icon.png": ("png", 180, 180),
}
RESPONSIVE_STATIC_ASSETS = {
    "apps/web/public/assets/topbar/fgems-gem.png": ((64, 64), 8 * 1024, True),
    "apps/web/public/assets/topbar/kcoin-star.png": ((64, 64), 8 * 1024, True),
    "apps/web/public/assets/battle/rooms/battle-room-20.webp": ((800, 373), 80 * 1024, False),
    "apps/web/public/assets/battle/rooms/battle-room-100.webp": ((800, 373), 80 * 1024, False),
    "apps/web/public/assets/battle/rooms/battle-room-500.webp": ((800, 373), 80 * 1024, False),
    "apps/web/public/assets/boxes/responsive/normal-128.webp": ((128, 128), 10 * 1024, True),
    "apps/web/public/assets/boxes/responsive/normal-192.webp": ((192, 192), 15 * 1024, True),
    "apps/web/public/assets/boxes/responsive/normal-384.webp": ((384, 384), 30 * 1024, True),
    "apps/web/public/assets/boxes/responsive/normal-768.webp": ((768, 768), 70 * 1024, True),
    "apps/web/public/assets/boxes/responsive/normal-1024.webp": ((1024, 1024), 100 * 1024, True),
    "apps/web/public/assets/boxes/responsive/rare-128.webp": ((128, 128), 10 * 1024, True),
    "apps/web/public/assets/boxes/responsive/rare-192.webp": ((192, 192), 20 * 1024, True),
    "apps/web/public/assets/boxes/responsive/rare-384.webp": ((384, 384), 40 * 1024, True),
    "apps/web/public/assets/boxes/responsive/rare-768.webp": ((768, 768), 100 * 1024, True),
    "apps/web/public/assets/boxes/responsive/rare-1024.webp": ((1024, 1024), 150 * 1024, True),
    "apps/web/public/assets/boxes/responsive/legendary-128.webp": ((128, 160), 20 * 1024, True),
    "apps/web/public/assets/boxes/responsive/legendary-192.webp": ((192, 240), 30 * 1024, True),
    "apps/web/public/assets/boxes/responsive/legendary-384.webp": ((384, 480), 90 * 1024, True),
    "apps/web/public/assets/boxes/responsive/legendary-768.webp": ((768, 960), 260 * 1024, True),
    "apps/web/public/assets/boxes/responsive/legendary-1024.webp": ((1024, 1280), 380 * 1024, True),
    "apps/web/public/assets/tasks/invite-gifts-256.webp": ((256, 192), 15 * 1024, False),
    "apps/web/public/assets/tasks/invite-gifts-512.webp": ((512, 384), 35 * 1024, False),
    "apps/web/public/assets/tasks/invite-gifts-768.webp": ((768, 576), 60 * 1024, False),
}


def digest_bytes(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def digest(path: Path) -> str:
    if not path.is_file() or path.stat().st_size == 0:
        raise SystemExit(f"Missing or empty asset: {path.relative_to(ROOT)}")
    return digest_bytes(path.read_bytes())


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


def assert_format(path: Path) -> tuple[int, int]:
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
    files = json.loads(PLACEHOLDERS.read_text(encoding="utf-8")).get("files")
    if (
        not isinstance(files, dict)
        or set(files) != set(PLACEHOLDER_PATHS)
        or any(not isinstance(value, str) or re.fullmatch(r"[0-9a-f]{64}", value) is None for value in files.values())
    ):
        raise SystemExit("Placeholder fingerprints are incomplete or invalid")
    return files


def assert_brand_manifest(source_hashes: dict[str, str]) -> None:
    document = json.loads(BRAND_MANIFEST.read_text(encoding="utf-8"))
    if document.get("schema_version") != 1 or document.get("brand") != "PokePets":
        raise SystemExit("Formal brand asset provenance identity is invalid")
    if document.get("palette") != {
        "source": "apps/web/src/shared/styles/global.css",
        "primary": "#FF7A00",
        "secondary": "#4DBB39",
        "ink": "#36434B",
        "paper": "#FFFDFA",
    }:
        raise SystemExit("Formal brand palette differs from the locked UI design tokens")
    generation = document.get("generation")
    rights = document.get("rights")
    assets = document.get("assets")
    if (
        not isinstance(generation, dict)
        or generation.get("mode") != "built-in imagegen"
        or generation.get("generated_on") != "2026-07-30"
        or generation.get("third_party_inputs") != []
        or not isinstance(generation.get("prompts"), dict)
        or set(generation["prompts"]) != {"icon", "share"}
        or rights != {"usage": "PokePets project-owned", "third_party_licenses": [], "license_source": None}
        or not isinstance(assets, dict)
        or set(assets) != set(BRAND_ASSETS)
    ):
        raise SystemExit("Formal brand provenance is incomplete")
    for name, (expected_format, width, height) in BRAND_ASSETS.items():
        item = assets[name]
        path = ROOT / name
        if (
            not isinstance(item, dict)
            or item.get("format") != expected_format
            or item.get("width") != width
            or item.get("height") != height
            or item.get("opaque") is not True
            or item.get("sha256") != source_hashes[name]
            or assert_format(path) != (width, height)
            or has_alpha(path, path.read_bytes())
        ):
            raise SystemExit(f"Formal brand asset provenance mismatch: {name}")


def assert_art_manifest(path: Path, runtime_version: str) -> None:
    manifest = json.loads(path.read_text(encoding="utf-8"))
    expected = manifest.pop("manifest_sha256", None)
    actual = digest_bytes(
        json.dumps(manifest, ensure_ascii=False, sort_keys=True, separators=(",", ":")).encode()
    )
    if expected != actual:
        raise SystemExit("Art manifest checksum is invalid")
    if (
        manifest.get("schema_version") != 1
        or manifest.get("catalog_version") != "v1"
        or manifest.get("private_bucket") != "art-masters"
        or manifest.get("public_bucket") != "pet-runtime"
    ):
        raise SystemExit("Art manifest identity or buckets are invalid")
    generator = manifest.get("generator")
    if not isinstance(generator, dict):
        raise SystemExit("Art manifest generator provenance is missing")
    source_png = generator.get("source_png")
    if source_png is not None:
        expected_source = {
            "format": "png",
            "width": 1024,
            "height": 1024,
            "color_space": "srgb",
            "channels": 4,
            "depth": "uchar",
            "bits_per_sample": 8,
            "pages": 1,
            "alpha": True,
            "count": 210,
            "filename_pattern": "NNN_CNNN-S_<catalog-name>.png",
            "name_normalization": "trim surrounding whitespace and underscores",
            "master": {
                "format": "webp",
                "width": 768,
                "height": 768,
                "lossless": True,
                "effort": 6,
                "alpha_quality": 100,
                "kernel": "lanczos3",
                "metadata": False,
                "fit": "fill",
            },
        }
        if (
            not isinstance(source_png, dict)
            or re.fullmatch(r"[0-9a-f]{64}", str(source_png.get("set_sha256"))) is None
            or {key: value for key, value in source_png.items() if key != "set_sha256"}
            != expected_source
        ):
            raise SystemExit("PNG source import provenance is invalid")
    catalog = json.loads(CATALOG.read_text(encoding="utf-8"))
    templates = catalog.get("templates")
    assets = manifest.get("templates")
    if not isinstance(templates, list) or not isinstance(assets, list) or len(templates) != 210 or len(assets) != 210:
        raise SystemExit("Catalog and art manifest must contain exactly 210 templates")
    template_ids = [str(item.get("id")) for item in templates]
    if any("image_thumbnail_path" in item or "image_detail_path" in item for item in templates):
        raise SystemExit("Catalog product manifest must not pin delivery URLs or paths")
    if [item.get("template_id") for item in assets] != template_ids:
        raise SystemExit("Art manifest template order differs from the catalog")
    master_hashes: set[str] = set()
    runtime_hashes: set[str] = set()
    object_keys: set[str] = set()
    runtime_bytes = 0
    for item in assets:
        template_id = str(item["template_id"])
        lower = template_id.lower()
        records = {
            "master": (768, 2 * 1024 * 1024, rf"^catalog/{lower}/[0-9a-f]{{64}}\.webp$"),
            "thumbnail": (256, 50 * 1024, rf"^catalog/{runtime_version}/thumb/{lower}\.[0-9a-f]{{64}}\.webp$"),
            "detail": (768, 180 * 1024, rf"^catalog/{runtime_version}/detail/{lower}\.[0-9a-f]{{64}}\.webp$"),
        }
        for name, (dimension, maximum, key_pattern) in records.items():
            record = item.get(name)
            if (
                not isinstance(record, dict)
                or re.fullmatch(key_pattern, str(record.get("key"))) is None
                or re.fullmatch(r"[0-9a-f]{64}", str(record.get("sha256"))) is None
                or record.get("mime_type") != "image/webp"
                or record.get("width") != dimension
                or record.get("height") != dimension
                or not isinstance(record.get("bytes"), int)
                or record["bytes"] < 1
                or record["bytes"] > maximum
            ):
                raise SystemExit(f"Invalid {name} manifest record for {template_id}")
            if record["key"] in object_keys:
                raise SystemExit("Art object keys must be unique")
            object_keys.add(record["key"])
            if name == "master":
                master_hashes.add(record["sha256"])
            else:
                runtime_hashes.add(record["sha256"])
                runtime_bytes += record["bytes"]
    if len(master_hashes) != 210 or len(runtime_hashes) != 420 or runtime_bytes > 50 * 1024 * 1024:
        raise SystemExit("Art hashes are not unique or the runtime byte budget is exceeded")


def assert_removed_binaries(root: Path) -> None:
    for path in REMOVED_BINARY_ROOTS:
        relative = path.relative_to(ROOT)
        target = root / relative if root == ROOT else root / relative.relative_to("apps/web/public")
        if target.exists() and any(target.rglob("*")):
            raise SystemExit(f"Pet binary tree must not be shipped: {target}")


def assert_repository_assets() -> dict[str, str]:
    catalog_assets = json.loads(CATALOG.read_text(encoding="utf-8")).get("assets")
    if not isinstance(catalog_assets, dict) or set(catalog_assets) != set(VERCEL_ASSETS):
        raise SystemExit("Catalog release lock must contain only the five Vercel-owned required assets")
    hashes: dict[str, str] = {}
    for name in VERCEL_ASSETS:
        path = ROOT / name
        hashes[name] = digest(path)
        assert_format(path)
        if catalog_assets[name] != hashes[name]:
            raise SystemExit(f"Vercel asset checksum mismatch: {name}")
    assert_brand_manifest(hashes)
    silhouette = ROOT / SILHOUETTE
    if not silhouette.is_file() or "<svg" not in silhouette.read_text(encoding="utf-8"):
        raise SystemExit("The Vercel pet silhouette is missing or invalid")
    return hashes


def assert_responsive_static_assets() -> dict[str, str]:
    hashes: dict[str, str] = {}
    for name, (dimensions, maximum_bytes, alpha) in RESPONSIVE_STATIC_ASSETS.items():
        path = ROOT / name
        hashes[name] = digest(path)
        if assert_format(path) != dimensions:
            raise SystemExit(f"Responsive static asset dimensions mismatch: {name}")
        if path.stat().st_size > maximum_bytes:
            raise SystemExit(f"Responsive static asset exceeds its byte budget: {name}")
        if has_alpha(path, path.read_bytes()) is not alpha:
            raise SystemExit(f"Responsive static asset alpha channel mismatch: {name}")
    return hashes


def assert_build(
    source_hashes: dict[str, str], responsive_hashes: dict[str, str]
) -> None:
    for name in VERCEL_ASSETS:
        built = BUILD / Path(name).relative_to("apps/web/public")
        if digest(built) != source_hashes[name]:
            raise SystemExit(f"Built Vercel asset differs from its source: {built.relative_to(ROOT)}")
    built_silhouette = BUILD / Path(SILHOUETTE).relative_to("apps/web/public")
    if digest(built_silhouette) != digest(ROOT / SILHOUETTE):
        raise SystemExit("Built pet silhouette differs from its source")
    for name, source_hash in responsive_hashes.items():
        built = BUILD / Path(name).relative_to("apps/web/public")
        if digest(built) != source_hash:
            raise SystemExit(
                f"Built responsive static asset differs from its source: {built.relative_to(ROOT)}"
            )
    for relative in ("assets/catalog", "assets/gacha/representatives"):
        path = BUILD / relative
        if path.exists() and any(path.rglob("*")):
            raise SystemExit(f"Vercel build contains forbidden pet binaries: {path}")


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
        pinned = placeholder_fingerprints()
        pinned[DEVELOPMENT_PLACEHOLDER_PATH] = digest(ROOT / DEVELOPMENT_PLACEHOLDER_PATH)
        PLACEHOLDERS.write_text(json.dumps({"files": pinned}, indent=2) + "\n", encoding="utf-8")
    expected_placeholders = placeholder_fingerprints()
    if expected_placeholders[DEVELOPMENT_PLACEHOLDER_PATH] != digest(ROOT / DEVELOPMENT_PLACEHOLDER_PATH):
        raise SystemExit("Development placeholder hash drift detected")
    assert_art_manifest(ART_MANIFEST, "v2")
    assert_art_manifest(LEGACY_ART_MANIFEST, "v1")
    assert_removed_binaries(ROOT)
    source_hashes = assert_repository_assets()
    responsive_hashes = assert_responsive_static_assets()
    if args.mode == "catalog":
        print("art manifest covers 210 masters and 420 immutable runtime objects; Git pet binaries are absent")
        return
    assert_build(source_hashes, responsive_hashes)
    if args.mode == "development":
        print("Vercel build contains only Vercel-owned art plus the pet silhouette")
        return
    rejected = {
        expected_placeholders[path] for path in MVP_PRODUCTION_PLACEHOLDER_PATHS
    }
    placeholders = sorted(name for name, value in source_hashes.items() if value in rejected)
    if placeholders:
        raise SystemExit("Formal production assets still contain development-only checksums:\n" + "\n".join(placeholders))
    print("formal production Vercel assets are valid and pet runtime binaries are excluded")


if __name__ == "__main__":
    main()
