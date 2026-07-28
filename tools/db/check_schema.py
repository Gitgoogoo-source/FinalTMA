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
    "44_battle.sql",
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
        "grant execute on function %i.%i(%s) to service_role",
        "v_allowed text[] := array[",
        "alter default privileges",
        "revoke all on tables from public, anon, authenticated, service_role",
        "revoke all on sequences from public, anon, authenticated, service_role",
    )
    missing = [statement for statement in required if statement not in sql]
    if missing:
        raise SystemExit(f"Security migration is incomplete: {missing}")
    if "grant execute on all functions in schema api to service_role" in sql:
        raise SystemExit("service_role API execution must use an explicit function allowlist")

    schema_sql = "\n".join(path.read_text(encoding="utf-8").lower() for path in SCHEMAS.glob("*.sql"))
    api_functions = set(
        re.findall(r"create\s+or\s+replace\s+function\s+api\.([a-z0-9_]+)", schema_sql)
    )
    allowlist_match = re.search(
        r"v_allowed\s+text\[\]\s*:=\s*array\[(.*?)\];",
        sql,
        re.DOTALL,
    )
    if allowlist_match is None:
        raise SystemExit("Security migration API allowlist is missing")
    allowlisted = set(re.findall(r"'([a-z0-9_]+)'", allowlist_match.group(1)))
    expected = api_functions - {"raise_business_error", "session_user"}
    if allowlisted != expected:
        raise SystemExit(
            "Security migration API allowlist mismatch: "
            f"missing={sorted(expected - allowlisted)}, "
            f"unexpected={sorted(allowlisted - expected)}"
        )


def verify_database_error_codes() -> None:
    schema_sql = "\n".join(path.read_text(encoding="utf-8") for path in SCHEMAS.glob("*.sql"))
    database_codes = set(re.findall(r"raise_business_error\('([A-Z0-9_]+)'", schema_sql))
    database_codes.update(re.findall(r"error_code\s*=\s*'([A-Z0-9_]+)'", schema_sql))
    database_codes.update(
        re.findall(
            r"operations\.fail_command\(\s*[^,]+,\s*'(BATTLE_[A-Z0-9_]+)'",
            schema_sql,
            re.DOTALL,
        )
    )
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


def verify_identity_login_contract() -> None:
    sql = (SCHEMAS / "10_identity.sql").read_text(encoding="utf-8").lower()
    required = (
        "create table identity.login_requests",
        "operation_id uuid primary key",
        "create table identity.entry_candidates",
        "user_id uuid primary key",
        "create unique index sessions_one_active_per_user_idx",
        "where revoked_at is null",
        "scope in ('source', 'user', 'init_data')",
        "when 'source' then 30",
        "when 'user' then 10",
        "when 'init_data' then 3",
        "create or replace function api.identity_consume_login_rate_limit",
        "create or replace function api.identity_authenticate",
        "p_operation_id uuid",
        "p_request_hash text",
        "if v_user.status = 'banned'",
        "now() + interval '15 minutes'",
        "now() + interval '10 minutes'",
    )
    missing = [fragment for fragment in required if fragment not in sql]
    if missing:
        raise SystemExit(f"Identity login contract is incomplete: {missing}")

    referral_sql = (SCHEMAS / "63_referral.sql").read_text(encoding="utf-8").lower()
    if "identity.entry_candidates" not in referral_sql or "v_session.new_user" in referral_sql:
        raise SystemExit("Referral binding must consume the persistent entry candidate")


def verify_entry_handoff_contract() -> None:
    identity_sql = (SCHEMAS / "10_identity.sql").read_text(encoding="utf-8").lower()
    identity_required = (
        "create or replace function identity.session_entry_handoff",
        "'entry_handoff_state'",
        "'entry_handoff_code'",
        "'entry_handoff_result'",
        "p_allow_pending_entry_handoff boolean default false",
        "raise_business_error('entry_handoff_pending'",
        "identity.session_entry_handoff(s.id)",
        "referral_processed_at is null",
    )
    missing = [fragment for fragment in identity_required if fragment not in identity_sql]
    if missing:
        raise SystemExit(f"Entry handoff identity contract is incomplete: {missing}")

    operations_sql = (SCHEMAS / "30_operations.sql").read_text(encoding="utf-8").lower()
    operations_required = (
        "p_use_case is not distinct from 'referral.bind'",
        "api.session_user(p_session_id, true)",
        "v_operation.use_case <> 'referral.bind'",
        "raise_business_error('entry_handoff_pending'",
    )
    missing = [fragment for fragment in operations_required if fragment not in operations_sql]
    if missing:
        raise SystemExit(f"Entry handoff operation recovery contract is incomplete: {missing}")

    referral_sql = (SCHEMAS / "63_referral.sql").read_text(encoding="utf-8").lower()
    referral_required = (
        "create or replace function referral.reject_bind",
        "set referral_processed_at = coalesce(referral_processed_at, now())",
        "v_operation.status in ('succeeded', 'failed')",
        "return referral.reject_bind",
    )
    missing = [fragment for fragment in referral_required if fragment not in referral_sql]
    if missing or referral_sql.count("return referral.reject_bind") != 10:
        raise SystemExit(
            f"Entry handoff settlement contract is incomplete: missing={missing}, "
            f"rejection_branches={referral_sql.count('return referral.reject_bind')}"
        )


def verify_stars_payment_contract() -> None:
    payments_sql = (SCHEMAS / "60_payments.sql").read_text(encoding="utf-8").lower()
    callbacks_sql = (SCHEMAS / "90_payment_callbacks.sql").read_text(encoding="utf-8").lower()
    economy_sql = (SCHEMAS / "31_economy.sql").read_text(encoding="utf-8").lower()
    identity_sql = (SCHEMAS / "10_identity.sql").read_text(encoding="utf-8").lower()
    jobs_sql = (SCHEMAS / "95_jobs.sql").read_text(encoding="utf-8").lower()
    required = {
        "payments": (
            "'processing'",
            "'failed'",
            "'cancelled'",
            "pre_checkout_query_id text unique",
            "checkout_started_at timestamptz",
            "create or replace function api.topup_cancel_order",
            "create or replace function api.topup_fail_order",
            "create or replace function api.payment_fail_invoice_creation",
            "return operations.complete_command(v_order.operation_id, v_result)",
            "raise_business_error('payment_already_processing'",
            "'battle_create'",
            "'battle_accept'",
            "'battle_invite_token_hash'",
            "battle.validate_team_selection",
        ),
        "callbacks": (
            "create or replace function api.payment_begin_checkout",
            "set status = 'processing'",
            "pre_checkout_query_id = p_pre_checkout_query_id",
            "v_order.kind = 'vip' and v_user.status <> 'normal'",
            "telegram_payment_charge_id = p_telegram_charge_id",
            "payments.deliver(v_order.id)",
        ),
        "economy": (
            "create unique index ledger_stars_topup_reference_unique_idx",
            "where reason = 'stars_topup'",
        ),
        "identity": (
            "p.status in ('processing', 'paid')",
            "p.kind = 'vip' and p.status = 'pending'",
        ),
        "jobs": (
            "status in ('pending', 'processing') and expires_at <= now()",
            "case when status = 'pending' then 'expired' else 'failed' end",
        ),
    }
    sources = {
        "payments": payments_sql,
        "callbacks": callbacks_sql,
        "economy": economy_sql,
        "identity": identity_sql,
        "jobs": jobs_sql,
    }
    missing = {
        name: [fragment for fragment in fragments if fragment not in sources[name]]
        for name, fragments in required.items()
    }
    missing = {name: fragments for name, fragments in missing.items() if fragments}
    if missing:
        raise SystemExit(f"Stars payment contract is incomplete: {missing}")
    battle_create = payments_sql.partition(
        "elsif p_intent->>'kind' = 'battle_create' then"
    )[2].partition("elsif p_intent->>'kind' = 'battle_accept' then")[0]
    battle_create_required = (
        "hashtextextended('battle-user:' || v_user_id::text, 0)",
        "status in ('preparing_share', 'waiting', 'lobby', 'active')",
        "raise_business_error(\n            'battle_already_participating'",
    )
    if any(fragment not in battle_create for fragment in battle_create_required):
        raise SystemExit(
            "Battle create top-up recovery must reject every active participation "
            "state with BATTLE_ALREADY_PARTICIPATING"
        )
    if "battle_share_preparing" in battle_create:
        raise SystemExit(
            "Battle create top-up recovery cannot special-case preparing_share"
        )


def verify_battle_contract() -> None:
    battle_sql = (SCHEMAS / "44_battle.sql").read_text(encoding="utf-8").lower()
    identity_sql = (SCHEMAS / "10_identity.sql").read_text(encoding="utf-8").lower()
    security_sql = one_migration("_api_security.sql").read_text(encoding="utf-8").lower()
    required = (
        "create table battle.rulesets",
        "create table battle.rooms",
        "accepted_at timestamptz",
        "lobby_expires_at timestamptz",
        "lobby_start_deadline timestamptz",
        "last_heartbeat_at timestamptz",
        "offline_since timestamptz",
        "presence_deadline timestamptz",
        "presence_lifecycle_version bigint",
        "presence_lease_id uuid",
        "presence_command_seq bigint",
        "presence_lease_active boolean",
        "create table battle.audit_entries",
        "create or replace function api.battle_prepare_room",
        "create or replace function api.battle_accept_room",
        "create or replace function api.battle_submit_action",
        "create or replace function api.battle_submit_forced_switch",
        "create or replace function battle.viewer_action_state",
        "create or replace function battle.safe_resolve_normal_turn",
        "create or replace function battle.safe_resolve_forced_switch",
        "create or replace function battle.safe_finalize_room",
        "create or replace function battle.lobby_terminal_reason",
        "create or replace function battle.lobby_invariant_error",
        "create or replace function battle.reconcile_lobby_presence",
        "create or replace function battle.advance_lobby",
        "create or replace function battle.lobby_json",
        "create or replace function battle.invalidation_channels",
        "create or replace function api.battle_claim_prepared_shares",
        "p_room_id uuid default null",
        "create or replace function api.battle_claim_outbox",
        "channels text[]",
        "create or replace function battle.monitor_invariants",
        "'battle-tick-v1'",
        "'1 second'",
        "for update skip locked",
        "pg_try_advisory_xact_lock",
        "perform battle.wake_integration('outbox')",
        "extensions.hmac(",
        "gen_random_bytes(32)",
        "char_length(prepared_message_id) between 1 and 256",
        "effect_key = element || '-' || substr(slot_id, 2)",
        "'prepare_deadline', case",
        "'prepared_message_id', case",
        "'viewer_action_state',",
        "'presence_lifecycle', jsonb_build_object(",
        "'effect_key', v_skill.effect_key",
        "'effect_key', p_result->'effect_key'",
        "p_presence_lease_id uuid",
        "p_presence_lifecycle_version bigint",
        "p_presence_command_seq bigint",
        "p_presence_lifecycle_version = v_participant.presence_lifecycle_version + 1",
        "and p_presence_command_seq > v_participant.presence_command_seq",
        "presence_lease_active = false",
        "count(*) filter (where p.side = 'creator') = 1",
        "count(*) filter (where p.side = 'opponent') = 1",
        "s.amount <> v_tier.entry_fee",
        "having count(tm.id) <> 3",
        "count(tm.id) filter (where tm.slot = 1 and tm.active) <> 1",
        "or exists (select 1 from battle.turns where room_id = p_room_id)",
        "e.kind = 'voided'",
        "e.public_payload->>'reason' = 'share_failed'",
        "'battle_unstarted_terminal_mismatch'",
        "where ir.status = 'released'",
        "terminal_refund.reason is distinct from 'battle_stake_refund'",
        "perform battle.void_room_after_invariant(\n        v_room.id, 'lobby_monitor:'",
    )
    missing = [fragment for fragment in required if fragment not in battle_sql]
    if missing:
        raise SystemExit(f"Battle database contract is incomplete: {missing}")
    if "battle_internal_room_context" in battle_sql or "private_seed_hex" in battle_sql:
        raise SystemExit("Battle private seed cannot be exposed through an api RPC")
    forbidden = (
        "creator_last_heartbeat_at",
        "creator_offline_since",
        "creator_online_window_seconds",
        "battle_creator_offline",
    )
    present = [fragment for fragment in forbidden if fragment in battle_sql]
    if present:
        raise SystemExit(f"Legacy Battle creator presence contract remains: {present}")
    if re.search(r"\bstart_param\s+text\b", identity_sql) or re.search(
        r"\bbattle_invite_token\s+text\b", identity_sql
    ):
        raise SystemExit("Identity must persist only the Battle invite token hash")
    if "'battle'" not in security_sql:
        raise SystemExit("Battle schema is missing from the explicit security migration")


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
    verify_identity_login_contract()
    verify_entry_handoff_contract()
    verify_stars_payment_contract()
    verify_battle_contract()

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
