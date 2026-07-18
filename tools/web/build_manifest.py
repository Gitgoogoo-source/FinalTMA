#!/usr/bin/env python3
"""Build the production TON Connect manifest from explicit public URLs."""

from __future__ import annotations

import argparse
import json
from pathlib import Path
from urllib.parse import urlparse

ROOT = Path(__file__).resolve().parents[2]
OUTPUT = ROOT / "apps/web/public/tonconnect-manifest.json"


def public_https(value: str, field: str) -> str:
    parsed = urlparse(value)
    if parsed.scheme != "https" or not parsed.netloc:
        raise SystemExit(f"{field} must be an absolute HTTPS URL")
    return value.rstrip("/")


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--app-url", required=True)
    parser.add_argument("--icon-url", required=True)
    parser.add_argument("--terms-url", required=True)
    parser.add_argument("--privacy-url", required=True)
    args = parser.parse_args()
    document = {
        "url": public_https(args.app_url, "app-url"),
        "name": "PokePets",
        "iconUrl": public_https(args.icon_url, "icon-url"),
        "termsOfUseUrl": public_https(args.terms_url, "terms-url"),
        "privacyPolicyUrl": public_https(args.privacy_url, "privacy-url"),
    }
    OUTPUT.parent.mkdir(parents=True, exist_ok=True)
    OUTPUT.write_text(json.dumps(document, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(OUTPUT.relative_to(ROOT))


if __name__ == "__main__":
    main()
