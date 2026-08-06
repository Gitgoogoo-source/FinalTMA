#!/usr/bin/env python3
"""Enforce repository module ownership and gateway isolation."""

from __future__ import annotations

import json
import re
import subprocess
from pathlib import Path


ROOT = Path(__file__).resolve().parents[2]
MATRIX = ROOT / "docs/architecture/domain-map.md"
WEB_ROOT = ROOT / "apps/web/src"
API_ROOT = ROOT / "apps/api/src"
CONTRACT_ROOT = ROOT / "packages/api-contracts/src"
GAME_PAGE = WEB_ROOT / "pages/game/GamePage.tsx"
OPERATION_REGISTRY_PROVIDER = (
    WEB_ROOT / "workflows/operation-recovery/OperationRegistryProvider.tsx"
)
BATTLE_SCHEMA = ROOT / "supabase/schemas/44_battle.sql"
BATTLE_BASELINE_MIGRATION = (
    ROOT / "supabase/migrations/20260719104533_baseline.sql"
)
IMPORT_PATTERN = re.compile(r"(?:from\s+|import\()\s*[\"']([^\"']+)[\"']")
MODULE_IMPORT_PATTERN = re.compile(r"(?:from\s+|import\s*(?:\(\s*)?)[\"']([^\"']+)[\"']")
BATTLE_ACCEPT_FUNCTION_PATTERN = re.compile(
    r"create or replace function api\.battle_accept_room\(.*?\n\$\$;",
    re.DOTALL,
)
BATTLE_ACCEPT_SELF_GUARD_PATTERN = re.compile(
    r"if\s+v_room\.status\s*=\s*'waiting'\s+"
    r"and\s+v_room\.expires_at\s*>\s*now\(\)\s+"
    r"and\s+v_room\.creator_user_id\s*=\s*v_user_id\s+"
    r"then\s+perform\s+api\.raise_business_error\(\s*"
    r"'BATTLE_SELF_ACCEPT_FORBIDDEN'",
    re.DOTALL,
)

REQUIRED_PATHS = (
    "apps/web/src/app/guards",
    "apps/web/src/app/providers",
    "apps/web/src/app/recovery",
    "apps/web/src/app/router",
    "apps/web/src/app/shell",
    "apps/web/src/app/router/PersistentPages.tsx",
    "apps/web/src/shared/navigation/pageActivity.tsx",
    "apps/web/src/pages",
    "apps/web/src/domains",
    "apps/web/src/domains/battle",
    "apps/web/src/workflows/payment-recovery",
    "apps/web/src/workflows/battle-realtime",
    "docs/architecture/adr/ADR-013-session-page-lifecycle.md",
    "docs/architecture/adr/ADR-016-controlled-battle-acceptance-fixture.md",
    "docs/architecture/adr/ADR-022-battle-stage-skill-progression.md",
    "docs/architecture/adr/ADR-025-battle-active-switch-atomicity.md",
    "apps/api/src/entrypoints/app",
    "apps/api/src/entrypoints/integrations",
    "apps/api/src/entrypoints/jobs",
    "apps/api/src/http",
    "apps/api/src/domains",
    "apps/api/src/workflows",
    "apps/api/src/workflows/battle-share",
    "apps/api/src/workflows/battle-outbox",
    "packages/api-contracts/src/domains/battle/models.ts",
    "packages/api-contracts/src/domains/battle/routes.ts",
    "packages/api-contracts/src/registries/app.ts",
    "packages/api-contracts/src/registries/integrations.ts",
    "packages/api-contracts/src/registries/jobs.ts",
    "packages/api-contracts/src/registries/server.ts",
    "supabase/schemas",
    "tools/product_data",
    "contracts/ton",
)
FORBIDDEN_REFERENCES = (
    "packages/server",
    "packages/contracts",
    "chain/ton",
    "apps/web/src/features",
    "tools/catalog",
    "stars-payment-recovery",
    "navigation-intent-resume",
    "_catalog_v1.sql",
    "70_onchain.sql",
    "90_integrations.sql",
)
RETIRED_GAME_PATHS = (
    "apps/web/src/domains/world-rpg",
    "apps/web/public/assets/world-rpg",
    "assets/source/world-rpg",
    "generated/assets/world-rpg-v1.json",
    "tools/assets/generate-world-rpg.mjs",
    "docs/architecture/adr/ADR-011-world-rpg-local-runtime.md",
    "pokemon游戏开发规划.md",
    "游戏方案.md",
    "apps/web/src/domains/monster-tamer",
    "apps/web/public/monster-tamer",
    "assets/source/monster-tamer",
    "tools/monster-tamer",
    "docs/architecture/adr/ADR-011-monster-tamer-static-subapplication.md",
    "apps/web/src/app/router/backgroundPreload.ts",
    "monster玩法说明.md",
    "apps/api/dist/domains/monster-tamer",
    "apps/web/dist/monster-tamer",
    "packages/api-contracts/dist/domains/monster-tamer",
)
WEB_DOMAINS = {
    "album",
    "battle",
    "decomposition",
    "evolution",
    "expedition",
    "gacha",
    "inventory",
    "market",
    "mint",
    "referral",
    "tasks",
    "topup",
    "vip",
    "wallet",
    "wheel",
}
API_DOMAINS = {
    "album",
    "battle",
    "catalog",
    "decomposition",
    "evolution",
    "expedition",
    "gacha",
    "identity",
    "inventory",
    "market",
    "mint",
    "referral",
    "tasks",
    "topup",
    "vip",
    "wallet",
    "wheel",
}


def main() -> None:
    verify_domain_matrix()
    missing = [path for path in REQUIRED_PATHS if not (ROOT / path).exists()]
    if missing:
        raise SystemExit(f"Refactored architecture paths are missing: {missing}")
    retired = [path for path in RETIRED_GAME_PATHS if (ROOT / path).exists()]
    if retired:
        raise SystemExit(f"Retired game paths must remain deleted: {retired}")
    assert_directories(WEB_ROOT / "domains", WEB_DOMAINS, "Web domains")
    assert_directories(API_ROOT / "domains", API_DOMAINS, "API domains")
    assert_nonempty_domains(WEB_ROOT / "domains")
    assert_nonempty_domains(API_ROOT / "domains")
    verify_web_boundaries()
    verify_evolution_refresh_semantics()
    verify_operation_recovery_discovery()
    verify_game_page_boundary()
    verify_battle_legacy_removal()
    verify_battle_terminal_refresh_semantics()
    verify_battle_accept_operation_ordering()
    verify_battle_countdown_lock_semantics()
    verify_battle_switch_atomicity()
    verify_api_boundaries()
    verify_contract_boundaries()
    verify_documentation()
    verify_package_exports()
    verify_typescript_configuration()
    print("module ownership, gateway isolation, and product domains are traceable")


def verify_domain_matrix() -> None:
    text = MATRIX.read_text(encoding="utf-8")
    chapters = [int(value) for value in re.findall(r"^\|\s*(\d+)\s+", text, re.MULTILINE)]
    if chapters != list(range(1, 21)):
        raise SystemExit(f"Domain matrix must contain chapters 1 through 20 exactly once: {chapters}")
    rows = [line.split("|")[1:-1] for line in text.splitlines() if re.match(r"^\|\s*\d+\s+", line)]
    if any(len(row) != 5 or any(not cell.strip() for cell in row) for row in rows):
        raise SystemExit("Every domain matrix row must identify Web, API, database, and acceptance ownership")
    required_owners = ("payment-recovery", "decomposition", "evolution", "app/guards")
    missing = [owner for owner in required_owners if owner not in text]
    if missing:
        raise SystemExit(f"Domain matrix is missing physical owners: {missing}")


def verify_web_boundaries() -> None:
    violations: list[str] = []
    for source in typescript_files(WEB_ROOT):
        for specifier in imports(source):
            if specifier.startswith("@pokepets/api-contracts") and specifier != "@pokepets/api-contracts/app":
                violations.append(f"{relative(source)} imports forbidden contract {specifier}")
            target = resolve_relative(source, specifier)
            source_domain = child_after(source, WEB_ROOT / "domains")
            target_domain = child_after(target, WEB_ROOT / "domains") if target else None
            if source_domain and target_domain and source_domain != target_domain:
                violations.append(f"{relative(source)} imports Web domain {target_domain}")
            if target and "/domains/" in target.as_posix() and "/ui/" in target.as_posix():
                owner = child_after(source, WEB_ROOT)
                if owner not in {"app", "pages", "domains"}:
                    violations.append(f"{relative(source)} composes domain UI outside app/pages")
    if violations:
        raise SystemExit("Web boundary violations:\n" + "\n".join(sorted(violations)))
    page_source = "\n".join(path.read_text(encoding="utf-8") for path in (WEB_ROOT / "pages").rglob("*.tsx"))
    if "apiRequest(" in page_source or "useApiQuery(" in page_source or "platform/api" in page_source:
        raise SystemExit("Route pages must compose domain UI and cannot call the API directly")
    web_source = "\n".join(path.read_text(encoding="utf-8") for path in typescript_files(WEB_ROOT))
    if "@supabase" in web_source or "SUPABASE_SERVICE_ROLE" in web_source:
        raise SystemExit("The Web application cannot import Supabase or reference service-role secrets")
    forbidden_files = list((WEB_ROOT / "domains").rglob("api.ts")) + list((WEB_ROOT / "domains").rglob("model.ts"))
    if forbidden_files:
        raise SystemExit(f"Unused Web domain scaffolding remains: {[relative(path) for path in forbidden_files]}")
    missing_boundaries = [path.parent.name for path in (WEB_ROOT / "domains").glob("*/ui") if not (path.parent / "index.ts").is_file()]
    if missing_boundaries:
        raise SystemExit(f"Web domains must expose one public index.ts: {missing_boundaries}")
    persistent_pages = (WEB_ROOT / "app/router/PersistentPages.tsx").read_text(
        encoding="utf-8"
    )
    page_activity = (WEB_ROOT / "shared/navigation/pageActivity.tsx").read_text(
        encoding="utf-8"
    )
    lifecycle_terms = (
        "setVisitState({",
        "visitState.visited",
        "scrollPositions.current",
        "hidden={!active}",
        "inert={!active}",
        "PageActivityProvider",
        "search: active ? search : snapshot.search",
        'history.scrollRestoration = "manual"',
    )
    lifecycle_source = persistent_pages + page_activity
    missing_lifecycle_terms = [
        value for value in lifecycle_terms if value not in lifecycle_source
    ]
    if missing_lifecycle_terms:
        raise SystemExit(
            f"Session page lifecycle is incomplete: {missing_lifecycle_terms}"
        )
    shell_source = (WEB_ROOT / "app/shell/AppShell.tsx").read_text(
        encoding="utf-8"
    )
    missing_foreground_terms = [
        value
        for value in (
            "refreshForegroundState",
            "300_000",
            '"deactivated"',
            '"activated"',
            '"visibilitychange"',
        )
        if value not in shell_source
    ]
    if missing_foreground_terms:
        raise SystemExit(
            "Foreground correction boundary is incomplete: "
            f"{missing_foreground_terms}"
        )


def verify_evolution_refresh_semantics() -> None:
    source = OPERATION_REGISTRY_PROVIDER.read_text(encoding="utf-8")
    required_terms = (
        "const locallyRefreshedEvolutionIds = useRef(new Set<string>());",
        "locallyRefreshedEvolutionIds.current.clear();",
        "locallyRefreshedEvolutionIds.current.delete(id);",
        "const refreshAfterLocalSettlement = useCallback(",
        "refreshRouteScopes(routeId, { throwOnError: true });",
        'routeId === "inventory.evolve"',
        "locallyRefreshedEvolutionIds.current.add(id);",
        "const localSettlementRefreshSucceeded =",
        "locallyRefreshedEvolutionIds.current.has(operation.id);",
    )
    missing = [term for term in required_terms if term not in source]
    if missing:
        raise SystemExit(
            "Evolution authority refresh deduplication is incomplete: "
            f"{missing}"
        )

    run_start = source.index('const run: OperationRegistryValue["run"]')
    run_end = source.index("const hydrate = useCallback(")
    run_source = source[run_start:run_end]
    if run_source.count("refreshAfterLocalSettlement(id, routeId)") != 2:
        raise SystemExit(
            "Local evolution terminal paths must record exactly one successful "
            "authority refresh"
        )

    recover_start = source.index("const recover = useCallback(")
    recover_end = source.index("const pollingOperationId")
    recover_source = source[recover_start:recover_end]
    if "refreshAfterLocalSettlement" in recover_source:
        raise SystemExit(
            "Recovered evolution operations must not inherit the local refresh marker"
        )

    acknowledge_start = source.index(
        "const acknowledgeEvolutionResult = useCallback("
    )
    acknowledge_end = source.index("const defer = useCallback(")
    acknowledge_source = source[acknowledge_start:acknowledge_end]
    if acknowledge_source.count("if (!localSettlementRefreshSucceeded)") != 2:
        raise SystemExit(
            "Evolution acknowledgement must refresh only recovered operations or "
            "local operations whose first authority refresh failed"
        )
    nonpersistent_order = re.search(
        r"if \(!operation\.persistent\) \{.*?"
        r"if \(!localSettlementRefreshSucceeded\).*?"
        r"refreshRouteScopes\(\"inventory\.evolve\", \{.*?"
        r"throwOnError: true,.*?\}\);.*?remove\(operation\.id\);",
        acknowledge_source,
        re.DOTALL,
    )
    persistent_order = re.search(
        r"apiRequest\(\"inventory\.acknowledge_evolution_result\".*?"
        r"if \(!localSettlementRefreshSucceeded\).*?"
        r"refreshRouteScopes\(\"inventory\.evolve\", \{.*?"
        r"throwOnError: true,.*?\}\);.*?"
        r"acknowledgedIds\.current\.add\(operation\.id\);.*?"
        r"remove\(operation\.id\);",
        acknowledge_source,
        re.DOTALL,
    )
    if not nonpersistent_order or not persistent_order:
        raise SystemExit(
            "Evolution fallback refresh must succeed before the result layer is removed"
        )


def verify_operation_recovery_discovery() -> None:
    discovery_path = (
        WEB_ROOT
        / "workflows/operation-recovery/useRecoverableOperationDiscovery.ts"
    )
    retired_paths = (
        WEB_ROOT
        / "workflows/operation-recovery/usePersistentOperationDiscovery.ts",
        WEB_ROOT
        / "workflows/operation-recovery/useEvolutionResultRecovery.ts",
        WEB_ROOT
        / "workflows/operation-recovery/useGachaResultRecovery.ts",
    )
    remaining_retired_paths = [
        relative(path) for path in retired_paths if path.exists()
    ]
    if remaining_retired_paths:
        raise SystemExit(
            "Per-domain operation discovery hooks must remain deleted: "
            f"{remaining_retired_paths}"
        )
    if not discovery_path.is_file():
        raise SystemExit("Unified operation discovery hook is missing")

    discovery = discovery_path.read_text(encoding="utf-8")
    discovery_terms = (
        'apiRequest(\n          "operations.recoverable"',
        "const discoveryDelays = [1_000, 2_000, 3_000, 5_000, 30_000]",
        "document.visibilityState === \"visible\"",
        "subscribeTelegramActivity(activated, deactivated)",
        'window.addEventListener("online", connected)',
        'window.addEventListener("offline", disconnected)',
        "{ signal: controller.signal }",
        "inFlight?.abort()",
        "recoveryQueueActive",
        "if (recovered.length > 0) return;",
        "initialAuthorityCursor",
        "after_authority_cursor: currentAuthority.value",
        "response.data.authority_refresh_routes",
        "response.data.next_authority_cursor",
        "await refreshScopes(scopes, { throwOnError: true })",
    )
    missing_discovery_terms = [
        term for term in discovery_terms if term not in discovery
    ]
    if missing_discovery_terms:
        raise SystemExit(
            "Unified operation discovery lifecycle is incomplete: "
            f"{missing_discovery_terms}"
        )

    coordinator = (
        WEB_ROOT / "app/recovery/AppRecoveryCoordinator.tsx"
    ).read_text(encoding="utf-8")
    context = (
        WEB_ROOT / "workflows/operation-recovery/context.ts"
    ).read_text(encoding="utf-8")
    provider = OPERATION_REGISTRY_PROVIDER.read_text(encoding="utf-8")
    if (
        "useRecoverableOperationDiscovery(bootstrap.data?.authority_cursor);"
        not in coordinator
        or "recoveryQueueActive: boolean;" not in context
        or "wheelPresentationEpoch: number;" not in context
        or "serverAcknowledgementRouteIds.has(operation.routeId)" not in provider
        or 'operation.routeId === "wheel.spin"' not in provider
        or "recoveryQueueActive," not in provider
    ):
        raise SystemExit(
            "Operation discovery must pause while the current result queue is active"
        )

    contract = (
        CONTRACT_ROOT / "domains/operations/routes.ts"
    ).read_text(encoding="utf-8")
    if (
        'id: "operations.recoverable"' not in contract
        or 'path: "/api/operations/recoverable"' not in contract
        or contract.index('path: "/api/operations/recoverable"')
        > contract.index('path: "/api/operations/:operation_id"')
    ):
        raise SystemExit(
            "Static recoverable operation route must precede the operation-id route"
        )
    handlers = (
        API_ROOT / "workflows/operation-recovery/routes.ts"
    ).read_text(encoding="utf-8")
    schema = (ROOT / "supabase/schemas/30_operations.sql").read_text(
        encoding="utf-8"
    )
    backend_terms = (
        '"operations.recoverable": async (context)',
        'rpc("operations_recoverable"',
        "p_after_authority_cursor bigint",
        "'authority_refresh_routes'",
        "'next_authority_cursor'",
        "operations.user_authority_sequences",
        "o.use_case = 'wheel.spin' and o.status in ('pending', 'unknown')",
        "o.use_case = 'inventory.evolve' and o.result_acknowledged_at is null",
        "order by o.created_at, o.id",
    )
    backend_source = handlers + schema
    missing_backend_terms = [
        term for term in backend_terms if term not in backend_source
    ]
    if missing_backend_terms:
        raise SystemExit(
            "Unified operation discovery backend is incomplete: "
            f"{missing_backend_terms}"
        )

    legacy_source = "\n".join(
        path.read_text(encoding="utf-8")
        for path in (
            API_ROOT / "domains/gacha/routes.ts",
            API_ROOT / "domains/wheel/routes.ts",
            API_ROOT / "domains/evolution/routes.ts",
            CONTRACT_ROOT / "domains/gacha/routes.ts",
            CONTRACT_ROOT / "domains/wheel/routes.ts",
            CONTRACT_ROOT / "domains/inventory/routes.ts",
            ROOT / "supabase/schemas/40_gacha.sql",
            ROOT / "supabase/schemas/42_wheel.sql",
            ROOT / "supabase/schemas/43_evolution.sql",
        )
    )
    legacy_terms = (
        '"gacha.recovery"',
        '"wheel.recovery"',
        '"inventory.evolution_recovery"',
        "gacha_recoverable_results",
        "wheel_recoverable_results",
        "inventory_evolution_recoverable_results",
    )
    remaining_legacy_terms = [
        term for term in legacy_terms if term in legacy_source
    ]
    if remaining_legacy_terms:
        raise SystemExit(
            "Legacy per-domain recovery entry points remain: "
            f"{remaining_legacy_terms}"
        )

    removed_presentation_acknowledgement = (
        '"gacha.acknowledge_result"',
        "gacha_acknowledge_result",
        "/api/gacha/results/:operation_id/acknowledge",
        '"wheel.acknowledge_result"',
        "wheel_acknowledge_result",
        "/api/wheel/results/:operation_id/acknowledge",
    )
    acknowledgement_source = legacy_source + provider + "\n".join(
        path.read_text(encoding="utf-8")
        for path in (
            ROOT / "packages/api-contracts/openapi/openapi.json",
            ROOT / "supabase/migrations/20260719104533_baseline.sql",
            ROOT / "supabase/migrations/20260719104614_api_security.sql",
        )
    )
    remaining_presentation_acknowledgement = [
        term
        for term in removed_presentation_acknowledgement
        if term in acknowledgement_source
    ]
    if remaining_presentation_acknowledgement:
        raise SystemExit(
            "Gacha and wheel result presentation cannot retain server acknowledgement: "
            f"{remaining_presentation_acknowledgement}"
        )
    if (
        'operation.use_case === "gacha.open"' not in provider
        or "!serverAcknowledgementRouteIds.has(operation.use_case)" not in provider
        or "discardTransientPresentations" not in provider
        or "terminalPresentationAllowed: false" not in provider
        or "needsAuthorityRefreshAfterLeave" not in provider
        or "wheelPresentationEpoch" not in provider
        or "suppressTerminalPresentation" not in provider
        or "onConfirm={() => remove(active.id)}" not in provider
    ):
        raise SystemExit(
            "Non-evolution terminal results must be current-foreground presentation only"
        )

    identity_schema = (ROOT / "supabase/schemas/10_identity.sql").read_text(
        encoding="utf-8"
    )
    jobs_schema = (ROOT / "supabase/schemas/95_jobs.sql").read_text(
        encoding="utf-8"
    )
    operations_schema = (ROOT / "supabase/schemas/30_operations.sql").read_text(
        encoding="utf-8"
    )
    if (
        "o.use_case = 'inventory.evolve'" not in identity_schema
        or "o.use_case in ('wheel.spin', 'inventory.evolve')" in identity_schema
        or "o.use_case = 'inventory.evolve' and o.result_acknowledged_at is null"
        not in jobs_schema
        or "use_case in ('wheel.spin', 'inventory.evolve')" in jobs_schema
    ):
        raise SystemExit(
            "Wheel terminal results must not enter bootstrap blocking or acknowledgement retention"
        )
    authority_terms = (
        "'authority_cursor'",
        "operations.user_authority_sequences",
        "authority_sequence",
        "payload_purged_at",
        "operations_assign_authority_sequence",
        "OPERATION_RESULT_EXPIRED",
    )
    authority_source = identity_schema + operations_schema + jobs_schema
    missing_authority_terms = [
        term for term in authority_terms if term not in authority_source
    ]
    if missing_authority_terms:
        raise SystemExit(
            "Operation authority convergence and payload retention are incomplete: "
            f"{missing_authority_terms}"
        )
    if "delete from operations.operations" in jobs_schema.lower():
        raise SystemExit(
            "Idempotency cleanup must compact payloads without deleting operation anchors"
        )
    cleanup_terms = (
        "o.completed_at < now() - interval '30 days'",
        "for update of o skip locked",
        "delete from wheel.results",
        "set request = null",
        "result = null",
        "payload_purged_at = now()",
    )
    missing_cleanup_terms = [term for term in cleanup_terms if term not in jobs_schema]
    if missing_cleanup_terms:
        raise SystemExit(
            "Operation payload compaction is incomplete: "
            f"{missing_cleanup_terms}"
        )

    recovery_document = (
        ROOT / "docs/architecture/operation-recovery.md"
    ).read_text(encoding="utf-8")
    recovery_adr = (
        ROOT / "docs/architecture/adr/ADR-005-operation-recovery.md"
    ).read_text(encoding="utf-8")
    lifecycle_adr = (
        ROOT / "docs/architecture/adr/ADR-013-session-page-lifecycle.md"
    ).read_text(encoding="utf-8")
    if any(
        "/api/operations/recoverable" not in document
        for document in (recovery_document, recovery_adr, lifecycle_adr)
    ) or any(
        term not in recovery_document + lifecycle_adr
        for term in ("deactivated", "offline", "中止", "队列清空", "立即追赶")
    ):
        raise SystemExit(
            "Operation discovery lifecycle documentation is incomplete"
        )


def verify_game_page_boundary() -> None:
    game_page = GAME_PAGE.read_text(encoding="utf-8")
    if (
        'import { BattleView } from "../../domains/battle/index.ts";'
        not in game_page
        or '<main className="page game-page" aria-label="Battle">'
        not in game_page
        or "<BattleView />" not in game_page
    ):
        raise SystemExit("Game page must compose the Battle Web domain")

    battle_source = "\n".join(
        path.read_text(encoding="utf-8")
        for path in (WEB_ROOT / "domains/battle").rglob("*")
        if path.suffix in {".ts", ".tsx"}
    )
    battle_realtime = (
        WEB_ROOT / "workflows/battle-realtime/useBattleRealtime.ts"
    ).read_text(encoding="utf-8")
    required_battle_terms = (
        'data-battle-page-state={pageState}',
        "viewer_action_state",
        "prepared_message_id",
        "prepare_deadline",
        "effect_key",
        "active_action_mode",
        "latest_action_sequence",
        "action_events",
        "after_action_sequence",
        "battlePresentationActionKey",
        "onPresentationBusyChange",
        "prefers-reduced-motion: reduce",
        'apiKeepaliveRequest("battle.offline"',
        '"battle.heartbeat",',
        "presence_lease_id",
        "presence_lifecycle_version",
        "presence_command_seq",
        "heartbeatRequests.current",
        "request.abort()",
        '"pageshow"',
    )
    missing_battle_terms = [
        value
        for value in required_battle_terms
        if value not in battle_source
        and value
        not in (WEB_ROOT / "domains/battle/ui/battle.css").read_text(
            encoding="utf-8"
        )
    ]
    if missing_battle_terms:
        raise SystemExit(
            f"Battle Web authority and lifecycle are incomplete: {missing_battle_terms}"
        )
    removed_battle_terms = (
        "active_select",
        "forced_switch",
        "resolution_event",
        "reveal_ends_at",
        "turn_no",
        ".priority",
    )
    legacy_battle_terms = [
        value for value in removed_battle_terms if value in battle_source
    ]
    if legacy_battle_terms:
        raise SystemExit(
            f"Legacy Battle Web state remains: {legacy_battle_terms}"
        )
    battle_screens = (
        WEB_ROOT / "domains/battle/ui/BattleScreens.tsx"
    ).read_text(encoding="utf-8")
    countdown_terms = (
        'className="battle-countdown-lock"',
        'aria-modal="true"',
        "倒计时已锁定",
        "离开不会取消战斗",
        "服务器将在截止时自动进入对战",
    )
    missing_countdown_terms = [
        value for value in countdown_terms if value not in battle_screens
    ]
    if missing_countdown_terms:
        raise SystemExit(
            "Battle locked countdown page is incomplete: "
            f"{missing_countdown_terms}"
        )
    battle_css = (WEB_ROOT / "domains/battle/ui/battle.css").read_text(
        encoding="utf-8"
    )
    countdown_rule = battle_css.partition(".battle-countdown-lock {")[2].partition(
        "}"
    )[0]
    countdown_css_terms = (
        "position: fixed",
        "inset: 0",
        "z-index: 200",
        "min-height: 100dvh",
        "touch-action: none",
    )
    missing_countdown_css = [
        value for value in countdown_css_terms if value not in countdown_rule
    ]
    if missing_countdown_css or (
        ".app-shell:has(.battle-countdown-lock) .topbar" not in battle_css
        or ".app-shell:has(.battle-countdown-lock) .bottom-nav" not in battle_css
    ):
        raise SystemExit(
            "Battle countdown must cover the viewport and both navigation bars: "
            f"{missing_countdown_css}"
        )
    lobby_source = battle_screens.partition(
        "export function BattleLobby"
    )[2].partition("export function BattleInviteMissing")[0]
    if (
        "creator_avatar_url" in lobby_source
        or "opponent_avatar_url" in lobby_source
        or "/assets/catalog/v1/thumb/pet-n-001-1.webp" not in lobby_source
        or "/assets/catalog/v1/thumb/pet-n-002-1.webp" not in lobby_source
        or "<UserRound" not in lobby_source
    ):
        raise SystemExit(
            "Battle lobby must use fixed red/blue repository WebP assets and "
            "neutral offline icons only"
        )
    required_realtime_terms = (
        '"battle.realtime_token"',
        "battleRealtimeInvalidationSchema.safeParse",
        "return 1_000",
        "return 2_000",
        "channel.unsubscribe",
        "client.close()",
    )
    missing_realtime_terms = [
        value for value in required_realtime_terms if value not in battle_realtime
    ]
    if missing_realtime_terms:
        raise SystemExit(
            f"Battle realtime invalidation boundary is incomplete: {missing_realtime_terms}"
        )

    tasks_view = (
        WEB_ROOT / "domains/tasks/ui/TasksView.tsx"
    ).read_text(encoding="utf-8")
    task_visibility = (
        WEB_ROOT / "domains/tasks/visibility.ts"
    ).read_text(encoding="utf-8")
    tasks_page = (
        WEB_ROOT / "pages/tasks/TasksPage.tsx"
    ).read_text(encoding="utf-8")
    task_highlight = (
        WEB_ROOT / "workflows/task-navigation/TaskHighlightBanner.tsx"
    ).read_text(encoding="utf-8")
    payment_resume = (
        WEB_ROOT
        / "workflows/payment-recovery/useNavigationIntentResume.ts"
    ).read_text(encoding="utf-8")
    if (
        "{afterCheckIn}" not in tasks_view
        or tasks_view.index("{afterCheckIn}")
        > tasks_view.index('id="task-filters"')
        or "<TasksView afterCheckIn={<WheelPanel />} />" not in tasks_page
        or 'key: "expedition"' in tasks_view
        or 'key: "wallet"' in tasks_view
        or 'key: "mint"' in tasks_view
        or "filter(isVisibleMvpTask)" not in tasks_view
        or "/tasks?focus=wheel" not in tasks_view
        or "filter(isVisibleMvpTask)" not in task_highlight
        or 'task.category !== "expedition"' not in task_visibility
        or 'task.category !== "wallet"' not in task_visibility
        or 'task.category !== "mint"' not in task_visibility
        or "/tasks?focus=wheel" not in task_highlight
        or "navigate(`/tasks?${params.toString()}`)" not in payment_resume
    ):
        raise SystemExit(
            "Tasks page must own Wheel and hide Expedition, wallet, and Mint tasks"
        )

    app_router = (WEB_ROOT / "app/router/AppRouter.tsx").read_text(
        encoding="utf-8"
    )
    inventory_page = (WEB_ROOT / "pages/inventory/InventoryPage.tsx").read_text(
        encoding="utf-8"
    )
    top_asset_bar = (WEB_ROOT / "app/shell/TopAssetBar.tsx").read_text(
        encoding="utf-8"
    )
    global_dialogs = (WEB_ROOT / "app/shell/GlobalDialogs.tsx").read_text(
        encoding="utf-8"
    )
    recovery = (WEB_ROOT / "app/recovery/AppRecoveryCoordinator.tsx").read_text(
        encoding="utf-8"
    )
    bootstrap = (
        WEB_ROOT / "workflows/session-bootstrap/useBootstrap.ts"
    ).read_text(encoding="utf-8")
    vercel = (ROOT / "vercel.json").read_text(encoding="utf-8")
    if (
        "MintPage" in app_router
        or "mint/:templateId" in app_router
        or "inventory-action-button--mint" in inventory_page
        or 'useApiQuery("wallet.get")' in top_asset_bar
        or "WalletDialog" in global_dialogs
        or "useMintRecovery" in recovery
        or 'prefetchApiQuery("wallet.get")' in bootstrap
        or '"/api/jobs/reconcile-mints"' in vercel
    ):
        raise SystemExit(
            "Current MVP must not expose wallet/Mint UI, routing, recovery, prefetch, or Cron"
        )


def verify_battle_legacy_removal() -> None:
    files = {
        BATTLE_SCHEMA,
        BATTLE_BASELINE_MIGRATION,
        ROOT / "supabase/migrations/20260719104602_product_data_v1.sql",
        ROOT / "supabase/migrations/20260719104614_api_security.sql",
        ROOT / "tools/product_data/battle.py",
        ROOT / "packages/api-contracts/src/common/errors.ts",
        ROOT / "packages/api-contracts/src/domains/battle/models.ts",
        ROOT / "packages/api-contracts/src/domains/battle/routes.ts",
        ROOT / "packages/api-contracts/openapi/openapi.json",
    }
    for parent, suffixes in (
        (ROOT / "generated/battle", {".json", ".sql"}),
        (API_ROOT / "domains/battle", {".ts"}),
        (WEB_ROOT / "domains/battle", {".ts", ".tsx"}),
        (WEB_ROOT / "workflows/battle-realtime", {".ts", ".tsx"}),
    ):
        files.update(
            path for path in parent.rglob("*") if path.suffix in suffixes
        )

    patterns = {
        "old selection state": re.compile(r"\bactive_select\b"),
        "old reveal phase": re.compile(r"(?<![A-Za-z0-9_])reveal(?![A-Za-z0-9_])"),
        "old reveal deadline": re.compile(r"\breveal_ends_at\b"),
        "old switch phase or route": re.compile(r"\bforced_switch\b|forced-switch"),
        "old single resolution event": re.compile(r"\bresolution_event\b"),
        "old action lock error": re.compile(r"\bBATTLE_ACTION_ALREADY_LOCKED\b"),
        "old turn number": re.compile(r"\b(?:current_)?turn_no\b"),
        "old deferred transition": re.compile(r"\bnext_status\b|\bpending_result\b"),
        "old dual-action resolver": re.compile(
            r"\b(?:safe_)?resolve_normal_turn\b|\badvance_reveal\b"
        ),
        "skill priority": re.compile(r"\bpriority\b"),
    }
    violations: dict[str, list[str]] = {}
    for path in sorted(files):
        source = path.read_text(encoding="utf-8")
        found = [label for label, pattern in patterns.items() if pattern.search(source)]
        if found:
            violations[relative(path)] = found
    if violations:
        raise SystemExit(
            f"Legacy Battle contract or generated artifact remains: {violations}"
        )


def verify_battle_terminal_refresh_semantics() -> None:
    checker = ROOT / "tools/architecture/check_battle_terminal_refresh.mjs"
    result = subprocess.run(
        ["node", str(checker), "--self-test"],
        cwd=ROOT,
        capture_output=True,
        check=False,
        text=True,
    )
    if result.returncode != 0:
        detail = result.stderr.strip() or result.stdout.strip()
        raise SystemExit(detail or "Battle terminal refresh structure check failed")


def verify_battle_accept_operation_ordering() -> None:
    sources = {
        relative(BATTLE_SCHEMA): BATTLE_SCHEMA.read_text(encoding="utf-8"),
        relative(BATTLE_BASELINE_MIGRATION): BATTLE_BASELINE_MIGRATION.read_text(
            encoding="utf-8"
        ),
    }
    for label, source in sources.items():
        verify_battle_accept_source(label, source)

    label, source = next(iter(sources.items()))
    function = extract_battle_accept_function(label, source)
    begin_command = re.search(
        r"\n  v_operation := operations\.begin_command\(.*?\n  \);\n",
        function,
        re.DOTALL,
    )
    if begin_command is None:
        raise SystemExit("Battle accept ordering self-test cannot locate begin_command")
    negative_function = function.replace(begin_command.group(), "", 1).replace(
        "  select s.battle_invite_token_hash into v_invite_hash\n",
        begin_command.group().lstrip("\n")
        + "  select s.battle_invite_token_hash into v_invite_hash\n",
        1,
    )
    negative_source = source.replace(function, negative_function, 1)
    if negative_source == source:
        raise SystemExit("Battle accept ordering negative variant did not mutate")
    try:
        verify_battle_accept_source("in-memory operation-before-self-guard", negative_source)
    except ValueError as error:
        if "before operation reserve" not in str(error):
            raise SystemExit(
                "Battle accept ordering negative variant failed for an unrelated reason: "
                f"{error}"
            ) from error
    else:
        raise SystemExit(
            "Battle accept ordering checker accepted operation-before-self-guard"
        )


def extract_battle_accept_function(label: str, source: str) -> str:
    functions = BATTLE_ACCEPT_FUNCTION_PATTERN.findall(source)
    if len(functions) != 1:
        raise ValueError(
            f"{label}: expected exactly one api.battle_accept_room definition"
        )
    return functions[0]


def verify_battle_accept_source(label: str, source: str) -> None:
    function = extract_battle_accept_function(label, source)
    normalized = re.sub(r"\s+", " ", function)
    session_user = normalized.find(
        "v_user_id uuid := api.session_user(p_session_id);"
    )
    session_lock = normalized.find(
        "select s.battle_invite_token_hash into v_invite_hash "
        "from identity.sessions s where s.id = p_session_id "
        "and s.user_id = v_user_id and s.revoked_at is null "
        "and s.expires_at > now() for update;"
    )
    room_lock = normalized.find(
        "select * into v_room from battle.rooms r "
        "where r.room_mode = 'friend_invite' "
        "and r.invite_token_hash = v_invite_hash for update;"
    )
    self_guard = BATTLE_ACCEPT_SELF_GUARD_PATTERN.search(function)
    begin_command = normalized.find("v_operation := operations.begin_command(")
    rate_limit = normalized.find(
        "perform battle.consume_rate_limit(v_operation.user_id, 'accept', v_invite_hash);"
    )
    if (
        session_user < 0
        or session_lock < 0
        or room_lock < 0
        or self_guard is None
        or begin_command < 0
        or rate_limit < 0
    ):
        raise ValueError(
            f"{label}: Battle accept trusted self guard structure is incomplete"
        )
    normalized_self_guard = len(re.sub(r"\s+", " ", function[: self_guard.start()]))
    if not (
        session_user
        < session_lock
        < room_lock
        < normalized_self_guard
        < begin_command
        < rate_limit
    ):
        raise ValueError(
            f"{label}: Battle valid-self guard must run before operation reserve "
            "and accept rate-limit writes"
        )
    if function.count("BATTLE_SELF_ACCEPT_FORBIDDEN") != 1:
        raise ValueError(
            f"{label}: Battle accept must have exactly one pre-operation self guard"
        )


def extract_sql_function(label: str, source: str, name: str) -> str:
    pattern = re.compile(
        rf"create or replace function {re.escape(name)}\(.*?\n\$\$;",
        re.DOTALL,
    )
    functions = pattern.findall(source)
    if len(functions) != 1:
        raise SystemExit(f"{label}: expected exactly one {name} definition")
    return functions[0]


def verify_battle_countdown_lock_semantics() -> None:
    sources = {
        relative(BATTLE_SCHEMA): BATTLE_SCHEMA.read_text(encoding="utf-8"),
        relative(BATTLE_BASELINE_MIGRATION): BATTLE_BASELINE_MIGRATION.read_text(
            encoding="utf-8"
        ),
    }
    definitions: dict[str, dict[str, str]] = {}
    for label, source in sources.items():
        terminal = extract_sql_function(
            label, source, "battle.lobby_terminal_reason"
        )
        reconcile = extract_sql_function(
            label, source, "battle.reconcile_lobby_presence"
        )
        advance = extract_sql_function(label, source, "battle.advance_lobby")
        cancel = extract_sql_function(label, source, "api.battle_cancel_room")
        definitions[label] = {
            "terminal": terminal,
            "reconcile": reconcile,
            "advance": advance,
            "cancel": cancel,
        }

        if terminal.count("when r.status = 'lobby_waiting'") != 3:
            raise SystemExit(
                f"{label}: lobby timeouts and bans must apply only before countdown lock"
            )
        if "if v_room.status = 'lobby_countdown' then return; end if;" not in reconcile:
            raise SystemExit(
                f"{label}: countdown reconciliation must preserve the locked deadline"
            )
        if (
            "lobby_countdown_stopped" in source
            or "set status = 'lobby_waiting'," in reconcile
            or "lobby_start_deadline = null" in reconcile
        ):
            raise SystemExit(
                f"{label}: countdown presence handling can still stop or reset the lock"
            )
        countdown_start_terms = (
            "v_room.status = 'lobby_waiting'",
            "v_both_online",
            ") <= v_room.lobby_expires_at",
            "set status = 'lobby_countdown'",
            "'lobby_countdown_started'",
        )
        missing_start_terms = [
            value for value in countdown_start_terms if value not in reconcile
        ]
        if missing_start_terms:
            raise SystemExit(
                f"{label}: atomic countdown start is incomplete: {missing_start_terms}"
            )
        if (
            "v_online_count" in advance
            or "last_heartbeat_at >" in advance
            or "offline_since is null" in advance
        ):
            raise SystemExit(
                f"{label}: deadline advance must not recheck participant presence"
            )
        advance_terms = (
            "v_room.status <> 'lobby_countdown'",
            "v_room.lobby_start_deadline > now()",
            "v_opponent_lead.speed > v_creator_lead.speed",
            "else 'creator'",
            "set status = 'active_turn'",
            "first_actor_side = v_first_actor_side",
            "active_actor_side = v_first_actor_side",
            "current_round_no = 1",
            "current_action_ordinal = 1",
            "insert into battle.turns",
        )
        missing_advance_terms = [
            value for value in advance_terms if value not in advance
        ]
        if missing_advance_terms or advance.count("'battle_started'") != 1:
            raise SystemExit(
                f"{label}: countdown deadline must start Battle exactly once: "
                f"{missing_advance_terms}"
            )
        if "v_room.status not in ('preparing_share', 'waiting')" not in cancel:
            raise SystemExit(
                f"{label}: explicit cancel must reject an accepted or locked room"
            )

    schema_definitions, migration_definitions = definitions.values()
    if schema_definitions != migration_definitions:
        raise SystemExit(
            "Battle countdown functions differ between declarative schema and baseline migration"
        )


def verify_battle_switch_atomicity() -> None:
    sources = {
        relative(BATTLE_SCHEMA): BATTLE_SCHEMA.read_text(encoding="utf-8"),
        relative(BATTLE_BASELINE_MIGRATION): BATTLE_BASELINE_MIGRATION.read_text(
            encoding="utf-8"
        ),
    }
    definitions: dict[str, dict[str, str]] = {}
    for label, source in sources.items():
        switch_member = extract_sql_function(
            label, source, "battle.switch_active_member"
        )
        active_action = extract_sql_function(
            label, source, "battle.resolve_active_action"
        )
        definitions[label] = {
            "switch_member": switch_member,
            "active_action": active_action,
        }

        normalized = re.sub(r"\s+", " ", switch_member.lower())
        required = (
            "update battle.team_members set active = false where participant_id = p_participant_id and active;",
            "update battle.team_members set active = true where participant_id = p_participant_id and slot = p_target_slot and alive;",
            "if not found then raise exception using errcode = 'p0001', message = 'battle_invariant'",
        )
        missing = [fragment for fragment in required if fragment not in normalized]
        if missing:
            raise SystemExit(
                f"{label}: Battle switch must deactivate before activating: {missing}"
            )
        if "set active = slot =" in source.lower():
            raise SystemExit(
                f"{label}: Battle switch cannot depend on multi-row UPDATE order"
            )
        if active_action.count("perform battle.switch_active_member(") != 2:
            raise SystemExit(
                f"{label}: switch and replace_attack must use the atomic switch helper"
            )

    schema_definitions, migration_definitions = definitions.values()
    if schema_definitions != migration_definitions:
        raise SystemExit(
            "Battle switch functions differ between declarative schema and baseline migration"
        )


def verify_api_boundaries() -> None:
    violations: list[str] = []
    for source in typescript_files(API_ROOT):
        for specifier in imports(source):
            target = resolve_relative(source, specifier)
            source_domain = child_after(source, API_ROOT / "domains")
            target_domain = child_after(target, API_ROOT / "domains") if target else None
            if source_domain and target_domain and source_domain != target_domain:
                violations.append(f"{relative(source)} imports API domain {target_domain}")
            if target and API_ROOT.parent.parent / "web" in target.parents:
                violations.append(f"{relative(source)} imports Web code")
    for gateway in ("app", "integrations", "jobs"):
        directory = API_ROOT / "entrypoints" / gateway
        allowed_contracts = {f"@pokepets/api-contracts/{gateway}", "@pokepets/api-contracts/common"}
        for source in typescript_files(directory):
            for specifier in imports(source):
                if specifier.startswith("@pokepets/api-contracts/") and specifier not in allowed_contracts:
                    violations.append(f"{relative(source)} imports another gateway contract {specifier}")
                target = resolve_relative(source, specifier)
                target_gateway = child_after(target, API_ROOT / "entrypoints") if target else None
                if target_gateway and target_gateway != gateway:
                    violations.append(f"{relative(source)} imports entrypoint {target_gateway}")
    if violations:
        raise SystemExit("API boundary violations:\n" + "\n".join(sorted(violations)))
    if (API_ROOT / "domains/index.ts").exists():
        raise SystemExit("The global API domain registry is forbidden")
    invalid = [relative(path) for path in (API_ROOT / "domains").rglob("*.ts") if path.name != "routes.ts"]
    if invalid:
        raise SystemExit(f"API domain files violate the fixed structure: {invalid}")
    for gateway in ("app", "integrations", "jobs"):
        handlers = API_ROOT / "entrypoints" / gateway / "handlers.ts"
        if not handlers.is_file() or "satisfies Record<RouteId, RouteHandler>" not in handlers.read_text(encoding="utf-8"):
            raise SystemExit(f"{gateway} must own a complete typed handler map")


def verify_contract_boundaries() -> None:
    derived = [
        relative(path)
        for path in (CONTRACT_ROOT / "domains").rglob("*.ts")
        if path.name in {"schemas.ts", "errors.ts", "index.ts"}
    ]
    if derived:
        raise SystemExit(f"Derived contract scaffolding remains: {derived}")
    generator = ROOT / "packages/api-contracts/scripts/generate-openapi.ts"
    if 'from "../src/server.ts"' not in generator.read_text(encoding="utf-8"):
        raise SystemExit("OpenAPI generation must use the server registry")
    app_registry = (
        CONTRACT_ROOT / "registries/app.ts"
    ).read_text(encoding="utf-8")
    jobs_registry = (
        CONTRACT_ROOT / "registries/jobs.ts"
    ).read_text(encoding="utf-8")
    server_registry = (
        CONTRACT_ROOT / "registries/server.ts"
    ).read_text(encoding="utf-8")
    if (
        "export const dormantRoutes = [...walletRoutes, ...mintRoutes]" not in app_registry
        or "return findRouteIn(activeRoutes" not in app_registry
        or "return findRouteByPathIn(activeRoutes" not in app_registry
        or 'route.id !== "jobs.reconcile_mints"' not in jobs_registry
        or "return findRouteIn(activeRoutes" not in jobs_registry
        or "return findRouteByPathIn(activeRoutes" not in jobs_registry
        or "...activeAppRoutes" not in server_registry
        or "...activeJobRoutes" not in server_registry
    ):
        raise SystemExit(
            "Wallet, Mint, and Mint reconciliation must remain outside current runtime registries"
        )
    battle_routes = (
        CONTRACT_ROOT / "domains/battle/routes.ts"
    ).read_text(encoding="utf-8")
    battle_models = (
        CONTRACT_ROOT / "domains/battle/models.ts"
    ).read_text(encoding="utf-8")
    presence_contract = (
        "presence_lease_id",
        "presence_lifecycle_version",
        "presence_command_seq",
    )
    missing_presence_contract = [
        value for value in presence_contract if value not in battle_routes
    ]
    for value in ("presence_lifecycle", "lease_id", "last_command_seq", "active"):
        if value not in battle_models:
            missing_presence_contract.append(value)
    if missing_presence_contract:
        raise SystemExit(
            "Battle presence contract is incomplete: "
            f"{missing_presence_contract}"
        )
    lobby_schema = battle_models.partition(
        "export const battleLobbySchema"
    )[2].partition("const battlePublicSwitchTargetSchema")[0]
    if "avatar" in lobby_schema or "image_" in lobby_schema:
        raise SystemExit("BattleLobbyDto cannot expose real avatars or team images")
    for route_id in ("battle.heartbeat", "battle.offline"):
        route_block = battle_routes.partition(f'id: "{route_id}"')[2].partition(
            "defineRoute({"
        )[0]
        if (
            "input: battlePresenceCommandSchema" not in route_block
            or 'refreshScopes: ["battle", "assets", "inventory"]'
            not in route_block
        ):
            raise SystemExit(
                f"{route_id} must keep strict monotonic presence input and "
                "terminal refresh scopes"
            )


def verify_documentation() -> None:
    documents = [path for path in (ROOT / "docs").rglob("*.md") if path != ROOT / "docs/product/功能说明文档.md"]
    documentation = "\n".join(path.read_text(encoding="utf-8") for path in documents)
    stale = [value for value in FORBIDDEN_REFERENCES if value in documentation]
    if stale:
        raise SystemExit(f"Documentation still references removed architecture paths: {stale}")
    data = (ROOT / "docs/architecture/data-transactions.md").read_text(encoding="utf-8")
    required = ("gacha.boxes", "payments.topup_products", "evolution.pity", "70_wallet", "71_mint", "90_payment_callbacks", "91_mint_reconciliation")
    missing = [value for value in required if value not in data]
    if missing:
        raise SystemExit(f"Database ownership documentation is incomplete: {missing}")
    lifecycle_adr = ROOT / "docs/architecture/adr/ADR-013-session-page-lifecycle.md"
    lifecycle_documentation = lifecycle_adr.read_text(encoding="utf-8")
    required_lifecycle_terms = (
        "五个主页面",
        "首次访问时挂载",
        "不因路由切换卸载",
        "五分钟",
        "refreshScopes",
        "Session generation",
        "不写入 `localStorage`",
    )
    missing_lifecycle_documentation = [
        value
        for value in required_lifecycle_terms
        if value not in lifecycle_documentation
    ]
    if missing_lifecycle_documentation:
        raise SystemExit(
            "Session page lifecycle ADR is incomplete: "
            f"{missing_lifecycle_documentation}"
        )
    fixture_adr = (
        ROOT / "docs/architecture/adr/ADR-016-controlled-battle-acceptance-fixture.md"
    ).read_text(encoding="utf-8")
    required_fixture_terms = (
        "`admin.reconcile_battle_fixture`",
        "`admin.battle_fixture_status`",
        "`SECURITY INVOKER`",
        "`PUBLIC`、`anon`、`authenticated` 与 `service_role`",
        "`environment = real_development`",
        "不超过 24 小时",
        "fixture-owned provenance",
        "同 request UUID 不同 payload",
        "不同 request UUID",
        "`PET-N-001-1 ×2`",
        "`PET-A-016-3 ×1`",
        "不改变 Battle 玩法",
    )
    missing_fixture_terms = [
        value for value in required_fixture_terms if value not in fixture_adr
    ]
    if missing_fixture_terms:
        raise SystemExit(
            "Controlled Battle fixture ADR is incomplete: "
            f"{missing_fixture_terms}"
        )
    countdown_documents = {
        "Battle功能方向说明.md": (ROOT / "Battle功能方向说明.md").read_text(
            encoding="utf-8"
        ),
        "Battle功能开发方案.md": (ROOT / "Battle功能开发方案.md").read_text(
            encoding="utf-8"
        ),
        "docs/product/功能说明文档.md": (
            ROOT / "docs/product/功能说明文档.md"
        ).read_text(encoding="utf-8"),
        "docs/architecture/data-transactions.md": (
            ROOT / "docs/architecture/data-transactions.md"
        ).read_text(encoding="utf-8"),
        "docs/architecture/runtime.md": (
            ROOT / "docs/architecture/runtime.md"
        ).read_text(encoding="utf-8"),
        "docs/architecture/security-boundaries.md": (
            ROOT / "docs/architecture/security-boundaries.md"
        ).read_text(encoding="utf-8"),
        "docs/operations/acceptance.md": (
            ROOT / "docs/operations/acceptance.md"
        ).read_text(encoding="utf-8"),
    }
    countdown_required = ("lobby_waiting", "lobby_countdown")
    incomplete_countdown_documents = {
        label: [value for value in countdown_required if value not in source]
        for label, source in countdown_documents.items()
        if any(value not in source for value in countdown_required)
    }
    if incomplete_countdown_documents:
        raise SystemExit(
            "Battle countdown lock documentation is incomplete: "
            f"{incomplete_countdown_documents}"
        )
    countdown_ui_documents = {
        label: countdown_documents[label]
        for label in (
            "Battle功能方向说明.md",
            "Battle功能开发方案.md",
            "docs/product/功能说明文档.md",
            "docs/architecture/runtime.md",
            "docs/operations/acceptance.md",
        )
    }
    incomplete_countdown_ui = {
        label: [
            value
            for value in ("倒计时已锁定", "离开不会取消战斗")
            if value not in source
        ]
        for label, source in countdown_ui_documents.items()
        if "倒计时已锁定" not in source or "离开不会取消战斗" not in source
    }
    if incomplete_countdown_ui:
        raise SystemExit(
            "Battle countdown UI documentation is incomplete: "
            f"{incomplete_countdown_ui}"
        )
    obsolete_countdown_requirements = (
        "到期再次确认在线",
        "3 秒倒计时开始/中止/完整重启",
        "任一方离线即中止倒计时",
    )
    conflicting_countdown_documents = {
        label: [
            value for value in obsolete_countdown_requirements if value in source
        ]
        for label, source in countdown_documents.items()
        if any(value in source for value in obsolete_countdown_requirements)
    }
    if conflicting_countdown_documents:
        raise SystemExit(
            "Battle documentation still requires a cancellable countdown: "
            f"{conflicting_countdown_documents}"
        )


def verify_package_exports() -> None:
    package = json.loads((ROOT / "packages/api-contracts/package.json").read_text(encoding="utf-8"))
    exports = set(package.get("exports", {}))
    expected = {"./app", "./common", "./integrations", "./jobs", "./server"}
    if exports != expected:
        raise SystemExit(f"Contract exports mismatch: expected {sorted(expected)}, found {sorted(exports)}")


def verify_typescript_configuration() -> None:
    source = "\n".join(
        path.read_text(encoding="utf-8")
        for path in ROOT.rglob("tsconfig*.json")
        if "node_modules" not in path.parts
    )
    if '"paths"' in source:
        raise SystemExit("TypeScript paths cannot hide missing workspace dependencies")


def imports(path: Path) -> list[str]:
    return IMPORT_PATTERN.findall(path.read_text(encoding="utf-8"))


def resolve_relative(source: Path, specifier: str) -> Path | None:
    if not specifier.startswith("."):
        return None
    return (source.parent / specifier).resolve()


def child_after(path: Path | None, parent: Path) -> str | None:
    if path is None:
        return None
    try:
        return path.relative_to(parent).parts[0]
    except (ValueError, IndexError):
        return None


def typescript_files(parent: Path) -> list[Path]:
    return sorted([*parent.rglob("*.ts"), *parent.rglob("*.tsx")])


def assert_directories(parent: Path, expected: set[str], label: str) -> None:
    actual = {path.name for path in parent.iterdir() if path.is_dir()}
    if actual != expected:
        raise SystemExit(f"{label} mismatch: expected {sorted(expected)}, found {sorted(actual)}")


def assert_nonempty_domains(parent: Path) -> None:
    empty = [path.name for path in parent.iterdir() if path.is_dir() and not any(child.is_file() for child in path.rglob("*"))]
    if empty:
        raise SystemExit(f"Empty domain directories are forbidden: {sorted(empty)}")


def relative(path: Path) -> str:
    return str(path.relative_to(ROOT))


if __name__ == "__main__":
    main()
