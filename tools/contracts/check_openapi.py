#!/usr/bin/env python3
"""Generate OpenAPI in a temporary directory and compare without repository writes."""

from __future__ import annotations

import subprocess
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
EXPECTED = ROOT / "packages/api-contracts/openapi/openapi.json"


def main() -> None:
    with tempfile.TemporaryDirectory(prefix="pokepets-openapi-") as temporary:
        actual = Path(temporary) / "openapi.json"
        subprocess.run(["pnpm", "--filter", "@pokepets/api-contracts", "openapi", str(actual)], cwd=ROOT, check=True)
        if actual.read_bytes() != EXPECTED.read_bytes():
            raise SystemExit("OpenAPI drift detected; run pnpm contracts:openapi and commit the result")
    print("OpenAPI matches the strict route registry")


if __name__ == "__main__":
    main()
