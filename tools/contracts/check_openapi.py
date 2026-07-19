#!/usr/bin/env python3
"""Generate OpenAPI in a temporary directory and compare without repository writes."""

from __future__ import annotations

import json
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
        document = json.loads(actual.read_text(encoding="utf-8"))
        for path, path_item in document["paths"].items():
            for method, operation in path_item.items():
                if not operation.get("x-idempotency-required"):
                    continue
                headers = [
                    parameter
                    for parameter in operation.get("parameters", [])
                    if parameter.get("in") == "header" and parameter.get("name") == "Idempotency-Key"
                ]
                if len(headers) != 1 or headers[0].get("required") is not True:
                    raise SystemExit(f"Idempotent route is missing required Idempotency-Key: {method.upper()} {path}")
        if "202" in document["paths"]["/api/auth/telegram"]["post"]["responses"]:
            raise SystemExit("Telegram authentication cannot advertise durable operation recovery")
    print("OpenAPI matches the strict route registry")


if __name__ == "__main__":
    main()
