#!/usr/bin/env python3
"""Check the twenty product-domain rows and the refactored repository boundaries."""

from __future__ import annotations

import re
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
MATRIX = ROOT / "docs/architecture/domain-map.md"

REQUIRED_PATHS = (
    "apps/web/src/app",
    "apps/web/src/pages",
    "apps/web/src/domains",
    "apps/web/src/workflows",
    "apps/api/src/domains",
    "apps/api/src/workflows",
    "packages/api-contracts/src/domains",
    "supabase/schemas",
    "contracts/ton",
    "docs/operations",
)
FORBIDDEN_REFERENCES = ("packages/server", "packages/contracts", "chain/ton", "apps/web/src/features", "ops/")
WEB_DOMAINS = {
    "album", "catalog", "expedition", "gacha", "inventory", "market", "mint", "referral",
    "risk", "tasks", "topup", "vip", "wallet", "wheel",
}
API_DOMAINS = {
    "album", "catalog", "economy", "expedition", "gacha", "identity", "inventory", "market",
    "onchain", "operations", "payments", "referral", "risk", "tasks", "vip", "wheel",
}
API_DOMAIN_FILES = {"routes.ts", "queries.ts", "commands.ts", "mappers.ts"}


def main() -> None:
    text = MATRIX.read_text(encoding="utf-8")
    chapters = [int(value) for value in re.findall(r"^\|\s*(\d+)\s+", text, re.MULTILINE)]
    if chapters != list(range(1, 21)):
        raise SystemExit(f"Domain matrix must contain chapters 1 through 20 exactly once: {chapters}")
    rows = [line.split("|")[1:-1] for line in text.splitlines() if re.match(r"^\|\s*\d+\s+", line)]
    if any(len(row) != 5 or any(not cell.strip() for cell in row) for row in rows):
        raise SystemExit("Every domain matrix row must identify Web, API, database, and acceptance ownership")
    missing = [path for path in REQUIRED_PATHS if not (ROOT / path).exists()]
    if missing:
        raise SystemExit(f"Refactored architecture paths are missing: {missing}")
    documentation = "\n".join(path.read_text(encoding="utf-8") for path in (ROOT / "docs").rglob("*.md"))
    stale = [value for value in FORBIDDEN_REFERENCES if value in documentation]
    if stale:
        raise SystemExit(f"Documentation still references removed architecture paths: {stale}")
    assert_directories(ROOT / "apps/web/src/domains", WEB_DOMAINS, "Web domains")
    assert_directories(ROOT / "apps/api/src/domains", API_DOMAINS, "API domains")
    invalid_api_files = [
        str(path.relative_to(ROOT))
        for directory in (ROOT / "apps/api/src/domains").iterdir()
        if directory.is_dir()
        for path in directory.glob("*.ts")
        if path.name not in API_DOMAIN_FILES
    ]
    if invalid_api_files:
        raise SystemExit(f"API domain files violate the fixed structure: {invalid_api_files}")
    page_source = "\n".join(path.read_text(encoding="utf-8") for path in (ROOT / "apps/web/src/pages").rglob("*.tsx"))
    if "apiRequest(" in page_source or "useApiQuery(" in page_source or "platform/api" in page_source:
        raise SystemExit("Route pages must compose domain UI and cannot call the API directly")
    web_source = "\n".join(path.read_text(encoding="utf-8") for path in (ROOT / "apps/web/src").rglob("*.ts*"))
    if "@supabase" in web_source or "SUPABASE_SERVICE_ROLE" in web_source:
        raise SystemExit("The Web application cannot import Supabase or reference service-role secrets")
    tsconfig_source = "\n".join(
        path.read_text(encoding="utf-8")
        for path in ROOT.rglob("tsconfig*.json")
        if "node_modules" not in path.parts
    )
    if '"paths"' in tsconfig_source:
        raise SystemExit("TypeScript paths cannot hide missing workspace dependencies")
    print("twenty product domains and repository boundaries are traceable")


def assert_directories(parent: Path, expected: set[str], label: str) -> None:
    actual = {path.name for path in parent.iterdir() if path.is_dir()}
    if actual != expected:
        raise SystemExit(f"{label} mismatch: expected {sorted(expected)}, found {sorted(actual)}")


if __name__ == "__main__":
    main()
