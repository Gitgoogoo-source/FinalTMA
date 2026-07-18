#!/usr/bin/env python3
"""Materialize baseline and grants migrations from declarative schemas."""

from __future__ import annotations

import argparse
from pathlib import Path


ROOT = Path(__file__).resolve().parents[2]
SCHEMAS = ROOT / "supabase/schemas"
MIGRATIONS = ROOT / "supabase/migrations"
BASELINE_NAME = "20260718182511_baseline.sql"
GRANTS_NAME = "20260718182514_api_grants.sql"


def rendered(paths: list[Path]) -> str:
    sections = ["-- Generated from supabase/schemas. Edit declarative schemas, then regenerate.\n"]
    for path in paths:
        sections.append(f"\n-- source: {path.name}\n")
        sections.append(path.read_text(encoding="utf-8").rstrip() + "\n")
    return "".join(sections)


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--output-dir", type=Path, default=MIGRATIONS)
    args = parser.parse_args()
    schema_files = sorted(SCHEMAS.glob("*.sql"))
    baseline_files = [path for path in schema_files if path.name != "99_security.sql"]
    args.output_dir.mkdir(parents=True, exist_ok=True)
    (args.output_dir / BASELINE_NAME).write_text(rendered(baseline_files), encoding="utf-8")
    (args.output_dir / GRANTS_NAME).write_text(rendered([SCHEMAS / "99_security.sql"]), encoding="utf-8")
    print(f"baseline: {len(baseline_files)} schema files; grants: 99_security.sql")


if __name__ == "__main__":
    main()
