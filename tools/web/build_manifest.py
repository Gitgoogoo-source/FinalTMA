#!/usr/bin/env python3
"""Build the single public TON Connect manifest."""

from __future__ import annotations

import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
OUTPUT = ROOT / "apps/web/public/tonconnect-manifest.json"
MANIFEST = {
    "url": "https://final-tma-pi.vercel.app",
    "name": "EvoMyPet",
    "iconUrl": "https://final-tma-pi.vercel.app/assets/ton/tonconnect-icon.png",
}


def main() -> None:
    OUTPUT.parent.mkdir(parents=True, exist_ok=True)
    OUTPUT.write_text(json.dumps(MANIFEST, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(OUTPUT.relative_to(ROOT))


if __name__ == "__main__":
    main()
