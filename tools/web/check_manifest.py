#!/usr/bin/env python3
"""Validate the committed TON Connect manifest without changing it."""

from __future__ import annotations

import argparse
import json
from pathlib import Path
from urllib.parse import urlparse

ROOT = Path(__file__).resolve().parents[2]
MANIFEST = ROOT / "apps/web/public/tonconnect-manifest.json"


def is_https(value: object) -> bool:
    if not isinstance(value, str):
        return False
    parsed = urlparse(value)
    return parsed.scheme == "https" and bool(parsed.netloc)


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("mode", choices=["repository", "development", "production"])
    args = parser.parse_args()
    document = json.loads(MANIFEST.read_text(encoding="utf-8"))
    if args.mode == "repository":
        target = str(document.get("url", ""))
        args.mode = "development" if target == "http://localhost:3000" else "production"
    if args.mode == "development":
        if document.get("url") != "http://localhost:3000":
            raise SystemExit("Development TON Connect manifest must target http://localhost:3000")
        print("development TON Connect manifest is valid")
        return
    required = ("url", "iconUrl", "termsOfUseUrl", "privacyPolicyUrl")
    missing = [field for field in required if not is_https(document.get(field))]
    if missing or document.get("name") != "PokePets":
        raise SystemExit(f"Production TON Connect manifest is incomplete or uses placeholders: {missing}")
    if any("example" in str(document[field]).lower() or "localhost" in str(document[field]).lower() for field in required):
        raise SystemExit("Production TON Connect manifest contains a placeholder host")
    print("production TON Connect manifest is valid")


if __name__ == "__main__":
    main()
