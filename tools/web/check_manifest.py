#!/usr/bin/env python3
"""Validate the single public TON Connect identity and its build copy."""

from __future__ import annotations

import argparse
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
MANIFEST = ROOT / "apps/web/public/tonconnect-manifest.json"
BUILT_MANIFEST = ROOT / "apps/web/dist/tonconnect-manifest.json"
EXPECTED = {
    "url": "https://final-tma-pi.vercel.app",
    "name": "EvoMyPet",
    "iconUrl": "https://final-tma-pi.vercel.app/assets/ton/tonconnect-icon.png",
}


def assert_manifest(document: object, label: str) -> None:
    if document != EXPECTED:
        raise SystemExit(f"{label} TON Connect manifest must use the single EvoMyPet production identity")


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("mode", choices=["repository", "build", "development", "production"])
    args = parser.parse_args()
    source_bytes = MANIFEST.read_bytes()
    assert_manifest(json.loads(source_bytes), "Repository")
    if args.mode != "repository":
        if not BUILT_MANIFEST.is_file() or BUILT_MANIFEST.read_bytes() != source_bytes:
            raise SystemExit("Built TON Connect manifest is missing or differs from the repository manifest")
        assert_manifest(json.loads(BUILT_MANIFEST.read_bytes()), "Built")
    print(f"{args.mode} TON Connect manifest uses the single EvoMyPet production identity")


if __name__ == "__main__":
    main()
