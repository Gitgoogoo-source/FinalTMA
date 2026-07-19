#!/usr/bin/env python3
"""Verify declarative schemas and the three immutable initial migrations without repository writes."""

from __future__ import annotations

import argparse
import subprocess
import sys
import tempfile
import re
from pathlib import Path


ROOT = Path(__file__).resolve().parents[2]
SCHEMAS = ROOT / "supabase/schemas"
MIGRATIONS = ROOT / "supabase/migrations"
EXPECTED_SCHEMA_NAMES = {
    "00_foundation.sql",
    "10_identity.sql",
    "20_catalog.sql",
    "30_operations.sql",
    "31_economy.sql",
    "32_inventory.sql",
    "33_decomposition.sql",
    "40_gacha.sql",
    "41_expedition.sql",
    "42_wheel.sql",
    "43_evolution.sql",
    "50_market.sql",
    "60_payments.sql",
    "61_vip.sql",
    "62_tasks.sql",
    "63_referral.sql",
    "64_album.sql",
    "65_catalog_api.sql",
    "70_wallet.sql",
    "71_mint.sql",
    "80_risk.sql",
    "90_payment_callbacks.sql",
    "91_mint_reconciliation.sql",
    "95_jobs.sql",
}
EXPECTED_SUFFIXES = ("_baseline.sql", "_product_data_v1.sql", "_api_security.sql")
ERROR_REGISTRY = ROOT / "packages/api-contracts/src/common/errors.ts"
SUPABASE_CONFIG = ROOT / "supabase/config.toml"


def one_migration(suffix: str) -> Path:
    matches = sorted(MIGRATIONS.glob(f"*{suffix}"))
    if len(matches) != 1:
        raise SystemExit(f"Expected exactly one *{suffix} migration, found {[path.name for path in matches]}")
    return matches[0]


def rendered_baseline() -> str:
    sections = ["-- Generated from supabase/schemas. Edit declarative schemas, then run supabase db diff for future changes.\n"]
    for path in sorted(SCHEMAS.glob("*.sql")):
        sections.append(f"\n-- source: {path.name}\n")
        sections.append(path.read_text(encoding="utf-8").rstrip() + "\n")
    return "".join(sections)


def verify_security(path: Path) -> None:
    sql = path.read_text(encoding="utf-8").lower()
    required = (
        "enable row level security",
        "revoke all on schema",
        "revoke execute on all functions",
        "revoke all on sequence",
        "grant usage on schema api to service_role",
        "grant execute on all functions in schema api to service_role",
        "alter default privileges",
        "revoke all on tables from public, anon, authenticated, service_role",
        "revoke all on sequences from public, anon, authenticated, service_role",
    )
    missing = [statement for statement in required if statement not in sql]
    if missing:
        raise SystemExit(f"Security migration is incomplete: {missing}")


def verify_database_error_codes() -> None:
    schema_sql = "\n".join(path.read_text(encoding="utf-8") for path in SCHEMAS.glob("*.sql"))
    database_codes = set(re.findall(r"raise_business_error\('([A-Z0-9_]+)'", schema_sql))
    database_codes.update(re.findall(r"error_code\s*=\s*'([A-Z0-9_]+)'", schema_sql))
    registry_codes = set(re.findall(r"^  ([A-Z0-9_]+): error", ERROR_REGISTRY.read_text(encoding="utf-8"), re.MULTILINE))
    missing = sorted(database_codes - registry_codes)
    if missing:
        raise SystemExit(f"Database error codes missing from shared registry: {missing}")


def verify_database_boundaries() -> None:
    schema_sql = "\n".join(path.read_text(encoding="utf-8") for path in SCHEMAS.glob("*.sql"))
    functions = re.findall(
        r"create\s+or\s+replace\s+function\s+([^\s(]+).*?\$\$;",
        schema_sql,
        re.IGNORECASE | re.DOTALL,
    )
    blocks = re.findall(
        r"create\s+or\s+replace\s+function\s+[^\s(]+.*?\$\$;",
        schema_sql,
        re.IGNORECASE | re.DOTALL,
    )
    insecure = [
        name
        for name, block in zip(functions, blocks, strict=True)
        if "security definer" in block.lower() and "set search_path = ''" not in block.lower()
    ]
    if insecure:
        raise SystemExit(f"SECURITY DEFINER functions require an empty search_path: {insecure}")
    if "auth.uid()" in schema_sql.lower() or "auth.users" in schema_sql.lower():
        raise SystemExit("Business authorization cannot depend on Supabase Auth")
    direct_reservation_writes = len(re.findall(r"insert\s+into\s+inventory\.reservations", schema_sql, re.IGNORECASE))
    if direct_reservation_writes != 1:
        raise SystemExit("All inventory reservations must be created by inventory.reserve")
    config = SUPABASE_CONFIG.read_text(encoding="utf-8")
    if 'schemas = ["api"]' not in config or 'enabled = false\n\n[edge_runtime]' not in config:
        raise SystemExit("The Data API must expose only api and Supabase Auth must remain disabled")


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--write-baseline", action="store_true")
    args = parser.parse_args()
    schema_names = {path.name for path in SCHEMAS.glob("*.sql")}
    if schema_names != EXPECTED_SCHEMA_NAMES:
        raise SystemExit(f"Schema inventory mismatch: {sorted(schema_names)}")

    migrations = sorted(MIGRATIONS.glob("*.sql"))
    if len(migrations) != 3:
        raise SystemExit(f"Expected three initial migrations, found {[path.name for path in migrations]}")
    baseline, product_data, security = (one_migration(suffix) for suffix in EXPECTED_SUFFIXES)
    if not (baseline.name < product_data.name < security.name):
        raise SystemExit("Migration order must be baseline, product_data_v1, api_security")
    if args.write_baseline:
        baseline.write_text(rendered_baseline(), encoding="utf-8")
    if baseline.read_text(encoding="utf-8") != rendered_baseline():
        raise SystemExit("Baseline migration does not match declarative schemas")
    verify_security(security)
    verify_database_error_codes()
    verify_database_boundaries()

    with tempfile.TemporaryDirectory(prefix="pokepets-db-check-") as temporary:
        output = Path(temporary)
        generated_product_data = output / product_data.name
        subprocess.run(
            [
                "python3",
                "tools/product_data/build.py",
                "--migration-path",
                str(generated_product_data),
                "--manifest-path",
                str(output / "catalog-v1.json"),
            ],
            cwd=ROOT,
            check=True,
        )
        if product_data.read_bytes() != generated_product_data.read_bytes():
            print("Product data migration is stale", file=sys.stderr)
            raise SystemExit(1)
    print("declarative schemas and three initial migrations are synchronized")


if __name__ == "__main__":
    main()
