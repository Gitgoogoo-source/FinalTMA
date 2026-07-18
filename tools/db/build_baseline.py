#!/usr/bin/env python3
"""Materialize the three clean migrations from declarative schemas."""

from __future__ import annotations

from pathlib import Path


ROOT = Path(__file__).resolve().parents[2]
SCHEMAS = ROOT / "supabase/schemas"
MIGRATIONS = ROOT / "supabase/migrations"
BASELINE = MIGRATIONS / "20260718000100_baseline.sql"
GRANTS = MIGRATIONS / "20260718000300_api_grants.sql"


def rendered(paths: list[Path]) -> str:
    sections = ["-- Generated from supabase/schemas. Edit declarative schemas, then regenerate.\n"]
    for path in paths:
        sections.append(f"\n-- source: {path.name}\n")
        sections.append(path.read_text(encoding="utf-8").rstrip() + "\n")
    return "".join(sections)


def main() -> None:
    schema_files = sorted(SCHEMAS.glob("*.sql"))
    baseline_files = [path for path in schema_files if path.name != "90_security.sql"]
    BASELINE.write_text(rendered(baseline_files), encoding="utf-8")
    GRANTS.write_text(rendered([SCHEMAS / "90_security.sql"]), encoding="utf-8")
    print(f"baseline: {len(baseline_files)} schema files; grants: 90_security.sql")


if __name__ == "__main__":
    main()
