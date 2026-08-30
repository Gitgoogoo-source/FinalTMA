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
OPERATION_REGISTRY_RUNTIME_PROVIDER = (
    WEB_ROOT
    / "workflows/operation-recovery/OperationRegistryRuntimeProvider.tsx"
)
OPERATION_REGISTRY_STORE = (
    WEB_ROOT / "workflows/operation-recovery/operation-registry-store.ts"
)
BATTLE_SCHEMA = ROOT / "supabase/schemas/44_battle.sql"
BATTLE_BASELINE_MIGRATION = (
    ROOT / "supabase/migrations/20260719104533_baseline.sql"
)
MARKET_SCHEMA = ROOT / "supabase/schemas/50_market.sql"
PAYMENTS_SCHEMA = ROOT / "supabase/schemas/60_payments.sql"
MARKET_CONTRACT = ROOT / "packages/api-contracts/src/domains/market/routes.ts"
MARKET_POLICY = ROOT / "packages/api-contracts/src/domains/market/policy.ts"
TOPUP_MODELS = ROOT / "packages/api-contracts/src/domains/topup/models.ts"
MARKET_VIEW = WEB_ROOT / "domains/market/ui/MarketView.tsx"
WEB_INDEX = ROOT / "apps/web/index.html"
TELEGRAM_SDK_URL = "https://telegram.org/js/telegram-web-app.js?63"
TELEGRAM_SDK_INTEGRITY = (
    "sha384-UIU2aXwkvBIU//NSd8KQvPQc3/EvwMoKj+m2qYgtQAtF1u3Vvhf5+pjstVoLvU3i"
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
    "apps/web/src/platform/query/pageQueryActivity.tsx",
    "apps/web/src/platform/query/useCatalogQuery.ts",
    "apps/web/src/shared/navigation/pageActivity.tsx",
    "apps/web/src/pages",
    "apps/web/src/domains",
    "apps/web/src/domains/battle",
    "apps/web/src/workflows/payment-recovery",
    "apps/web/src/workflows/battle-realtime",
    "docs/architecture/adr/ADR-013-session-page-lifecycle.md",
    "docs/architecture/adr/ADR-037-persistent-page-query-activity.md",
    "docs/architecture/adr/ADR-038-local-session-proof-and-login-rpc-consolidation.md",
    "docs/architecture/adr/ADR-040-first-screen-runtime-boundary.md",
    "docs/architecture/adr/ADR-041-market-transactional-supply-read-model.md",
    "docs/architecture/adr/ADR-042-catalog-pointer-immutable-release.md",
    "docs/architecture/adr/ADR-060-market-listing-quota.md",
    "docs/architecture/adr/ADR-043-adaptive-page-module-warmup.md",
    "docs/architecture/adr/ADR-045-telegram-identity-initial-and-profile-photo-minimization.md",
    "docs/architecture/adr/ADR-046-first-screen-direct-dependency-and-native-navigation.md",
    "docs/architecture/adr/ADR-047-battle-staged-runtime-loading.md",
    "docs/architecture/adr/ADR-048-battle-dynamic-preload-entry-deduplication.md",
    "docs/architecture/adr/ADR-050-catalog-post-rebuild-readiness-gate.md",
    "docs/architecture/adr/ADR-051-operation-registry-selective-subscription.md",
    "docs/architecture/adr/ADR-053-battle-tick-alert-lifecycle.md",
    "docs/architecture/adr/ADR-054-ably-browser-csp-endpoint-allowlist.md",
    "docs/architecture/adr/ADR-059-bounded-operation-admission-and-retention.md",
    "docs/architecture/adr/ADR-075-telegram-named-mini-app-release-isolation.md",
    "docs/architecture/adr/ADR-084-telegram-session-history-back-button.md",
    "docs/architecture/adr/ADR-085-gems-display-name.md",
    "docs/architecture/adr/ADR-086-evomypet-production-cutover.md",
    "docs/architecture/adr/ADR-087-telegram-chat-list-onboarding.md",
    "docs/architecture/adr/ADR-096-battle-session-rollover-authority-gate.md",
    "docs/architecture/adr/ADR-097-market-bounded-purchase-settlement.md",
    "docs/architecture/adr/ADR-098-telegram-sdk-subresource-integrity.md",
    "apps/web/public/maintenance.html",
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
    "packages/api-contracts/src/registries/dormant-app.ts",
    "packages/api-contracts/src/app-client.ts",
    "packages/api-contracts/src/dormant-app.ts",
    "packages/api-contracts/src/registries/integrations.ts",
    "packages/api-contracts/src/registries/jobs.ts",
    "packages/api-contracts/src/registries/server.ts",
    "supabase/schemas",
    "tools/product_data",
    "contracts/ton",
    "apps/web/src/workflows/operation-recovery/operation-registry-store.ts",
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
    verify_identity_avatar_minimization()
    verify_browser_csp_boundaries()
    verify_telegram_release_isolation()
    verify_telegram_catalog_start_param_allowlist()
    verify_telegram_payment_support_command()
    verify_telegram_chat_list_onboarding()
    verify_persistent_page_route_leaves()
    verify_first_screen_runtime_boundaries()
    verify_first_screen_persistent_page_boundaries()
    verify_operation_registry_selective_subscriptions()
    verify_adaptive_page_warmup()
    verify_evolution_refresh_semantics()
    verify_operation_recovery_discovery()
    verify_security_finding_closures()
    verify_game_page_boundary()
    verify_battle_staged_runtime_loading()
    verify_battle_legacy_removal()
    verify_battle_session_rollover_authority_gate()
    verify_battle_terminal_refresh_semantics()
    verify_battle_operation_admission()
    verify_battle_accept_operation_ordering()
    verify_battle_countdown_lock_semantics()
    verify_battle_switch_atomicity()
    verify_market_transactional_supply_read_model()
    verify_api_boundaries()
    verify_session_credential_boundary()
    verify_identity_read_model_boundary()
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
            if specifier.startswith("@evomypet/api-contracts"):
                allowed = specifier == "@evomypet/api-contracts/app-client" or specifier.startswith(
                    "@evomypet/api-contracts/app-client/"
                )
                allowed = allowed or (
                    source == WEB_ROOT / "platform/i18n/catalog.ts"
                    and specifier == "@evomypet/api-contracts/localization"
                )
                if not allowed and not (
                    source.is_relative_to(WEB_ROOT / "dormant")
                    and specifier == "@evomypet/api-contracts/dormant-app"
                ):
                    violations.append(
                        f"{relative(source)} imports forbidden contract {specifier}"
                    )
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
    catalog_query_path = WEB_ROOT / "platform/query/useCatalogQuery.ts"
    catalog_query_source = catalog_query_path.read_text(encoding="utf-8")
    catalog_query_terms = (
        'useApiQuery("catalog.current"',
        'useApiQuery(\n    "catalog.release"',
        'fetchApiQuery("catalog.release"',
        "lastSuccessfulCatalogSnapshot",
    )
    missing_catalog_query_terms = [
        term for term in catalog_query_terms if term not in catalog_query_source
    ]
    if missing_catalog_query_terms:
        raise SystemExit(
            f"Catalog pointer/release query is incomplete: {missing_catalog_query_terms}"
        )
    catalog_bypasses = []
    for root in (WEB_ROOT / "domains", WEB_ROOT / "workflows", WEB_ROOT / "pages"):
        for source in typescript_files(root):
            content = source.read_text(encoding="utf-8")
            if re.search(r'["\']catalog\.(?:current|release)["\']', content):
                catalog_bypasses.append(relative(source))
    if catalog_bypasses:
        raise SystemExit(
            "Web domains must use useCatalogQuery instead of catalog routes directly: "
            f"{sorted(catalog_bypasses)}"
        )
    forbidden_files = list((WEB_ROOT / "domains").rglob("api.ts")) + list((WEB_ROOT / "domains").rglob("model.ts"))
    if forbidden_files:
        raise SystemExit(f"Unused Web domain scaffolding remains: {[relative(path) for path in forbidden_files]}")
    missing_boundaries = [path.parent.name for path in (WEB_ROOT / "domains").glob("*/ui") if not (path.parent / "index.ts").is_file()]
    if missing_boundaries:
        raise SystemExit(f"Web domains must expose one public index.ts: {missing_boundaries}")


def verify_identity_avatar_minimization() -> None:
    sources = {
        "Telegram initData": API_ROOT / "platform/telegram/initData.ts",
        "identity route": API_ROOT / "domains/identity/routes.ts",
        "top asset bar": WEB_ROOT / "app/shell/TopAssetBar.tsx",
        "Battle screens": WEB_ROOT / "domains/battle/ui/BattleScreens.tsx",
        "user contract": CONTRACT_ROOT / "common/models.ts",
        "Battle contract": CONTRACT_ROOT / "domains/battle/models.ts",
        "identity schema": ROOT / "supabase/schemas/10_identity.sql",
        "Battle schema": BATTLE_SCHEMA,
        "baseline migration": BATTLE_BASELINE_MIGRATION,
        "OpenAPI": ROOT / "packages/api-contracts/openapi/openapi.json",
    }
    forbidden = ("photo_url", "creator_avatar_url", "t.me/i/userpic")
    violations = {
        label: [term for term in forbidden if term in path.read_text(encoding="utf-8")]
        for label, path in sources.items()
        if any(term in path.read_text(encoding="utf-8") for term in forbidden)
    }
    if violations:
        raise SystemExit(f"Real user avatar data remains in runtime sources: {violations}")

    initial_helper = (WEB_ROOT / "shared/identityInitial.ts").read_text(
        encoding="utf-8"
    )
    top_asset_bar = sources["top asset bar"].read_text(encoding="utf-8")
    battle_screens = sources["Battle screens"].read_text(encoding="utf-8")
    avatar_component = (
        top_asset_bar.split("function Avatar", maxsplit=1)[1]
        if "function Avatar" in top_asset_bar
        else top_asset_bar
    )
    if (
        "export function getIdentityInitial" not in initial_helper
        or "Array.from(displayName.trim())[0]" not in initial_helper
        or "getIdentityInitial(name)" not in top_asset_bar
        or "getIdentityInitial(invite.creator_display_name)" not in battle_screens
        or "function Avatar" not in top_asset_bar
        or "<img" in avatar_component
        or "creator_avatar" in battle_screens
    ):
        raise SystemExit(
            "Top asset and Battle invite identity markers must use the shared initial helper"
        )



def verify_browser_csp_boundaries() -> None:
    vercel = json.loads((ROOT / "vercel.json").read_text(encoding="utf-8"))
    csp_values = [
        header.get("value")
        for route in vercel.get("headers", [])
        if route.get("source") == "/(.*)"
        for header in route.get("headers", [])
        if str(header.get("key", "")).lower() == "content-security-policy"
    ]
    if len(csp_values) != 1 or not isinstance(csp_values[0], str):
        raise SystemExit("Root and deep routes must share one Content-Security-Policy")

    directives: dict[str, list[str]] = {}
    for raw_directive in csp_values[0].split(";"):
        parts = raw_directive.strip().split()
        if not parts:
            continue
        name, *sources = parts
        if name in directives:
            raise SystemExit(f"Content-Security-Policy repeats directive: {name}")
        directives[name] = sources

    expected_script_sources = {"'self'", "https://telegram.org"}
    script_sources = directives.get("script-src", [])
    if (
        set(script_sources) != expected_script_sources
        or len(script_sources) != len(expected_script_sources)
    ):
        raise SystemExit(
            "CSP script-src must remain same-origin plus the Telegram SDK origin only"
        )

    index_html = WEB_INDEX.read_text(encoding="utf-8")
    script_tags = re.findall(
        r"<script\b[^>]*>.*?</script>", index_html, re.IGNORECASE | re.DOTALL
    )
    parsed_scripts: list[tuple[str, dict[str, str]]] = []
    for tag in script_tags:
        attributes = {
            name.lower(): value
            for name, value in re.findall(
                r'([a-zA-Z][a-zA-Z0-9:_-]*)\s*=\s*"([^"]*)"', tag
            )
        }
        parsed_scripts.append((tag, attributes))

    telegram_scripts = [
        (tag, attributes)
        for tag, attributes in parsed_scripts
        if attributes.get("src", "").startswith("https://telegram.org/")
    ]
    external_scripts = [
        attributes.get("src", "")
        for _, attributes in parsed_scripts
        if attributes.get("src", "").startswith(("http://", "https://"))
    ]
    if len(telegram_scripts) != 1 or external_scripts != [TELEGRAM_SDK_URL]:
        raise SystemExit(
            "The Telegram SDK must be the only external script and use the approved URL"
        )
    telegram_tag, telegram_attributes = telegram_scripts[0]
    if (
        telegram_attributes.get("src") != TELEGRAM_SDK_URL
        or telegram_attributes.get("integrity") != TELEGRAM_SDK_INTEGRITY
        or telegram_attributes.get("crossorigin") != "anonymous"
        or "onerror" in telegram_attributes
    ):
        raise SystemExit(
            "The Telegram SDK requires the approved SHA-384 SRI and anonymous CORS without fallback"
        )
    module_position = index_html.find('src="/src/main.tsx"')
    if module_position < 0 or index_html.find(telegram_tag) > module_position:
        raise SystemExit("The integrity-pinned Telegram SDK must load before the app module")

    expected_image_sources = {
        "'self'",
        "data:",
        "blob:",
        "https://*.supabase.co",
    }
    image_sources = directives.get("img-src", [])
    if (
        set(image_sources) != expected_image_sources
        or len(image_sources) != len(expected_image_sources)
    ):
        raise SystemExit(
            "CSP image sources must remain same-origin, inline, blob, and public Supabase assets only"
        )

    expected_connect_sources = {
        "'self'",
        "https://rest.ably.io",
        "https://realtime.ably.io",
        "wss://realtime.ably.io",
        "https://main.realtime.ably.net",
        "wss://main.realtime.ably.net",
        "https://*.ably-realtime.com",
        "wss://*.ably-realtime.com",
    }
    connect_sources = directives.get("connect-src", [])
    if (
        set(connect_sources) != expected_connect_sources
        or len(connect_sources) != len(expected_connect_sources)
    ):
        raise SystemExit(
            "CSP connect-src must remain same-origin plus the exact Ably browser endpoint allowlist"
        )


def verify_telegram_release_isolation() -> None:
    maintenance = (ROOT / "apps/web/public/maintenance.html").read_text(
        encoding="utf-8"
    )
    forbidden_runtime_markers = (
        "<script",
        "<link",
        "http://",
        "https://",
        "fetch(",
        "XMLHttpRequest",
        "Telegram.WebApp",
        "/api/",
    )
    present_forbidden = [
        marker for marker in forbidden_runtime_markers if marker in maintenance
    ]
    required_copy = (
        '<html lang="en">',
        'name="robots" content="noindex,nofollow"',
        "EvoMyPet is temporarily unavailable. Please check back a little later.",
        'lang="zh-CN"',
        "EvoMyPet 暂时无法进入，请稍后再来。",
        "No action is required · 无需进行任何操作",
        "env(safe-area-inset-top)",
        "env(safe-area-inset-bottom)",
    )
    missing_copy = [marker for marker in required_copy if marker not in maintenance]
    if present_forbidden or missing_copy:
        raise SystemExit(
            "Telegram release isolation page boundary is incomplete: "
            f"forbidden={present_forbidden}, missing={missing_copy}"
        )

    vercel = json.loads((ROOT / "vercel.json").read_text(encoding="utf-8"))
    maintenance_routes = [
        route
        for route in vercel.get("headers", [])
        if route.get("source") == "/maintenance.html"
    ]
    if len(maintenance_routes) != 1:
        raise SystemExit(
            "Telegram release isolation page must have one exact Vercel header rule"
        )
    headers = {
        str(header.get("key", "")).lower(): header.get("value")
        for header in maintenance_routes[0].get("headers", [])
    }
    expected_headers = {
        "cache-control": "private, no-store, max-age=0",
        "x-robots-tag": "noindex, nofollow",
    }
    if headers != expected_headers:
        raise SystemExit(
            "Telegram release isolation headers mismatch: "
            f"expected {expected_headers}, found {headers}"
        )


def verify_telegram_payment_support_command() -> None:
    contract = (
        ROOT / "packages/api-contracts/src/domains/integrations/routes.ts"
    ).read_text(encoding="utf-8")
    bot_client = (API_ROOT / "platform/telegram/bot.ts").read_text(
        encoding="utf-8"
    )
    support = (
        API_ROOT / "workflows/stars-payment/payment-support.ts"
    ).read_text(encoding="utf-8")
    webhook = (
        API_ROOT / "workflows/telegram-webhook/routes.ts"
    ).read_text(encoding="utf-8")
    adr = (
        ROOT
        / "docs/architecture/adr/ADR-077-telegram-payment-support-command.md"
    ).read_text(encoding="utf-8")
    release = (ROOT / "docs/operations/release.md").read_text(encoding="utf-8")
    required = {
        "contract": (
            "telegramChatSchema",
            "chat: telegramChatSchema",
            '"TELEGRAM_API_FAILED"',
        ),
        "bot client": ('"sendMessage"', "sendTelegramMessage"),
        "support workflow": (
            'PAYMENT_SUPPORT_COMMAND = "/paysupport"',
            "PAYMENT_SUPPORT_URL",
            "TELEGRAM_BOT_USERNAME",
        ),
        "webhook": (
            'chat?.type === "private"',
            "isPaymentSupportCommand(message.text)",
            "await sendTelegramMessage({",
        ),
        "ADR": (
            "`/paysupport`",
            "`sendMessage`",
            "`TELEGRAM_API_FAILED`",
            "不读写订单",
        ),
        "release": (
            '`allowed_updates=["message","pre_checkout_query"]`',
            "`TELEGRAM_WEBHOOK_SECRET`",
            "`getWebhookInfo`",
        ),
    }
    sources = {
        "contract": contract,
        "bot client": bot_client,
        "support workflow": support,
        "webhook": webhook,
        "ADR": adr,
        "release": release,
    }
    missing = {
        label: [term for term in terms if term not in sources[label]]
        for label, terms in required.items()
        if any(term not in sources[label] for term in terms)
    }
    if missing:
        raise SystemExit(
            f"Telegram payment support command boundary is incomplete: {missing}"
        )


def verify_telegram_chat_list_onboarding() -> None:
    sources = {
        "contract": (
            CONTRACT_ROOT / "domains/integrations/routes.ts"
        ).read_text(encoding="utf-8"),
        "telegram types": (WEB_ROOT / "types.d.ts").read_text(encoding="utf-8"),
        "web workflow": (
            WEB_ROOT
            / "workflows/telegram-chat-onboarding/TelegramChatOnboarding.tsx"
        ).read_text(encoding="utf-8"),
        "app": (WEB_ROOT / "app/App.tsx").read_text(encoding="utf-8"),
        "page readiness": "\n".join(
            (
                (WEB_ROOT / path).read_text(encoding="utf-8")
                for path in (
                    "domains/gacha/ui/GachaView.tsx",
                    "domains/market/ui/MarketView.tsx",
                    "domains/battle/ui/BattleView.tsx",
                    "domains/inventory/ui/InventoryView.tsx",
                    "domains/tasks/ui/TasksView.tsx",
                )
            )
        ),
        "api process": (
            API_ROOT / "workflows/telegram-chat-onboarding/process.ts"
        ).read_text(encoding="utf-8"),
        "webhook": (
            API_ROOT / "workflows/telegram-webhook/routes.ts"
        ).read_text(encoding="utf-8"),
        "schema": (ROOT / "supabase/schemas/30_operations.sql").read_text(
            encoding="utf-8"
        ),
        "security": one_security_migration(),
        "ADR": (
            ROOT
            / "docs/architecture/adr/ADR-087-telegram-chat-list-onboarding.md"
        ).read_text(encoding="utf-8"),
        "acceptance": (ROOT / "docs/operations/acceptance.md").read_text(
            encoding="utf-8"
        ),
    }
    required = {
        "contract": (
            "writeAccessAllowedSchema",
            "write_access_allowed: writeAccessAllowedSchema.optional()",
            "from_request: z.boolean().optional()",
        ),
        "telegram types": (
            "allows_write_to_pm?: boolean",
            "isVersionAtLeast?(version: string)",
            "requestWriteAccess?",
        ),
        "web workflow": (
            "subscribeFirstPlayablePageReady",
            "subscribeFirstScreenReady",
            'session.entryHandoffState !== "complete"',
            "requestTelegramWriteAccessOnce()",
            'app.isVersionAtLeast("6.9")',
            "writeAccessRequestAttempted = true",
        ),
        "app": (
            "const TelegramChatOnboarding = lazy",
            "workflows/telegram-chat-onboarding/TelegramChatOnboarding.tsx",
            "<AppRouter />",
            "<TelegramChatOnboarding />",
        ),
        "page readiness": (
            "markFirstScreenReady(session.generation)",
            'markFirstPlayablePageReady(session.generation, "/market")',
            'markFirstPlayablePageReady(sessionGeneration, "/game")',
            'markFirstPlayablePageReady(session.generation, "/inventory")',
            'markFirstPlayablePageReady(session.generation, "/tasks")',
        ),
        "api process": (
            "permission.from_request !== true",
            'chat?.type !== "private"',
            "from.id !== chat.id",
            '"telegram_chat_onboarding_claim"',
            '"telegram_chat_onboarding_finish"',
            "EVOMYPET_MINI_APP_URL",
            "cause.definitive ? \"failed\" : \"unknown\"",
        ),
        "webhook": ("processTelegramChatOnboarding(update)",),
        "schema": (
            "create table operations.telegram_chat_onboarding",
            "first_update_id bigint not null unique",
            "create or replace function api.telegram_chat_onboarding_claim",
            "create or replace function api.telegram_chat_onboarding_finish",
            "and completed_at is null",
        ),
        "security": (
            "'telegram_chat_onboarding_claim'",
            "'telegram_chat_onboarding_finish'",
        ),
        "ADR": (
            "`requestWriteAccess()`",
            "下次完整关闭并重新进入 Mini App 时自动再次请求",
            "至多尝试一次欢迎消息",
            "不新增环境变量",
        ),
        "acceptance": (
            "Telegram 聊天列表授权",
            "拒绝后当前 WebView 不重复",
            "sent/failed/unknown",
        ),
    }
    missing = {
        label: [term for term in terms if term not in sources[label]]
        for label, terms in required.items()
        if any(term not in sources[label] for term in terms)
    }
    if missing:
        raise SystemExit(
            f"Telegram chat-list onboarding boundary is incomplete: {missing}"
        )
    legacy = API_ROOT / "workflows/stars-payment/telegram-webhook.ts"
    if legacy.exists():
        raise SystemExit("Telegram webhook orchestration cannot remain payment-owned")


def one_security_migration() -> str:
    matches = sorted((ROOT / "supabase/migrations").glob("*_api_security.sql"))
    if len(matches) != 1:
        raise SystemExit("Expected one api security migration")
    return matches[0].read_text(encoding="utf-8")


def verify_persistent_page_route_leaves() -> None:
    router = (WEB_ROOT / "app/router/AppRouter.tsx").read_text(encoding="utf-8")
    required_routes = (
        "const location = useAppLocation();",
        "if (getMainPagePath(location.pathname)) return <AppShell />;",
        'if (location.pathname === "/album")',
        "<AppShell standalonePage={withPageLoading(<AlbumPage />)} />",
        "return <InvalidRouteRedirect />;",
        'replaceAppLocation("/")',
    )
    missing = [term for term in required_routes if term not in router]
    app_shell = (WEB_ROOT / "app/shell/AppShell.tsx").read_text(encoding="utf-8")
    if missing or "{!activePath ? standalonePage : null}" not in app_shell:
        raise SystemExit(
            "Persistent page routes must remain owned by the native navigation shell: "
            f"{missing}"
        )

    navigation = (WEB_ROOT / "platform/navigation/index.tsx").read_text(
        encoding="utf-8"
    )
    navigation_terms = (
        "useSyncExternalStore",
        'const NAVIGATION_HISTORY_KEY = "__evomypet_navigation_v1__"',
        "const navigationSessionId = window.crypto.randomUUID()",
        "initializeNavigationHistory();",
        'window.addEventListener("popstate", publishNavigation)',
        'window.removeEventListener("popstate", publishNavigation)',
        "window.history.pushState",
        "window.history.replaceState",
        "window.history.go(target)",
        "options.replace ? currentEntry.index : currentEntry.index + 1",
        "options.state === undefined",
        "url === currentAppUrl()",
        "canGoBack: entry.index > 0",
        "APP_NAVIGATION_CROSS_ORIGIN_FORBIDDEN",
        "export function replaceAppLocation",
    )
    missing_navigation = [
        term for term in navigation_terms if term not in navigation
    ]
    if missing_navigation:
        raise SystemExit(
            "Native app navigation lifecycle is incomplete: "
            f"{missing_navigation}"
        )

    telegram_platform = (WEB_ROOT / "platform/telegram/index.ts").read_text(
        encoding="utf-8"
    )
    telegram_back = (
        WEB_ROOT / "app/router/TelegramBackNavigation.tsx"
    ).read_text(encoding="utf-8")
    authenticated_providers = (
        WEB_ROOT / "app/providers/AuthenticatedRuntimeProviders.tsx"
    ).read_text(encoding="utf-8")
    required_telegram_platform = (
        "export function setTelegramBackButtonVisible",
        "export function subscribeTelegramBackButton",
        "button.show()",
        "button.hide()",
        "button.onClick(callback)",
        "button.offClick(callback)",
    )
    required_telegram_back = (
        "useEffectEvent",
        "useAppLocation",
        "useOperationNavigationLocked",
        "if (!canGoBack || navigationLocked) return;",
        "navigate(-1)",
        "subscribeTelegramBackButton(handleBack)",
        "setTelegramBackButtonVisible(canGoBack)",
        "setTelegramBackButtonVisible(false)",
    )
    missing_telegram_back = {
        "platform": [
            term for term in required_telegram_platform if term not in telegram_platform
        ],
        "controller": [
            term for term in required_telegram_back if term not in telegram_back
        ],
        "provider": [
            term
            for term in ("<TelegramBackNavigation />", "<OperationRegistryProvider>")
            if term not in authenticated_providers
        ],
    }
    missing_telegram_back = {
        label: terms for label, terms in missing_telegram_back.items() if terms
    }
    if missing_telegram_back:
        raise SystemExit(
            "Telegram session-history BackButton lifecycle is incomplete: "
            f"{missing_telegram_back}"
        )

    forbidden_back_button_owners: list[str] = []
    allowed_back_button_sources = {
        WEB_ROOT / "types.d.ts",
        WEB_ROOT / "platform/telegram/index.ts",
        WEB_ROOT / "app/router/TelegramBackNavigation.tsx",
    }
    for source in typescript_files(WEB_ROOT):
        text = source.read_text(encoding="utf-8")
        if source not in allowed_back_button_sources and (
            ".BackButton" in text
            or "useTelegramBackButton" in text
            or "setTelegramBackButtonVisible" in text
            or "subscribeTelegramBackButton" in text
        ):
            forbidden_back_button_owners.append(relative(source))
    if forbidden_back_button_owners:
        raise SystemExit(
            "Telegram BackButton must have one global owner: "
            f"{sorted(forbidden_back_button_owners)}"
        )

    forbidden_router_imports: list[str] = []
    for source in typescript_files(WEB_ROOT):
        for specifier in imports(source):
            if specifier in ("react-router", "react-router-dom"):
                forbidden_router_imports.append(relative(source))
    if forbidden_router_imports:
        raise SystemExit(
            "Active Web source must not import the retired general router: "
            f"{sorted(forbidden_router_imports)}"
        )


def verify_first_screen_runtime_boundaries() -> None:
    global_css = WEB_ROOT / "shared/styles/global.css"
    if global_css.exists():
        raise SystemExit("global.css must remain deleted")

    foundation_css = (WEB_ROOT / "shared/styles/foundation.css").read_text(
        encoding="utf-8"
    )
    gacha_css = (WEB_ROOT / "shared/styles/gacha-page.css").read_text(
        encoding="utf-8"
    )
    global_vip_terms = (
        ".app-shell .vip-daily-benefits {",
        ".app-shell .vip-benefit-grid {",
        ".app-shell .vip-benefit-grid .vip-benefit-tile {",
        "@keyframes vip-benefit-ready",
    )
    missing_global_vip_terms = [
        term for term in global_vip_terms if term not in foundation_css
    ]
    if missing_global_vip_terms or any(term in gacha_css for term in global_vip_terms):
        raise SystemExit(
            "Global VIP benefit styles must be owned by foundation.css: "
            f"missing={missing_global_vip_terms}"
        )

    ui_barrel = WEB_ROOT / "shared/ui/index.tsx"
    if ui_barrel.exists():
        raise SystemExit("Shared UI barrel must remain deleted")
    ui_barrel_importers = [
        relative(source)
        for source in typescript_files(WEB_ROOT)
        if any(specifier.endswith("shared/ui/index.tsx") for specifier in imports(source))
    ]
    if ui_barrel_importers:
        raise SystemExit(
            "Shared UI components must use direct leaf imports: "
            f"{sorted(ui_barrel_importers)}"
        )

    active_dormant_imports: list[str] = []
    for source in typescript_files(WEB_ROOT):
        if source.is_relative_to(WEB_ROOT / "dormant"):
            continue
        for specifier in imports(source):
            if specifier == "@evomypet/api-contracts/dormant-app":
                active_dormant_imports.append(relative(source))
    if active_dormant_imports:
        raise SystemExit(
            "Active Web source imports the dormant contract boundary: "
            f"{sorted(active_dormant_imports)}"
        )

    provider_imports = imports(OPERATION_REGISTRY_PROVIDER)
    forbidden_presenters = [
        specifier
        for specifier in provider_imports
        if "presentations/" in specifier
        or specifier.endswith("ResultDialog.tsx")
        or specifier.endswith("GachaHatchAnimation.tsx")
    ]
    if forbidden_presenters:
        raise SystemExit(
            "OperationRegistryProvider statically imports presentation code: "
            f"{forbidden_presenters}"
        )
    main_source = (WEB_ROOT / "main.tsx").read_text(encoding="utf-8")
    pre_render_source = main_source.split("createRoot(root).render", maxsplit=1)[0]
    startup_preloads = re.findall(r"\b(preload[A-Za-z0-9_]+)\(", pre_render_source)
    if startup_preloads != ["preloadFirstScreenContracts"]:
        raise SystemExit(
            "Web startup has unregistered pre-render preload calls: "
            f"{startup_preloads}"
        )
    if (
        "preloadOperationRegistryProvider" in main_source
        or "provider-loader.ts" in main_source
    ):
        raise SystemExit(
            "The heavy operation runtime cannot be preloaded during Web startup"
        )
    facade_source = OPERATION_REGISTRY_PROVIDER.read_text(encoding="utf-8")
    if (
        'loadOperationRegistryRuntime()' not in facade_source
        or 'import("./OperationRegistryRuntimeProvider.tsx")'
        not in (
            WEB_ROOT / "workflows/operation-recovery/runtime-loader.ts"
        ).read_text(encoding="utf-8")
    ):
        raise SystemExit(
            "The operation registry must load its heavy runtime through the intent boundary"
        )
    blocking_recovery_source = (
        WEB_ROOT / "workflows/operation-recovery/useBlockingOperationRecovery.ts"
    ).read_text(encoding="utf-8")
    discovery_source = (
        WEB_ROOT / "workflows/operation-recovery/useRecoverableOperationDiscovery.ts"
    ).read_text(encoding="utf-8")
    if any(
        "const hydrateRecovered = useEffectEvent(hydrate);" not in source
        or "hydrateRecovered(" not in source
        for source in (blocking_recovery_source, discovery_source)
    ) or any(
        dependency in source
        for source, dependency in (
            (blocking_recovery_source, "[hydrate, operations]"),
            (
                discovery_source,
                "[enabled, generation, hydrate, initialAuthorityCursor]",
            ),
        )
    ):
        raise SystemExit(
            "Operation recovery effects must isolate hydrate with useEffectEvent"
        )
    presentation_loader = (
        WEB_ROOT / "workflows/operation-recovery/presentation-loader.ts"
    ).read_text(encoding="utf-8")
    for domain in (
        "GachaPresentation",
        "EvolutionPresentation",
        "DecompositionPresentation",
        "MarketPresentation",
        "WheelPresentation",
        "AlbumPresentation",
    ):
        if f'import("./presentations/{domain}.ts")' not in presentation_loader:
            raise SystemExit(f"Operation presentation loader is missing {domain}")

    vite_gate = (WEB_ROOT.parent / "vite/firstScreenBudget.ts").read_text(
        encoding="utf-8"
    )
    gate_terms = (
        "jsRaw: 400_000",
        "jsGzip: 125_000",
        "cssRaw: 110_000",
        "cssGzip: 23_000",
        "collectStaticClosure",
        "OperationRegistryRuntimeProvider.tsx",
        "/node_modules/react-router/",
        "/apps/web/src/shared/ui/AppModal.tsx",
        "/apps/web/src/shared/ui/CollectionDetailShowcase.tsx",
        "Largest first-screen modules",
        "evolution-catalog-v1.json",
        "global.css must not exist",
    )
    missing_gate_terms = [term for term in gate_terms if term not in vite_gate]
    if missing_gate_terms:
        raise SystemExit(
            f"First-screen production build gate is incomplete: {missing_gate_terms}"
        )


def verify_operation_registry_selective_subscriptions() -> None:
    context_path = WEB_ROOT / "workflows/operation-recovery/context.ts"
    context_source = context_path.read_text(encoding="utf-8")
    facade_source = OPERATION_REGISTRY_PROVIDER.read_text(encoding="utf-8")
    runtime_source = OPERATION_REGISTRY_RUNTIME_PROVIDER.read_text(encoding="utf-8")
    store_source = OPERATION_REGISTRY_STORE.read_text(encoding="utf-8")

    context_terms = (
        "createContext<OperationRegistryStore | null>",
        "useSyncExternalStore",
        "export function useOperationCommands()",
        "export function useOperationHydrator()",
        "export function useOperationBlocked(",
        "export function useOperationNavigationLocked()",
        "export function useOperationRecoveryQueueActive()",
        "export function useWheelPresentationEpoch()",
    )
    missing_context_terms = [
        term for term in context_terms if term not in context_source
    ]
    if missing_context_terms:
        raise SystemExit(
            "Operation registry selective hooks are incomplete: "
            f"{missing_context_terms}"
        )
    if "useOperationRegistry" in context_source:
        raise SystemExit("Aggregate useOperationRegistry hook must remain deleted")

    forbidden_facade_terms = (
        "runtimeValue",
        "setRuntimeValue",
        "RuntimeValueBridge",
        "useOperationRegistry",
    )
    present_facade_terms = [
        term for term in forbidden_facade_terms if term in facade_source
    ]
    if present_facade_terms:
        raise SystemExit(
            "Operation facade must not bridge a complete Runtime value: "
            f"{present_facade_terms}"
        )
    required_facade_terms = (
        "createOperationRegistryStore,",
        "store.bindFacade(commands, hydrate)",
        "<OperationRegistryContext.Provider value={store}>",
        "<RuntimeProvider host={runtimeHost} />",
        "store.expectHydrationCommit(controller, hydrationEpoch);",
        "store.clearPendingRunRoute(command.routeId)",
    )
    missing_facade_terms = [
        term for term in required_facade_terms if term not in facade_source
    ]
    if missing_facade_terms:
        raise SystemExit(
            "Operation facade stable Store handoff is incomplete: "
            f"{missing_facade_terms}"
        )

    if "OperationRegistryContext" in runtime_source:
        raise SystemExit("Heavy operation Runtime must not publish a nested Context")
    required_runtime_terms = (
        "host: OperationRegistryRuntimeHost;",
        "const operationSignals = useMemo(",
        "const controller = useMemo<OperationRuntimeController>(",
        "host.attachRuntime(controller)",
        "host.publishRuntimeSignals(controller, runtimeSignals)",
        "hydrationEpochRef.current + 1",
    )
    missing_runtime_terms = [
        term for term in required_runtime_terms if term not in runtime_source
    ]
    if missing_runtime_terms:
        raise SystemExit(
            "Operation Runtime selective signal publication is incomplete: "
            f"{missing_runtime_terms}"
        )

    store_terms = (
        "blockedListeners",
        "navigationListeners",
        "recoveryListeners",
        "wheelEpochListeners",
        "previousBlocked.get(routeId) !== getBlocked(routeId)",
        "signals.hydrationEpoch >= expectedHydrationEpoch",
        "runtimeController !== controller",
    )
    missing_store_terms = [term for term in store_terms if term not in store_source]
    if missing_store_terms:
        raise SystemExit(
            "Operation registry signal Store is incomplete: "
            f"{missing_store_terms}"
        )

    aggregate_consumers = [
        relative(source)
        for source in typescript_files(WEB_ROOT)
        if source != context_path
        and re.search(r"\buseOperationRegistry\s*\(", source.read_text(encoding="utf-8"))
    ]
    if aggregate_consumers:
        raise SystemExit(
            "Operation consumers must use selective hooks: "
            f"{sorted(aggregate_consumers)}"
        )
    context_providers = [
        relative(source)
        for source in typescript_files(WEB_ROOT)
        if "<OperationRegistryContext.Provider"
        in source.read_text(encoding="utf-8")
    ]
    if context_providers != [relative(OPERATION_REGISTRY_PROVIDER)]:
        raise SystemExit(
            "The stable operation Store must have exactly one Context provider: "
            f"{context_providers}"
        )

    consumer_terms = {
        "app/shell/BottomNavigation.tsx": "useOperationNavigationLocked()",
        "pages/inventory/InventoryPage.tsx": "useOperationBlocked(\"inventory.evolve\")",
        "domains/gacha/ui/GachaView.tsx": "useOperationBlocked(\"gacha.open\")",
        "domains/market/ui/MarketView.tsx": "useOperationBlocked(\"market.purchase\")",
        "domains/tasks/ui/TasksView.tsx": "useOperationBlocked(\"tasks.claim\")",
        "domains/wheel/ui/WheelPanel.tsx": "useWheelPresentationEpoch()",
        "workflows/operation-recovery/useRecoverableOperationDiscovery.ts": "useOperationRecoveryQueueActive()",
    }
    missing_consumers = [
        path
        for path, term in consumer_terms.items()
        if term not in (WEB_ROOT / path).read_text(encoding="utf-8")
    ]
    if missing_consumers:
        raise SystemExit(
            "Operation selective subscriptions are missing consumers: "
            f"{missing_consumers}"
        )

    documentation = "\n".join(
        (ROOT / path).read_text(encoding="utf-8")
        for path in (
            "docs/architecture/adr/ADR-051-operation-registry-selective-subscription.md",
            "docs/architecture/operation-recovery.md",
            "docs/architecture/runtime.md",
            "docs/operations/acceptance.md",
            "docs/operations/release.md",
        )
    )
    for term in (
        "稳定命令",
        "选择性信号",
        "useOperationBlocked",
        "水合",
    ):
        if term not in documentation:
            raise SystemExit(
                "Operation selective subscription documentation is incomplete: "
                f"{term}"
            )


def verify_first_screen_persistent_page_boundaries() -> None:
    app_handlers = (
        API_ROOT / "entrypoints/app/handlers.ts"
    ).read_text(encoding="utf-8")
    if any(
        term in app_handlers
        for term in ("walletHandlers", "mintHandlers", "domains/wallet", "domains/mint")
    ):
        raise SystemExit("Wallet and Mint handlers cannot enter the active App gateway")
    persistent_pages = (WEB_ROOT / "app/router/PersistentPages.tsx").read_text(
        encoding="utf-8"
    )
    page_activity = (WEB_ROOT / "shared/navigation/pageActivity.tsx").read_text(
        encoding="utf-8"
    )
    page_query_activity = (
        WEB_ROOT / "platform/query/pageQueryActivity.tsx"
    ).read_text(encoding="utf-8")
    query_source = (WEB_ROOT / "platform/query/index.ts").read_text(
        encoding="utf-8"
    )
    lifecycle_terms = (
        "setVisitState({",
        "visitState.visited",
        "scrollPositions.current",
        "hidden={!active}",
        "inert={!active}",
        "PageActivityProvider",
        "PageQueryActivityProvider",
        "active={active}",
        "search: active ? search : snapshot.search",
        'history.scrollRestoration = "manual"',
    )
    lifecycle_source = persistent_pages + page_activity + page_query_activity
    missing_lifecycle_terms = [
        value for value in lifecycle_terms if value not in lifecycle_source
    ]
    if missing_lifecycle_terms:
        raise SystemExit(
            f"Session page lifecycle is incomplete: {missing_lifecycle_terms}"
        )
    query_activity_terms = (
        "const PageQueryActivityContext = createContext(true);",
        "<PageQueryActivityContext.Provider value={active}>",
        "export function usePageQueryActive(): boolean",
        "const pageQueryActive = usePageQueryActive();",
        "enabled: requestedEnabled && pageQueryActive && !suppressed",
        "const queryRefetch = query.refetch;",
        "cancelRefetch: false",
    )
    query_activity_source = page_query_activity + query_source
    missing_query_activity_terms = [
        value for value in query_activity_terms if value not in query_activity_source
    ]
    if missing_query_activity_terms:
        raise SystemExit(
            "Persistent-page query activity is incomplete: "
            f"{missing_query_activity_terms}"
        )
    active_only_blocks = {
        "invalidateApiQueries": query_source.partition(
            "export function invalidateApiQueries"
        )[2].partition("export function useApiQuery")[0],
        "refreshUserState": query_source.partition(
            "export async function refreshUserState"
        )[2].partition("const topAssetRouteIds")[0],
        "refreshScopes": query_source.partition(
            "export async function refreshScopes"
        )[2].partition("function foregroundPrefixes")[0],
    }
    missing_active_only = [
        name
        for name, source in active_only_blocks.items()
        if 'refetchType: "active"' not in source
    ]
    if missing_active_only:
        raise SystemExit(
            "Query invalidation must refetch active observers only: "
            f"{missing_active_only}"
        )
    market_view = (WEB_ROOT / "domains/market/ui/MarketView.tsx").read_text(
        encoding="utf-8"
    )
    sold_inbox = (WEB_ROOT / "domains/market/soldInbox.ts").read_text(
        encoding="utf-8"
    )
    battle_view = (WEB_ROOT / "domains/battle/ui/BattleView.tsx").read_text(
        encoding="utf-8"
    )
    domain_lifecycle_terms = (
        (market_view, "useMarketSoldInbox(pageActive, pageActive)"),
        (
            sold_inbox,
            "const enabled = Boolean(userId) && queryEnabled && surfaceActive;",
        ),
        (
            sold_inbox,
            "const poll = Boolean(userId) && pollingEnabled && surfaceActive;",
        ),
        (battle_view, "pageActive && activeTerminal === null"),
        (battle_view, "if (!pageActive || !sessionGeneration) return;"),
    )
    missing_domain_lifecycle = [
        term for source, term in domain_lifecycle_terms if term not in source
    ]
    if missing_domain_lifecycle:
        raise SystemExit(
            "Battle or market page lifecycle gate is incomplete: "
            f"{missing_domain_lifecycle}"
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


def verify_adaptive_page_warmup() -> None:
    scheduler = (WEB_ROOT / "app/router/deferredPageWarmup.ts").read_text(
        encoding="utf-8"
    )
    page_routes = (WEB_ROOT / "app/router/pageRoutes.ts").read_text(
        encoding="utf-8"
    )
    app_router = (WEB_ROOT / "app/router/AppRouter.tsx").read_text(
        encoding="utf-8"
    )
    gacha_view = (WEB_ROOT / "domains/gacha/ui/GachaView.tsx").read_text(
        encoding="utf-8"
    )
    bottom_navigation = (WEB_ROOT / "app/shell/BottomNavigation.tsx").read_text(
        encoding="utf-8"
    )
    runtime_providers = (
        WEB_ROOT / "app/providers/AuthenticatedRuntimeProviders.tsx"
    ).read_text(encoding="utf-8")

    automatic_order = re.search(
        r"AUTOMATIC_PAGE_ORDER:[^=]+\=\s*\[(.*?)\];", scheduler, re.DOTALL
    )
    if not automatic_order:
        raise SystemExit("Adaptive page warmup order is missing")
    automatic_paths = re.findall(r'"(/[^"]*)"', automatic_order.group(1))
    if automatic_paths != ["/inventory", "/tasks", "/market", "/album"]:
        raise SystemExit(
            "Adaptive page warmup order must be inventory, tasks, market, album: "
            f"{automatic_paths}"
        )
    if '"/game"' in automatic_order.group(1):
        raise SystemExit("Battle cannot enter automatic page warmup")

    required_scheduler_terms = (
        "document.visibilityState === \"visible\"",
        "navigator.onLine !== false",
        "connection?.saveData === false",
        'connection.effectiveType === "4g"',
        'window.addEventListener("online"',
        'window.addEventListener("offline"',
        'document.addEventListener("visibilitychange"',
        'connection?.addEventListener("change"',
        "subscribeTelegramActivity(activate, deactivate)",
        "cancelScheduled()",
        "automaticWarmupStopped = true",
        "preparePageModule(path)",
    )
    missing_scheduler_terms = [
        term for term in required_scheduler_terms if term not in scheduler
    ]
    if missing_scheduler_terms:
        raise SystemExit(
            "Adaptive page warmup conditions are incomplete: "
            f"{missing_scheduler_terms}"
        )
    forbidden_scheduler_terms = (
        "Promise.all(",
        "Promise.allSettled(",
        "prefetchApiQuery",
        "fetchApiQuery",
        "useApiQuery",
        "apiRequest(",
    )
    present_forbidden_scheduler_terms = [
        term for term in forbidden_scheduler_terms if term in scheduler
    ]
    if present_forbidden_scheduler_terms:
        raise SystemExit(
            "Adaptive page warmup cannot batch modules or prefetch business data: "
            f"{present_forbidden_scheduler_terms}"
        )

    required_loader_terms = (
        'export type PreloadablePagePath = MainPagePath | "/album"',
        "const pageModulePromises = new Map",
        "export function loadPageModule",
        "pageModulePromises.delete(path)",
        "export function preparePageModule",
        'loadPageModule("/album")',
    )
    missing_loader_terms = [
        term for term in required_loader_terms if term not in page_routes
    ]
    if missing_loader_terms:
        raise SystemExit(
            f"Unified page module loader is incomplete: {missing_loader_terms}"
        )

    readiness_source = app_router + gacha_view
    required_readiness_terms = (
        "subscribeFirstScreenReady",
        "isFirstScreenReady(generation)",
        'pathname !== "/"',
        "startAdaptivePageWarmup()",
        "markFirstScreenReady(session.generation)",
        "rulesComplete",
        "ready[selectedBox.tier]",
    )
    missing_readiness_terms = [
        term for term in required_readiness_terms if term not in readiness_source
    ]
    if missing_readiness_terms:
        raise SystemExit(
            f"First-screen warmup handshake is incomplete: {missing_readiness_terms}"
        )

    required_intent_terms = (
        "usePageModulePreparation",
        "onPointerEnter={prepare}",
        "onPointerDown={prepare}",
        "onFocus={prepare}",
        "if (!active && !navigationLocked)",
    )
    missing_intent_terms = [
        term for term in required_intent_terms if term not in bottom_navigation
    ]
    if missing_intent_terms:
        raise SystemExit(
            f"Bottom navigation module intent is incomplete: {missing_intent_terms}"
        )
    if (
        "PageModulePreparationProvider prepare={preparePageModule}"
        not in runtime_providers
    ):
        raise SystemExit("Player navigation intent must use the unified page loader")

    warmup_adr = (
        ROOT / "docs/architecture/adr/ADR-043-adaptive-page-module-warmup.md"
    ).read_text(encoding="utf-8")
    runtime_document = (ROOT / "docs/architecture/runtime.md").read_text(
        encoding="utf-8"
    )
    for required_document_term in (
        "未知网络",
        "Battle 页面模块永不进入",
        "不调用 `prefetchApiQuery`",
        "ADR-043",
    ):
        if required_document_term not in warmup_adr + runtime_document:
            raise SystemExit(
                "Adaptive page warmup documentation is incomplete: "
                f"{required_document_term}"
            )


def verify_evolution_refresh_semantics() -> None:
    source = OPERATION_REGISTRY_RUNTIME_PROVIDER.read_text(encoding="utf-8")
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

    run_start = source.index('const run: OperationRegistryCommands["run"]')
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
    provider = OPERATION_REGISTRY_RUNTIME_PROVIDER.read_text(encoding="utf-8")
    if (
        "useRecoverableOperationDiscovery(recovery?.authority_cursor);"
        not in coordinator
        or "recoveryQueueActive: boolean;" not in context
        or "wheelPresentationEpoch: number;" not in context
        or "serverAcknowledgementRouteIds.has(operation.routeId)" not in provider
        or 'operation.routeId === "wheel.spin"' not in provider
        or "let recoveryQueueActive = false;" not in provider
        or "recoveryQueueActive = true;" not in provider
        or "useOperationRecoveryQueueActive()" not in discovery
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
        'rpc<unknown>("operations_recoverable"',
        "p_after_authority_cursor bigint",
        "'authority_refresh_routes'",
        "'next_authority_cursor'",
        "operations.user_authority_sequences",
        "candidate.use_case in ('wheel.spin', 'inventory.evolve')",
        "candidate.use_case = 'inventory.evolve'",
        "candidate.result_acknowledged_at is null",
        "limit 1",
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
        "candidate.use_case = 'inventory.evolve'" not in identity_schema
        or "candidate.use_case in ('wheel.spin', 'inventory.evolve')" in identity_schema
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
    cleanup_terms = (
        "o.completed_at < now() - interval '30 days'",
        "for update of o skip locked",
        "delete from wheel.results",
        "set request = null",
        "result = null",
        "payload_purged_at = now()",
        "operations.operation_has_durable_reference(o.id)",
        "o.status = 'failed' and o.completed_at < now() - interval '7 days'",
        "o.status = 'succeeded' and o.completed_at < now() - interval '37 days'",
        "delete from operations.operations",
    )
    missing_cleanup_terms = [term for term in cleanup_terms if term not in jobs_schema]
    if missing_cleanup_terms:
        raise SystemExit(
            "Operation payload compaction and bounded retention are incomplete: "
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


def verify_security_finding_closures() -> None:
    identity = (ROOT / "supabase/schemas/10_identity.sql").read_text(
        encoding="utf-8"
    ).lower()
    referral = (ROOT / "supabase/schemas/63_referral.sql").read_text(
        encoding="utf-8"
    ).lower()
    operations = (ROOT / "supabase/schemas/30_operations.sql").read_text(
        encoding="utf-8"
    ).lower()
    jobs = (ROOT / "supabase/schemas/95_jobs.sql").read_text(
        encoding="utf-8"
    ).lower()
    middleware = (API_ROOT / "http/middleware.ts").read_text(encoding="utf-8")
    client = (WEB_ROOT / "platform/api/client.ts").read_text(encoding="utf-8")
    bootstrap = (
        WEB_ROOT / "workflows/session-bootstrap/useBootstrap.ts"
    ).read_text(encoding="utf-8")

    referral_required = (
        "case when s.referral_processed_at is null then 'pending' else 'complete' end",
        "when s.referral_processed_at is null then coalesce(c.code, s.referral_code)",
        "if v_session.referral_processed_at is null",
        "and (id = p_session_id or revoked_at is null)",
    )
    missing = [term for term in referral_required if term not in identity + referral]
    if missing or "v_session.entry_kind = 'referral'" in identity:
        raise SystemExit(
            "Pending referral handoff must remain sticky across reauthentication: "
            f"missing={missing}"
        )
    if (
        'context.entryHandoffState === "pending"' not in bootstrap
        or "context.entryKind" in bootstrap[bootstrap.index('context.entryHandoffState === "pending"') :]
    ):
        raise SystemExit("Referral settlement routing must use handoff state, not entry kind")

    operation_required = (
        "create table operations.user_admission_counters",
        "create or replace function operations.assert_new_operation_id",
        "create or replace function operations.admit_new_command",
        "v_timestamp_ms < v_now_ms - 86400000",
        "v_timestamp_ms > v_now_ms + 300000",
        "v_counter.minute_count >= 60",
        "v_counter.day_count >= 1000",
        "v_failed_count >= 100",
        "v_open_count >= 20",
        "create index operations_open_user_idx",
        "create index operations_failed_user_idx",
        "pg_advisory_xact_lock(hashtextextended('operations.command:'",
        "create unique index operations_one_blocking_evolution_per_user_idx",
        "where use_case = 'inventory.evolve' and result_acknowledged_at is null",
        "'ack_required'",
        "p_request->>'template_id' !~ '^pet-[nat]-[0-9]{3}-[123]$'",
        "p_request <> jsonb_build_object(",
        "mod(v_evolution_quantity, 3) <> 0",
    )
    missing = [term for term in operation_required if term not in operations]
    forbidden_operation_bypasses = (
        "if p_use_case like 'battle.%' then",
        "use_case not like 'battle.%'",
        "operations_non_battle_open_user_idx",
        "operations_non_battle_failed_user_idx",
    )
    present_bypasses = [
        term for term in forbidden_operation_bypasses if term in operations
    ]
    begin_command = operations[operations.index("create or replace function operations.begin_command") :]
    ordering = [
        begin_command.find("select * into v_operation"),
        begin_command.find("if p_use_case = 'inventory.evolve' then"),
        begin_command.find("perform operations.assert_new_operation_id"),
        begin_command.find("perform operations.admit_new_command"),
        begin_command.find("insert into operations.operations"),
    ]
    if (
        missing
        or present_bypasses
        or any(index < 0 for index in ordering)
        or ordering != sorted(ordering)
    ):
        raise SystemExit(
            "Operation admission must cover Battle, preserve Battle action limits, and "
            "replay before UUIDv7 freshness, quota, and insert: "
            f"missing={missing}, bypasses={present_bypasses}, "
            f"ordering={ordering}"
        )
    if "on conflict (id) do nothing" in begin_command.partition("$$;")[0]:
        raise SystemExit("Operation admission cannot count a racing same-key retry")
    if (
        "operationIdSchema.safeParse(value)" not in middleware
        or "crypto.getRandomValues(new Uint8Array(16))" not in client
        or "(bytes[6]! & 0x0f) | 0x70" not in client
        or "(bytes[8]! & 0x3f) | 0x80" not in client
    ):
        raise SystemExit("Browser and API UUIDv7 boundary is incomplete")

    operation_references: set[tuple[str, str]] = set()
    for path in sorted((ROOT / "supabase/schemas").glob("*.sql")):
        table: str | None = None
        for line in path.read_text(encoding="utf-8").lower().splitlines():
            table_match = re.match(r"create table ([a-z_]+\.[a-z_]+) \(", line)
            if table_match:
                table = table_match.group(1)
            reference_match = re.match(
                r"\s*([a-z_]+) uuid[^\n]*references operations\.operations\(id\)",
                line,
            )
            if table and reference_match:
                operation_references.add((table, reference_match.group(1)))
    uncovered = sorted(
        f"{table}.{column}"
        for table, column in operation_references
        if f"from {table} where {column} = p_operation_id" not in jobs
    )
    retention_required = (
        "create or replace function operations.operation_has_durable_reference",
        "o.status = 'failed' and o.completed_at < now() - interval '7 days'",
        "o.status = 'succeeded' and o.completed_at < now() - interval '37 days'",
        "limit greatest(1, least(p_limit, 5000))",
        "for update of o skip locked",
        "delete from operations.operations",
        "'payloads_compacted'",
        "'operations_deleted'",
    )
    missing = [term for term in retention_required if term not in jobs]
    if uncovered or missing:
        raise SystemExit(
            "Operation retention reference coverage is incomplete: "
            f"uncovered={uncovered}, missing={missing}"
        )

    function_pattern = re.compile(
        r"create or replace function api\.[a-z0-9_]+\(.*?\n\$\$;",
        re.DOTALL,
    )
    nested_admission: list[str] = []
    for path in sorted((ROOT / "supabase/schemas").glob("*.sql")):
        for function in function_pattern.findall(path.read_text(encoding="utf-8").lower()):
            if "operations.begin_command(" not in function:
                continue
            prefix = function[: function.index("operations.begin_command(")]
            if len(re.findall(r"^begin$", prefix, re.MULTILINE)) != 1:
                name = re.search(r"function api\.([a-z0-9_]+)", function)
                nested_admission.append(name.group(1) if name else path.name)
    if nested_admission:
        raise SystemExit(
            "Operation admission errors cannot be caught as business failures: "
            f"{nested_admission}"
        )


def verify_game_page_boundary() -> None:
    game_page = GAME_PAGE.read_text(encoding="utf-8")
    gacha_view = (WEB_ROOT / "domains/gacha/ui/GachaView.tsx").read_text(
        encoding="utf-8"
    )
    if (
        'import { BattleView } from "../../domains/battle/index.ts";'
        not in game_page
        or '<main className="page game-page" aria-label="Battle">'
        not in game_page
        or "<BattleView />" not in game_page
        or "game-page.css" in game_page
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
    battle_view = (
        WEB_ROOT / "domains/battle/ui/BattleView.tsx"
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
        not in (WEB_ROOT / "domains/battle/ui/battle-core.css").read_text(
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
        "倒计时结束后将自动进入对战",
    )
    missing_countdown_terms = [
        value for value in countdown_terms if value not in battle_screens
    ]
    if missing_countdown_terms:
        raise SystemExit(
            "Battle locked countdown page is incomplete: "
            f"{missing_countdown_terms}"
        )
    battle_css = (WEB_ROOT / "domains/battle/ui/battle-core.css").read_text(
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
    live_battle_shell_selector = (
        '.app-shell:has(.battle-root[data-battle-page-state="battle"])'
    )
    live_battle_shell_rule = battle_css.partition(
        f"{live_battle_shell_selector} {{"
    )[2].partition("}")[0]
    live_battle_navigation_rule = battle_css.partition(
        f"{live_battle_shell_selector} .bottom-nav {{"
    )[2].partition("}")[0]
    if (
        "padding-bottom: var(--safe-bottom)" not in live_battle_shell_rule
        or "display: none" not in live_battle_navigation_rule
        or f"{live_battle_shell_selector} .topbar" in battle_css
    ):
        raise SystemExit(
            "Live Battle must hide only bottom navigation and release its layout "
            "space while preserving the Telegram safe area"
        )
    live_battle_page_selector = (
        '.game-page:has(> .battle-root[data-battle-page-state="battle"])'
    )
    live_battle_page_rule = battle_css.partition(
        f"{live_battle_page_selector} {{"
    )[2].partition("}")[0]
    live_battle_root_rule = battle_css.partition(
        '.battle-root[data-battle-page-state="battle"] {'
    )[2].partition("}")[0]
    battle_skill_grid_rule = battle_css.rpartition(".battle-skill-grid {")[2].partition(
        "}"
    )[0]
    battle_skill_button_rule = battle_css.rpartition(
        ".battle-skill-grid > button {"
    )[2].partition("}")[0]
    compact_skill_selector = (
        ".battle-skill-grid:has(> button:nth-child(3)) > button"
    )
    compact_skill_name_selector = f"{compact_skill_selector} span"
    compact_skill_meta_selector = (
        ".battle-skill-grid:has(> button:nth-child(3)) small"
    )
    if (
        "padding-bottom: 0" not in live_battle_page_rule
        or "min-height: 0" not in live_battle_root_rule
        or "height: 95px" not in battle_skill_grid_rule
        or "grid-auto-rows: minmax(0, 1fr)" not in battle_skill_grid_rule
        or "min-height: 0" not in battle_skill_button_rule
        or f"{compact_skill_selector} {{" not in battle_css
        or f"{compact_skill_name_selector} {{" not in battle_css
        or f"{compact_skill_meta_selector} {{" not in battle_css
        or "font-size: clamp(9px, 2.9vw, 12px)" not in battle_css
        or ".battle-skill-grid > button:nth-child(3):last-child" not in battle_css
    ):
        raise SystemExit(
            "Live Battle skill controls must keep one 95px command grid, "
            "compact three/four skills into two readable rows, and remove "
            "generic page overflow without changing the three-skill span"
        )
    lobby_source = battle_screens.partition(
        "export function BattleLobby"
    )[2].partition("export function BattleInviteMissing")[0]
    if (
        "creator_avatar_url" in lobby_source
        or "opponent_avatar_url" in lobby_source
        or lobby_source.count("/assets/pets/pet-silhouette.svg") != 2
        or "<UserRound" not in lobby_source
    ):
        raise SystemExit(
            "Battle lobby must use the fixed repository silhouette asset and "
            "neutral offline icons only"
        )
    battle_realtime_runtime = (
        WEB_ROOT / "workflows/battle-realtime/battleRealtimeRuntime.ts"
    ).read_text(encoding="utf-8")
    required_realtime_terms = (
        '"battle.realtime_token"',
        "parseBattleRealtimeInvalidation(data)",
        "parseBattleRealtimeAuthorization(token.data)",
        "refreshed.clientId !== authorization.clientId",
        "refreshed.userChannel !== authorization.userChannel",
        "return 1_000",
        "return 2_000",
        "loadBattleRealtimeRuntime()",
        "Promise.all([",
    )
    required_realtime_runtime_terms = (
        'import * as Ably from "ably"',
        "validateRefreshedAuthorization",
        "pendingAuthorizedChannels",
        "synchronizeChannels",
        'client.connection.on("update", handleConnectionUpdate)',
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
    missing_realtime_runtime_terms = [
        value
        for value in required_realtime_runtime_terms
        if value not in battle_realtime_runtime
    ]
    if missing_realtime_runtime_terms:
        raise SystemExit(
            "Battle realtime dynamic runtime is incomplete: "
            f"{missing_realtime_runtime_terms}"
        )
    required_realtime_context_terms = (
        "`room:${room?.room_id ?? participation?.room_id}`",
        "`invite:${inviteRoom.room_id}`",
        "`user:${session.userId}`",
    )
    missing_realtime_context_terms = [
        value for value in required_realtime_context_terms if value not in battle_view
    ]
    if missing_realtime_context_terms:
        raise SystemExit(
            "Battle realtime authorization context handoff is incomplete: "
            f"{missing_realtime_context_terms}"
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
        or 'import "../../shared/styles/game-page.css";' not in tasks_page
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
        or "const path = `/tasks?${params.toString()}`;" not in payment_resume
        or 'candidate.intent.kind !== "gacha"' not in payment_resume
        or "currentTopupRequest?.orderId === candidate.id" not in payment_resume
        or "requestedResumeOrderId === gachaResume?.orderId" not in gacha_view
        or "requestedTier === gachaResume.intent.tier" not in gacha_view
        or "resumedCount === gachaResume.intent.draw_count" not in gacha_view
        or "preparePage(path);" not in payment_resume
        or "navigate(path);" not in payment_resume
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


def verify_battle_staged_runtime_loading() -> None:
    battle_root = WEB_ROOT / "domains/battle"
    battle_view = (battle_root / "ui/BattleView.tsx").read_text(encoding="utf-8")
    battle_arena = (battle_root / "ui/BattleArena.tsx").read_text(encoding="utf-8")
    battle_deadline = (battle_root / "useBattleDeadline.ts").read_text(
        encoding="utf-8"
    )
    animation = (battle_root / "useBattleAnimation.ts").read_text(encoding="utf-8")
    effect_loader = (battle_root / "battleRuntimeLoader.ts").read_text(
        encoding="utf-8"
    )
    effect_player = (battle_root / "battleEffectPlayer.ts").read_text(
        encoding="utf-8"
    )
    core_css = (battle_root / "ui/battle-core.css").read_text(encoding="utf-8")
    effect_css = (battle_root / "ui/battle-effects.css").read_text(
        encoding="utf-8"
    )
    realtime_hook = (
        WEB_ROOT / "workflows/battle-realtime/useBattleRealtime.ts"
    ).read_text(encoding="utf-8")
    realtime_loader = (
        WEB_ROOT
        / "workflows/battle-realtime/battleRealtimeRuntimeLoader.ts"
    ).read_text(encoding="utf-8")
    realtime_runtime = (
        WEB_ROOT / "workflows/battle-realtime/battleRealtimeRuntime.ts"
    ).read_text(encoding="utf-8")
    vite_config = (ROOT / "apps/web/vite.config.ts").read_text(encoding="utf-8")
    budget = (ROOT / "apps/web/vite/battleRuntimeBudget.ts").read_text(
        encoding="utf-8"
    )
    preload = (ROOT / "apps/web/vite/battleModulePreload.ts").read_text(
        encoding="utf-8"
    )

    if (battle_root / "ui/battle.css").exists():
        raise SystemExit("Battle must not retain the former combined stylesheet")
    deadline_required = (
        "remainingMilliseconds",
        "performance.now()",
        "Date.now()",
        "window.setTimeout(update, Math.ceil(initialRemaining))",
        'document.addEventListener("visibilitychange", update)',
        'window.addEventListener("focus", update)',
        'window.addEventListener("pageshow", update)',
        "isOpenNow(): boolean",
        "synchronize(): void",
    )
    if (
        any(fragment not in battle_deadline for fragment in deadline_required)
        or battle_view.count("if (!clock.isOpenNow())") != 3
        or battle_view.count("clock.synchronize();") != 4
        or battle_view.count("{ canSubmit: canSubmitBattleAction }") != 3
        or "clock.remainingMilliseconds > 0" not in battle_view
        or "snapshot.viewer_action_state === \"available\" &&\n    actionWindowOpen" not in battle_arena
        or "switchOpen &&\n      available" not in battle_arena
    ):
        raise SystemExit(
            "Battle actions and controls must share the exact server-anchored deadline gate"
        )
    if 'from "ably"' in realtime_hook or "battleEffectPlayer" in animation:
        raise SystemExit(
            "Ably and the heavy Battle effect player must not enter Battle Core statically"
        )
    required_sources = {
        "Battle runtime preparation": (
            battle_view,
            (
                "Promise.allSettled([",
                "prepareBattleRealtimeRuntime()",
                "prepareBattleEffectRuntime()",
                "startAdaptiveBattleRuntimeWarmup",
                'pageState !== "home"',
                "onPointerDownCapture={prepareBattleRuntimeModules}",
            ),
        ),
        "Battle preparation feedback": (
            battle_arena,
            ("presentation.runtimePreparing", "战斗准备中"),
        ),
        "Battle effect degradation": (
            animation,
            (
                "loadBattleEffectRuntime",
                "return null;",
                "safelyPlayEffect",
                "applyHpResult(setPresentation, event)",
            ),
        ),
        "Battle effect retry loader": (
            effect_loader,
            (
                'import("./battleEffectPlayer.ts")',
                "effectRuntimePromise = null",
                'connection.effectiveType === "4g"',
                "connection?.saveData === false",
            ),
        ),
        "Battle effect stylesheet boundary": (
            effect_player + effect_css,
            ('import "./ui/battle-effects.css";', 'data-trajectory="10"'),
        ),
        "Battle realtime parallel loading": (
            realtime_hook,
            (
                "const tokenPromise = apiRequest(",
                "const runtimePromise = loadBattleRealtimeRuntime();",
                "await Promise.all([",
                'status === "connected"',
            ),
        ),
        "Battle realtime retry loader": (
            realtime_loader,
            ('import("./battleRealtimeRuntime.ts")', "runtimePromise = null"),
        ),
        "Battle realtime isolated runtime": (
            realtime_runtime,
            ('import * as Ably from "ably";', "connectBattleRealtimeRuntime"),
        ),
        "Battle build budget": (
            vite_config + budget,
            (
                "battleRuntimeBudgetPlugin()",
                "jsRaw: 160_000",
                "jsGzip: 45_000",
                "cssRaw: 45_000",
                "cssGzip: 9_000",
                '"/node_modules/ably/"',
                '"/apps/web/src/domains/battle/battleEffectPlayer.ts"',
                ".battle-effect-layer[data-trajectory=",
                "Battle dynamic preload entry JS",
            ),
        ),
        "Battle dynamic preload entry deduplication": (
            vite_config + preload + budget,
            (
                "resolveBattleModulePreloadDependencies",
                "resolveDependencies: resolveBattleModulePreloadDependencies",
                "battleRealtimeChunkPattern",
                "applicationEntryChunkPattern",
                'context.hostType !== "js"',
                "battlePreloadEntryDependencies",
                "application entry JS entered Battle dynamic preload hints",
            ),
        ),
    }
    missing = {
        label: [term for term in terms if term not in source]
        for label, (source, terms) in required_sources.items()
        if any(term not in source for term in terms)
    }
    if missing:
        raise SystemExit(f"Battle staged runtime loading is incomplete: {missing}")
    if "data-trajectory" in core_css or "--battle-effect-primary" in core_css:
        raise SystemExit("Heavy effect trajectory CSS entered Battle Core")

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


def verify_battle_session_rollover_authority_gate() -> None:
    client = (WEB_ROOT / "platform/api/client.ts").read_text(encoding="utf-8")
    recovery_success = client.partition(
        "assertCurrentNormalSession(next.generation);"
    )[2].partition("})().finally")[0]
    ordered_terms = (
        "clearSensitiveState();",
        "seedSessionInitialState(next.generation, initialState.data);",
        "replaceSession({ ...next, recovering: false, initialStateFailed: false });",
    )
    positions = [recovery_success.find(term) for term in ordered_terms]
    if any(position < 0 for position in positions) or positions != sorted(positions):
        raise SystemExit(
            "Recovered initial state must be seeded before the new session generation "
            "is released to authenticated pages"
        )

    battle_view = (WEB_ROOT / "domains/battle/ui/BattleView.tsx").read_text(
        encoding="utf-8"
    )
    battle_screens = (
        WEB_ROOT / "domains/battle/ui/BattleScreens.tsx"
    ).read_text(encoding="utf-8")
    required_view_terms = (
        "const authorityRecoveryPending =",
        "participation !== null && roomUnavailable",
        "if (bootstrap.isLoading || authorityRecoveryPending) return;",
        'data-battle-authority-recovery="true"',
        "battleAuthorityRetryDelays",
        "authorityFreshGeneration.current = sessionGeneration",
    )
    missing_view_terms = [
        term for term in required_view_terms if term not in battle_view
    ]
    recovery_render = battle_view.find('data-battle-authority-recovery="true"')
    business_render = battle_view.find('data-battle-page-state={pageState}')
    if (
        missing_view_terms
        or recovery_render < 0
        or business_render < 0
        or recovery_render > business_render
        or "恢复当前 Battle" in battle_screens
        or "battle-participation-notice" in battle_screens
    ):
        raise SystemExit(
            "Battle session-rollover authority gate is incomplete: "
            f"missing={missing_view_terms}"
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


def verify_battle_operation_admission() -> None:
    sources = {
        relative(BATTLE_SCHEMA): (
            (ROOT / "supabase/schemas/30_operations.sql").read_text(encoding="utf-8"),
            BATTLE_SCHEMA.read_text(encoding="utf-8"),
        ),
        relative(BATTLE_BASELINE_MIGRATION): (
            BATTLE_BASELINE_MIGRATION.read_text(encoding="utf-8"),
            BATTLE_BASELINE_MIGRATION.read_text(encoding="utf-8"),
        ),
    }
    for label, (operations_source, battle_source) in sources.items():
        try:
            verify_battle_operation_admission_source(
                label, operations_source, battle_source
            )
        except ValueError as error:
            raise SystemExit(str(error)) from error

    label, (operations_source, battle_source) = next(iter(sources.items()))
    admission = extract_sql_function(
        label, operations_source, "operations.admit_new_command"
    )
    bypass_admission = admission.replace(
        "begin\n",
        "begin\n  if starts_with(p_use_case, 'battle.') then\n    return;\n  end if;\n",
        1,
    )
    bypass_source = operations_source.replace(admission, bypass_admission, 1)
    try:
        verify_battle_operation_admission_source(
            "in-memory equivalent Battle bypass", bypass_source, battle_source
        )
    except ValueError:
        pass
    else:
        raise SystemExit("Battle admission checker accepted an equivalent early return")

    create_limit = "perform battle.consume_rate_limit(v_user_id, 'create');"
    missing_limit_source = battle_source.replace(create_limit, "perform 1;", 1)
    try:
        verify_battle_operation_admission_source(
            "in-memory misplaced Battle action limit",
            operations_source,
            missing_limit_source,
        )
    except ValueError:
        pass
    else:
        raise SystemExit("Battle admission checker accepted a missing create limit")

    cancel = extract_sql_function(label, battle_source, "api.battle_cancel_room")
    cancel_begin = re.search(
        r"\n  v_operation := operations\.begin_command\(.*?\n  \);\n",
        cancel,
        re.DOTALL,
    )
    if cancel_begin is None:
        raise SystemExit("Battle admission self-test cannot locate cancel begin_command")
    missing_begin_source = battle_source.replace(
        cancel,
        cancel.replace(cancel_begin.group(), "\n", 1),
        1,
    )
    try:
        verify_battle_operation_admission_source(
            "in-memory missing Battle begin_command",
            operations_source,
            missing_begin_source,
        )
    except ValueError:
        pass
    else:
        raise SystemExit("Battle admission checker accepted a missing begin_command")


def verify_battle_operation_admission_source(
    label: str, operations_source: str, battle_source: str
) -> None:
    admission = extract_sql_function(
        label, operations_source, "operations.admit_new_command"
    ).lower()
    if re.search(r"\breturn\s*;", admission):
        raise ValueError(f"{label}: generic operation admission cannot return early")
    if (
        admission.count("p_use_case") != 2
        or admission.count("use_case") != 3
        or "if p_use_case = 'inventory.evolve' and exists (" not in admission
        or "and o.use_case = 'inventory.evolve'" not in admission
    ):
        raise ValueError(
            f"{label}: operation admission use-case branching is not the single "
            "inventory evolution acknowledgement guard"
        )
    operations_lower = operations_source.lower()
    for index_name in ("operations_open_user_idx", "operations_failed_user_idx"):
        index_definitions = re.findall(
            rf"create index {index_name}\b.*?;", operations_lower, re.DOTALL
        )
        if len(index_definitions) != 1 or "use_case" in index_definitions[0]:
            raise ValueError(
                f"{label}: {index_name} must index the generic status predicate "
                "without a use-case exclusion"
            )
    admission_order = [
        admission.find("pg_advisory_xact_lock(hashtextextended('operations.admission:'"),
        admission.find("insert into operations.user_admission_counters"),
        admission.find("from operations.user_admission_counters"),
        admission.find("status = 'failed'"),
        admission.find("status in ('pending', 'unknown')"),
        admission.find("update operations.user_admission_counters"),
    ]
    if (
        any(position < 0 for position in admission_order)
        or admission_order != sorted(admission_order)
    ):
        raise ValueError(f"{label}: generic operation admission order is incomplete")

    rpc_contracts = {
        "api.battle_prepare_room": (
            "battle.create",
            "perform battle.consume_rate_limit(v_user_id, 'create');",
        ),
        "api.battle_cancel_room": ("battle.cancel", None),
        "api.battle_accept_room": (
            "battle.accept",
            "perform battle.consume_rate_limit(v_operation.user_id, 'accept', v_invite_hash);",
        ),
        "api.battle_matchmake": (
            "battle.matchmake",
            "perform battle.consume_rate_limit(v_operation.user_id, 'matchmake');",
        ),
        "api.battle_submit_action": (
            "battle.action",
            "perform battle.consume_rate_limit(v_operation.user_id, 'combat_action');",
        ),
    }
    for rpc_name, (use_case, limiter) in rpc_contracts.items():
        function = extract_sql_function(label, battle_source, rpc_name).lower()
        begin_matches = list(
            re.finditer(
                rf"operations\.begin_command\(\s*p_session_id\s*,\s*'{re.escape(use_case)}'\s*,",
                function,
            )
        )
        if len(begin_matches) != 1:
            raise ValueError(
                f"{label}: {rpc_name} must reserve exactly one {use_case} operation"
            )
        begin_command = begin_matches[0].start()
        pre_admission = function[:begin_command]
        if "for update" in pre_admission or "pg_advisory_xact_lock" in pre_admission:
            raise ValueError(
                f"{label}: {rpc_name} cannot acquire row or advisory locks before "
                "operation admission"
            )
        replay = function.find("operations.replay_if_finished", begin_command)
        business_block = function.find("\n  begin\n", replay)
        if replay < 0 or business_block < 0:
            raise ValueError(
                f"{label}: {rpc_name} must replay before its business transaction block"
            )
        limiter_calls = function.count("perform battle.consume_rate_limit(")
        if limiter is None:
            if limiter_calls != 0:
                raise ValueError(
                    f"{label}: {rpc_name} cannot invent a cancel-specific action limit"
                )
        else:
            limiter_position = function.find(limiter)
            if limiter_calls != 1 or limiter_position <= business_block:
                raise ValueError(
                    f"{label}: {rpc_name} action limit must occur once after replay "
                    "inside its business block"
                )


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
    unsafe_prelock_function = function.replace(
        "    and s.revoked_at is null and s.expires_at > now();\n",
        "    and s.revoked_at is null and s.expires_at > now()\n  for update;\n",
        1,
    )
    unsafe_prelock_source = source.replace(function, unsafe_prelock_function, 1)
    if unsafe_prelock_source == source:
        raise SystemExit("Battle accept pre-admission lock negative variant did not mutate")
    try:
        verify_battle_accept_source(
            "in-memory accept pre-admission row lock", unsafe_prelock_source
        )
    except ValueError as error:
        if "before operation admission" not in str(error):
            raise SystemExit(
                "Battle accept pre-admission lock variant failed for an unrelated reason: "
                f"{error}"
            ) from error
    else:
        raise SystemExit("Battle accept checker accepted a pre-admission row lock")

    post_guard = re.search(
        r"\n    if v_room\.creator_user_id = v_operation\.user_id then.*?\n    end if;\n",
        function,
        re.DOTALL,
    )
    if post_guard is None:
        raise SystemExit("Battle accept ordering self-test cannot locate locked self guard")
    missing_guard_source = source.replace(
        function, function.replace(post_guard.group(), "\n", 1), 1
    )
    try:
        verify_battle_accept_source(
            "in-memory missing locked accept self guard", missing_guard_source
        )
    except ValueError as error:
        if "authoritative locked self guard" not in str(error):
            raise SystemExit(
                "Battle accept locked self-guard variant failed for an unrelated reason: "
                f"{error}"
            ) from error
    else:
        raise SystemExit("Battle accept checker accepted a missing locked self guard")


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
    pre_session_read = normalized.find(
        "select s.battle_invite_token_hash into v_invite_hash "
        "from identity.sessions s where s.id = p_session_id "
        "and s.user_id = v_user_id and s.revoked_at is null "
        "and s.expires_at > now();"
    )
    pre_room_read = normalized.find(
        "select * into v_room from battle.rooms r "
        "where r.room_mode = 'friend_invite' "
        "and r.invite_token_hash = v_invite_hash;"
    )
    pre_self_guard = BATTLE_ACCEPT_SELF_GUARD_PATTERN.search(function)
    begin_command = normalized.find("v_operation := operations.begin_command(")
    replay = normalized.find("v_replay := operations.replay_if_finished", begin_command)
    inner_session_lock = normalized.find(
        "select s.battle_invite_token_hash into v_invite_hash "
        "from identity.sessions s where s.id = p_session_id "
        "and s.user_id = v_operation.user_id and s.revoked_at is null "
        "and s.expires_at > now() for update;",
        replay,
    )
    inner_room_lock = normalized.find(
        "select * into v_room from battle.rooms r "
        "where r.room_mode = 'friend_invite' "
        "and r.invite_token_hash = v_invite_hash for update;",
        inner_session_lock,
    )
    locked_self_guard = normalized.find(
        "if v_room.creator_user_id = v_operation.user_id then "
        "perform api.raise_business_error( "
        "'BATTLE_SELF_ACCEPT_FORBIDDEN', '不能接受自己创建的挑战' ); end if;",
        inner_room_lock,
    )
    rate_limit = normalized.find(
        "perform battle.consume_rate_limit(v_operation.user_id, 'accept', v_invite_hash);"
    )
    if begin_command >= 0:
        pre_admission = normalized[:begin_command]
        if "for update" in pre_admission or "pg_advisory_xact_lock" in pre_admission:
            raise ValueError(
                f"{label}: Battle accept cannot acquire locks before operation admission"
            )
    if (
        session_user < 0
        or pre_session_read < 0
        or pre_room_read < 0
        or pre_self_guard is None
        or begin_command < 0
        or replay < 0
        or inner_session_lock < 0
        or inner_room_lock < 0
        or locked_self_guard < 0
        or rate_limit < 0
    ):
        raise ValueError(
            f"{label}: Battle accept authoritative locked self guard structure is incomplete"
        )
    normalized_pre_self_guard = len(
        re.sub(r"\s+", " ", function[: pre_self_guard.start()])
    )
    if not (
        session_user
        < pre_session_read
        < pre_room_read
        < normalized_pre_self_guard
        < begin_command
        < replay
        < inner_session_lock
        < inner_room_lock
        < locked_self_guard
        < rate_limit
    ):
        raise ValueError(
            f"{label}: Battle accept must use a non-locking fast self guard, then "
            "operation admission, replay, authoritative locks, self guard, and limit"
        )
    if function.count("BATTLE_SELF_ACCEPT_FORBIDDEN") != 2:
        raise ValueError(
            f"{label}: Battle accept must have one fast and one authoritative self guard"
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


def verify_market_transactional_supply_read_model() -> None:
    sql = MARKET_SCHEMA.read_text(encoding="utf-8").lower()
    required_sql = (
        "create table market.seller_template_supply",
        "primary key (seller_id, template_id)",
        "create table market.template_supply",
        "eligible_quantity bigint not null check (eligible_quantity > 0)",
        "pg_advisory_xact_lock(hashtextextended('market.template-supply:' || p_template_id, 0))",
        "create trigger listings_supply_sync",
        "after insert or delete or update of seller_id, template_id, remaining, status on market.listings",
        "create trigger users_market_supply_status_sync",
        "order by affected.template_id",
        "create or replace function market.rebuild_supply()",
        "lock table identity.users in share mode",
        "lock table market.listings in share mode",
        "revoke execute on function market.rebuild_supply() from public, anon, authenticated, service_role",
        "create table market.seller_listing_quotas",
        "daily_count integer not null default 0 check (daily_count between 0 and 200)",
        "lifetime_count integer not null default 0 check (lifetime_count between 0 and 20000)",
        "check (daily_count <= lifetime_count)",
        "create or replace function market.lock_listing_quota(p_seller_id uuid)",
        "create or replace function market.consume_listing_quota()",
        "create trigger listings_quota_consume",
        "before insert on market.listings",
        "set daily_count = daily_count + 1,\n      lifetime_count = lifetime_count + 1",
        "create or replace function market.purchase_quantity_limit()",
        "select 100::bigint",
        "revoke execute on function market.purchase_quantity_limit() from public, anon, authenticated, service_role",
    )
    missing = [fragment for fragment in required_sql if fragment not in sql]
    if missing:
        raise SystemExit(f"Market transactional supply model is incomplete: {missing}")

    policy_source = MARKET_POLICY.read_text(encoding="utf-8")
    contract_source = MARKET_CONTRACT.read_text(encoding="utf-8")
    topup_source = TOPUP_MODELS.read_text(encoding="utf-8")
    view_source = MARKET_VIEW.read_text(encoding="utf-8")
    payments_sql = PAYMENTS_SCHEMA.read_text(encoding="utf-8").lower()
    topup_quantity_ordering = (
        payments_sql.find("jsonb_typeof(p_intent->'quantity') is distinct from 'number'"),
        payments_sql.find("(p_intent->>'quantity') !~ '^[1-9][0-9]{0,2}$'"),
        payments_sql.find("v_market_quantity := (p_intent->>'quantity')::bigint"),
        payments_sql.find("v_market_quantity > market.purchase_quantity_limit()"),
        payments_sql.find("v_count := v_market_quantity::integer"),
    )
    if (
        "export const MARKET_PURCHASE_MAX_QUANTITY = 100;" not in policy_source
        or contract_source.count("marketPurchaseQuantitySchema") < 4
        or "quantity: marketPurchaseQuantitySchema" not in topup_source
        or view_source.count("MARKET_PURCHASE_MAX_QUANTITY") < 5
        or any(index < 0 for index in topup_quantity_ordering)
        or topup_quantity_ordering != tuple(sorted(topup_quantity_ordering))
    ):
        raise SystemExit(
            "Market purchase quantity 1..100 must share one TypeScript policy and a database backstop"
        )

    purchase_match = re.search(
        r"create\s+or\s+replace\s+function\s+api\.market_purchase\s*\(.*?\n\$\$;",
        sql,
        re.DOTALL,
    )
    if purchase_match is None:
        raise SystemExit("Market purchase RPC is missing")
    purchase = purchase_match.group(0)
    purchase_ordering = (
        purchase.find("operations.replay_if_finished"),
        purchase.find("p_quantity > market.purchase_quantity_limit()"),
        purchase.find("pg_advisory_xact_lock(hashtextextended('market.purchase:'"),
        purchase.find("limit p_quantity\n      for update of l"),
        purchase.find("if v_available < p_quantity"),
        purchase.find("economy.change_balance(v_user_id"),
    )
    required_purchase_terms = (
        "p_quantity is null",
        "v_candidate_ids uuid[] := array[]::uuid[]",
        "v_candidate_ids := array_append(v_candidate_ids, v_listing.id)",
        "where l.id = any(v_candidate_ids)",
        "if v_remaining <> 0 then",
    )
    missing_purchase_terms = [
        term for term in required_purchase_terms if term not in purchase
    ]
    if (
        any(index < 0 for index in purchase_ordering)
        or purchase_ordering != tuple(sorted(purchase_ordering))
        or missing_purchase_terms
        or "order by l.created_at, l.id for update of l" in purchase
    ):
        raise SystemExit(
            "Market purchase must reject over-limit work before locking and settle only bounded FIFO candidates: "
            f"ordering={purchase_ordering}, missing={missing_purchase_terms}"
        )

    def function_block(name: str) -> str:
        match = re.search(
            rf"create\s+or\s+replace\s+function\s+api\.{re.escape(name)}\s*\(.*?\n\$\$;",
            sql,
            re.DOTALL,
        )
        if match is None:
            raise SystemExit(f"Market read RPC is missing: api.{name}")
        return match.group(0)

    read_blocks = {
        name: function_block(name)
        for name in ("market_bootstrap", "market_template", "market_my_listings")
    }
    raw_history_references = {
        name: [
            relation
            for relation in ("market.listings", "market.trade_details")
            if relation in block
        ]
        for name, block in read_blocks.items()
        if "market.listings" in block or "market.trade_details" in block
    }
    if raw_history_references:
        raise SystemExit(
            "Market read RPCs cannot scan authoritative listing or trade history: "
            f"{raw_history_references}"
        )
    if not all(
        fragment in read_blocks["market_bootstrap"]
        for fragment in ("market.template_supply", "market.seller_template_supply")
    ):
        raise SystemExit("market_bootstrap must read both primary-key supply models")
    if not all(
        fragment in read_blocks["market_template"]
        for fragment in ("market.template_supply", "market.seller_template_supply")
    ):
        raise SystemExit("market_template must read both primary-key supply models")
    my_listings = read_blocks["market_my_listings"]
    my_listings_required = (
        "from market.seller_template_supply",
        "where supply.seller_id = v_user_id",
        "from market.seller_sale_events",
        "sequence > v_after_sequence",
        "limit 100",
    )
    missing = [fragment for fragment in my_listings_required if fragment not in my_listings]
    if missing:
        raise SystemExit(f"market_my_listings lost its bounded supply/event path: {missing}")

    create_listing = function_block("market_create_listing")
    create_limit_required = (
        "select count(*) into v_active_count\n    from market.seller_template_supply",
        "select 1 from market.seller_template_supply",
    )
    missing = [fragment for fragment in create_limit_required if fragment not in create_listing]
    if missing:
        raise SystemExit(f"Market template limit must use seller supply rows: {missing}")

    lock_match = re.search(
        r"create\s+or\s+replace\s+function\s+market\.lock_listing_quota\s*\(.*?\n\$\$;",
        sql,
        re.DOTALL,
    )
    if lock_match is None:
        raise SystemExit("Market listing quota lock function is missing")
    lock_quota = lock_match.group(0)
    quota_required = (
        "v_business_date date := identity.utc_day()",
        "for update",
        "if v_quota.lifetime_count >= 20000 then",
        "'market_lifetime_listing_limit'",
        "if v_quota.daily_count >= 200 then",
        "'market_daily_listing_limit'",
    )
    missing = [fragment for fragment in quota_required if fragment not in lock_quota]
    if missing:
        raise SystemExit(f"Market listing quota lock is incomplete: {missing}")
    if lock_quota.index("market_lifetime_listing_limit") > lock_quota.index(
        "market_daily_listing_limit"
    ):
        raise SystemExit("Market lifetime listing limit must take precedence")
    replay = create_listing.index("operations.replay_if_finished")
    quota_lock = create_listing.index("perform market.lock_listing_quota(v_user_id)")
    business_block = create_listing.index("\n  begin\n", quota_lock)
    if not replay < quota_lock < business_block:
        raise SystemExit(
            "Market listing quota rejection must follow replay and precede the business exception block"
        )
    if "delete from market.seller_listing_quotas" in sql:
        raise SystemExit("Market lifetime listing quota cannot be deleted by business SQL")

    bootstrap_quota_required = (
        "'listing_quota', jsonb_build_object(",
        "'business_date', v_business_date",
        "'daily_used', v_daily_used",
        "'daily_limit', 200",
        "'daily_remaining', 200 - v_daily_used",
        "'lifetime_used', v_lifetime_used",
        "'lifetime_limit', 20000",
        "'lifetime_remaining', 20000 - v_lifetime_used",
    )
    missing = [
        fragment
        for fragment in bootstrap_quota_required
        if fragment not in read_blocks["market_bootstrap"]
    ]
    if missing:
        raise SystemExit(f"Market bootstrap quota contract is incomplete: {missing}")

    contract = MARKET_CONTRACT.read_text(encoding="utf-8")
    contract_quota_required = (
        "listing_quota: listingQuotaSchema",
        "daily_limit: z.literal(200)",
        "lifetime_limit: z.literal(20_000)",
        '"MARKET_DAILY_LISTING_LIMIT"',
        '"MARKET_LIFETIME_LISTING_LIMIT"',
    )
    missing = [fragment for fragment in contract_quota_required if fragment not in contract]
    if missing:
        raise SystemExit(f"Market listing quota API contract is incomplete: {missing}")
    removed_contract_fields = (
        "sold_quantity",
        "estimated_gross",
        "estimated_fee",
        "estimated_net",
        "estimated_vip_rebate",
        "partially_sold",
        "first_listed_at",
    )
    remaining = [field for field in removed_contract_fields if field in contract]
    if remaining:
        raise SystemExit(f"Market management contract restored removed fields: {remaining}")

    view = MARKET_VIEW.read_text(encoding="utf-8")
    quota_view_required = (
        "今日剩余",
        "listingQuota.daily_remaining",
        "累计",
        "listingQuota.lifetime_used",
        "20,000",
        "Boolean(quotaLimitMessage)",
        'empty={false}',
        'className="market-sell-empty"',
        "MarketListingQuotaStatus",
        "nextUtcDay",
        "refetchSellable()",
    )
    missing = [fragment for fragment in quota_view_required if fragment not in view]
    if missing:
        raise SystemExit(f"Market listing quota UI is incomplete: {missing}")

    errors = (CONTRACT_ROOT / "common/errors.ts").read_text(encoding="utf-8")
    runtime = OPERATION_REGISTRY_RUNTIME_PROVIDER.read_text(encoding="utf-8")
    for code, message in (
        ("MARKET_DAILY_LISTING_LIMIT", "今日上架次数已用完"),
        ("MARKET_LIFETIME_LISTING_LIMIT", "账号累计上架次数已达上限"),
    ):
        if code not in errors or message not in errors or code not in runtime:
            raise SystemExit(f"Market listing quota player error is incomplete: {code}")

    product = (ROOT / "docs/product/功能说明文档.md").read_text(encoding="utf-8")
    if "不设置每日上架次数和账号生命周期上架次数" in product:
        raise SystemExit("Retired unlimited market listing rule is still documented")
    product_required = (
        "每个账号在一个 UTC+0 自然日内最多成功上架 200 次",
        "每个账号在整个账号生命周期内最多成功上架 20,000 次",
        "今日剩余 N / 200 · 累计 M / 20,000",
    )
    missing = [fragment for fragment in product_required if fragment not in product]
    if missing:
        raise SystemExit(f"Market listing quota product rule is incomplete: {missing}")
    forbidden_management_ui = (
        "market-listing-summary",
        "item.sold_quantity",
        "item.estimated_gross",
        "item.estimated_fee",
        "item.estimated_net",
        "item.estimated_vip_rebate",
        'item.status === "partially_sold"',
    )
    remaining = [fragment for fragment in forbidden_management_ui if fragment in view]
    if remaining:
        raise SystemExit(f"Market management UI restored historical aggregates: {remaining}")

    jobs = (ROOT / "supabase/schemas/95_jobs.sql").read_text(encoding="utf-8")
    invariant_codes = (
        "MARKET_SELLER_SUPPLY_MISMATCH",
        "MARKET_TEMPLATE_SUPPLY_MISMATCH",
    )
    missing = [code for code in invariant_codes if code not in jobs]
    if missing:
        raise SystemExit(f"Market supply invariant monitoring is incomplete: {missing}")


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
        allowed_contracts = {f"@evomypet/api-contracts/{gateway}", "@evomypet/api-contracts/common"}
        for source in typescript_files(directory):
            for specifier in imports(source):
                if specifier.startswith("@evomypet/api-contracts/") and specifier not in allowed_contracts:
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


def verify_session_credential_boundary() -> None:
    session_source = (API_ROOT / "platform/session.ts").read_text(encoding="utf-8")
    middleware_source = (API_ROOT / "http/middleware.ts").read_text(encoding="utf-8")
    gateway_source = (API_ROOT / "http/gateway.ts").read_text(encoding="utf-8")
    identity_routes = (API_ROOT / "domains/identity/routes.ts").read_text(
        encoding="utf-8"
    )
    authenticate_block = identity_routes.partition(
        '"identity.authenticate": async (context) => {'
    )[2].partition('"identity.initial": async (context) =>')[0]

    required_session_terms = (
        "export type SessionCredential",
        "SESSION_TOKEN_VERSION = 1",
        "SESSION_TOKEN_PATTERN",
        "evomypet-session-id-v1:",
        "evomypet-session-proof-v1:",
        "timingSafeEqual(suppliedMac, expectedMac)",
        "decoded.toString(\"base64url\") !== token",
    )
    missing = [term for term in required_session_terms if term not in session_source]
    if missing:
        raise SystemExit(f"Local session credential proof is incomplete: {missing}")
    if (
        'from "./db/index.ts"' in session_source
        or "identity_resolve_session" in session_source
        or "identity_resolve_session" in middleware_source
    ):
        raise SystemExit("Session credential authentication cannot call the database")
    if "entry_handoff_state" in middleware_source:
        raise SystemExit("Mutable entry handoff authority must remain in player RPCs")
    if 'observeRequestStageSync(telemetry, "auth"' not in gateway_source:
        raise SystemExit("Local route authentication must use the synchronous auth stage")

    required_login_terms = (
        '"identity_consume_login_source_rate_limit"',
        '"identity_authenticate"',
        "p_user_key_hash:",
        "p_init_data_key_hash:",
        "p_session_id: issued.sessionId",
        "result.session_id !== issued.sessionId",
        '"identity_initial"',
        "initial_state: initialState",
    )
    missing = [term for term in required_login_terms if term not in authenticate_block]
    if missing or authenticate_block.count("await rpc") != 3:
        raise SystemExit(
            "Telegram authentication must declare source, authenticate, and post-commit initial-state RPCs: "
            f"missing={missing}, rpc_calls={authenticate_block.count('await rpc')}"
        )
    if "identity_consume_login_rate_limit" in identity_routes:
        raise SystemExit("Legacy three-call login limiter must remain removed")


def verify_telegram_catalog_start_param_allowlist() -> None:
    identity_routes = (API_ROOT / "domains/identity/routes.ts").read_text(
        encoding="utf-8"
    )
    required_route_terms = (
        'const TG_APP_LISTING_START_PARAM = "listed_on_tg_app";',
        "startParam === null ||",
        "startParam === TG_APP_LISTING_START_PARAM",
        "/^TMA[A-F0-9]{20}$/",
        "/^BTL_[A-Za-z0-9_-]{32}$/",
        'kind: "invalid"',
    )
    missing_route_terms = [
        term for term in required_route_terms if term not in identity_routes
    ]
    if missing_route_terms or identity_routes.count('"listed_on_tg_app"') != 1:
        raise SystemExit(
            "Telegram catalog start parameter allowlist is incomplete: "
            f"missing={missing_route_terms}"
        )

    forbidden_route_terms = (
        "startParam.startsWith(TG_APP_LISTING_START_PARAM)",
        "startParam.includes(TG_APP_LISTING_START_PARAM)",
        "startParam.toLowerCase()",
    )
    present_forbidden_terms = [
        term for term in forbidden_route_terms if term in identity_routes
    ]
    if present_forbidden_terms:
        raise SystemExit(
            "Telegram catalog start parameter must remain an exact, case-sensitive match: "
            f"{present_forbidden_terms}"
        )

    identity_sql = (ROOT / "supabase/schemas/10_identity.sql").read_text(
        encoding="utf-8"
    ).lower()
    required_identity_terms = (
        "p_entry_kind not in ('direct', 'referral', 'battle', 'invalid')",
        "p_entry_kind = 'direct' and (p_entry_referral_code is not null or p_battle_invite_token_hash is not null)",
        "v_new_user and p_entry_kind = 'referral'",
    )
    missing_identity_terms = [
        term for term in required_identity_terms if term not in identity_sql
    ]
    if missing_identity_terms or "listed_on_tg_app" in identity_sql:
        raise SystemExit(
            "Tg.app source must collapse to direct before the database boundary: "
            f"missing={missing_identity_terms}"
        )

    documentation_requirements = {
        "ADR-002": (
            ROOT / "docs/architecture/adr/ADR-002-identity-and-session.md",
            ("`listed_on_tg_app`", "`direct`", "精确"),
        ),
        "ADR-090": (
            ROOT / "docs/architecture/adr/ADR-090-tgapp-catalog-source-entry.md",
            ("`listed_on_tg_app`", "`direct`", "任何其他未知"),
        ),
        "product": (
            ROOT / "docs/product/功能说明文档.md",
            ("`listed_on_tg_app`", "Tg.app", "邀请候选"),
        ),
        "acceptance": (
            ROOT / "docs/operations/acceptance.md",
            (
                "https://t.me/EvoMyPet_bot/evomypet?startapp=listed_on_tg_app",
                "Safari Web Inspector",
                "identity.entry_candidates",
            ),
        ),
    }
    incomplete_documents: dict[str, list[str]] = {}
    for label, (path, required_terms) in documentation_requirements.items():
        source = path.read_text(encoding="utf-8")
        missing_terms = [term for term in required_terms if term not in source]
        if missing_terms:
            incomplete_documents[label] = missing_terms
    if incomplete_documents:
        raise SystemExit(
            "Telegram catalog entry documentation is incomplete: "
            f"{incomplete_documents}"
        )


def verify_identity_read_model_boundary() -> None:
    contract = (CONTRACT_ROOT / "domains/identity/routes.ts").read_text(
        encoding="utf-8"
    )
    handlers = (API_ROOT / "domains/identity/routes.ts").read_text(
        encoding="utf-8"
    )
    session_store = (WEB_ROOT / "platform/session/store.ts").read_text(
        encoding="utf-8"
    )
    query = (WEB_ROOT / "platform/query/index.ts").read_text(encoding="utf-8")
    recovery_coordinator = (
        WEB_ROOT / "app/recovery/AppRecoveryCoordinator.tsx"
    ).read_text(encoding="utf-8")
    schema = (ROOT / "supabase/schemas/10_identity.sql").read_text(
        encoding="utf-8"
    )
    operations = (ROOT / "supabase/schemas/30_operations.sql").read_text(
        encoding="utf-8"
    )
    security = (
        ROOT / "supabase/migrations/20260719104614_api_security.sql"
    ).read_text(encoding="utf-8")

    active_sources = "\n".join(
        path.read_text(encoding="utf-8")
        for root in (WEB_ROOT, API_ROOT, CONTRACT_ROOT)
        for path in typescript_files(root)
    ) + "\n" + "\n".join(
        (
            schema,
            security,
            (ROOT / "supabase/migrations/20260719104533_baseline.sql").read_text(
                encoding="utf-8"
            ),
            (ROOT / "packages/api-contracts/openapi/openapi.json").read_text(
                encoding="utf-8"
            ),
        )
    )
    legacy = [
        term
        for term in ("identity.bootstrap", "identity_bootstrap")
        if term in active_sources
    ]
    if legacy:
        raise SystemExit(f"Legacy identity bootstrap remains in active sources: {legacy}")

    required_contract = (
        'initial_state: identityInitialSchema.nullable()',
        'id: "identity.initial"',
        'path: "/api/me/initial"',
        'id: "identity.summary"',
        'path: "/api/me/summary"',
        "summary: identitySummarySchema",
        "recovery: identityRecoverySchema",
    )
    missing_contract = [term for term in required_contract if term not in contract]
    if missing_contract:
        raise SystemExit(
            f"Identity initial/summary contract is incomplete: {missing_contract}"
        )

    required_session_store = (
        "seedSessionInitialState",
        "identitySummaryCacheSeeder(generation, data.summary)",
        "recoverySnapshot = { generation, data: data.recovery }",
        "useIdentityRecovery",
        "clearIdentityRecovery()",
    )
    missing_session_store = [
        term for term in required_session_store if term not in session_store
    ]
    if missing_session_store:
        raise SystemExit(
            f"Generation-scoped identity recovery store is incomplete: {missing_session_store}"
        )
    if (
        "pendingPayments.data?.orders ?? recovery?.payment_recovery_orders"
        not in recovery_coordinator
    ):
        raise SystemExit(
            "Current payment recovery query must replace the one-shot identity recovery seed"
        )

    initial_query_bypasses = []
    for path in typescript_files(WEB_ROOT):
        source = path.read_text(encoding="utf-8")
        if re.search(
            r'(?:useApiQuery|fetchApiQuery|prefetchApiQuery)\(\s*["\']identity\.initial["\']',
            source,
        ):
            initial_query_bypasses.append(relative(path))
    if initial_query_bypasses:
        raise SystemExit(
            "identity.initial cannot enter React Query refresh ownership: "
            f"{initial_query_bypasses}"
        )

    required_query = (
        '[generation, "v1", "identity.summary", {}]',
        'const topAssetRouteIds = ["identity.summary", "vip.get"]',
        'query.queryKey[2] !== "identity.initial"',
        'routeIds: ["identity.summary"]',
    )
    missing_query = [term for term in required_query if term not in query]
    if missing_query or '"identity",' in query[query.index("const scopeMatchers"):query.index("export async function refreshRouteScopes")]:
        raise SystemExit(
            "Identity summary refresh ownership is not exact: "
            f"missing={missing_query}"
        )

    required_database = (
        "create or replace function api.identity_summary(p_session_id uuid)",
        "create or replace function api.identity_initial(p_session_id uuid)",
        "v_user_id uuid := api.session_user(p_session_id);",
        "'summary', jsonb_build_object(",
        "'recovery', jsonb_build_object(",
    )
    missing_database = [term for term in required_database if term not in schema]
    required_operations = (
        "create index operations_user_recovery_idx",
        "where use_case <> 'gacha.open'",
        "status in ('pending', 'unknown')",
        "and result_acknowledged_at is null",
    )
    missing_operations = [
        term for term in required_operations if term not in operations
    ]
    if missing_database or missing_operations:
        raise SystemExit(
            "Identity read-model database boundary is incomplete: "
            f"identity={missing_database}, operations={missing_operations}"
        )
    if (
        "'identity_initial'" not in security
        or "'identity_summary'" not in security
        or "identity_bootstrap" in security
        or '"identity.initial": async (context)' not in handlers
        or '"identity.summary": async (context)' not in handlers
    ):
        raise SystemExit("Identity read-model handlers or API privilege allowlist are incomplete")


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
    dormant_registry = (
        CONTRACT_ROOT / "registries/dormant-app.ts"
    ).read_text(encoding="utf-8")
    app_client = (CONTRACT_ROOT / "app-client.ts").read_text(encoding="utf-8")
    jobs_registry = (
        CONTRACT_ROOT / "registries/jobs.ts"
    ).read_text(encoding="utf-8")
    server_registry = (
        CONTRACT_ROOT / "registries/server.ts"
    ).read_text(encoding="utf-8")
    if (
        "walletRoutes" in app_registry
        or "mintRoutes" in app_registry
        or "export const routes = activeRoutes" not in app_registry
        or "return findRouteIn(activeRoutes" not in app_registry
        or "return findRouteByPathIn(activeRoutes" not in app_registry
        or "export const dormantRoutes = [...walletRoutes, ...mintRoutes]"
        not in dormant_registry
        or 'import("./client-routes/first-screen.ts")' not in app_client
        or "export async function loadClientRoute" not in app_client
        or "export async function parseRecoveredOperation" not in app_client
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
        "ADR-037",
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
    query_activity_adr = (
        ROOT / "docs/architecture/adr/ADR-037-persistent-page-query-activity.md"
    ).read_text(encoding="utf-8")
    required_query_activity_terms = (
        "页面查询活动状态",
        "切换前已经发出的 GET",
        "20 秒",
        '`refetchType: "active"`',
        "内容暂未更新",
        "隐藏页面查询不读取、不参与等待",
        "Telegram iOS 与 Android",
    )
    missing_query_activity_documentation = [
        value
        for value in required_query_activity_terms
        if value not in query_activity_adr
    ]
    if missing_query_activity_documentation:
        raise SystemExit(
            "Persistent-page query activity ADR is incomplete: "
            f"{missing_query_activity_documentation}"
        )
    session_proof_adr = (
        ROOT
        / "docs/architecture/adr/ADR-038-local-session-proof-and-login-rpc-consolidation.md"
    ).read_text(encoding="utf-8")
    required_session_proof_terms = (
        "49 字节",
        "66 字符 Base64URL",
        "恒定时间 HMAC",
        "`api.identity_consume_login_source_rate_limit`",
        "`api.identity_authenticate`",
        "相同幂等请求的重放仍消耗用户与 `initData` 限流次数",
        "`api.identity_resolve_session` 删除",
        "每分钟至多执行一次",
        "不配置双密钥兼容",
    )
    missing_session_proof_terms = [
        value
        for value in required_session_proof_terms
        if value not in session_proof_adr
    ]
    if missing_session_proof_terms:
        raise SystemExit(
            "Local session proof ADR is incomplete: "
            f"{missing_session_proof_terms}"
        )
    identity_read_model_adr = (
        ROOT
        / "docs/architecture/adr/ADR-049-identity-initial-state-and-summary-read-model.md"
    ).read_text(encoding="utf-8")
    required_identity_read_model_terms = (
        "`identity.initial`",
        "`identity.summary`",
        "`initial_state`",
        "generation-scoped",
        "operations_user_recovery_idx",
        "同一维护窗口",
        "不得降级",
    )
    missing_identity_read_model_terms = [
        value
        for value in required_identity_read_model_terms
        if value not in identity_read_model_adr
    ]
    if missing_identity_read_model_terms:
        raise SystemExit(
            "Identity initial/summary ADR is incomplete: "
            f"{missing_identity_read_model_terms}"
        )
    catalog_status_adr = (
        ROOT
        / "docs/architecture/adr/ADR-050-catalog-post-rebuild-readiness-gate.md"
    ).read_text(encoding="utf-8")
    required_catalog_status_terms = (
        "v1→v2",
        "失效即失败",
        "70/210/3/5",
        "`catalog.asset_mutation_runs`",
        "不使用 `bootstrap`",
        "不修改数据库 schema",
    )
    missing_catalog_status_terms = [
        value
        for value in required_catalog_status_terms
        if value not in catalog_status_adr
    ]
    if missing_catalog_status_terms:
        raise SystemExit(
            "Catalog post-rebuild readiness ADR is incomplete: "
            f"{missing_catalog_status_terms}"
        )
    catalog_release_tool = (ROOT / "tools/assets/release.mjs").read_text(
        encoding="utf-8"
    )
    required_catalog_status_gate = (
        "HISTORICAL_MANIFESTS",
        "assertCatalogReleaseReady(await readManifest())",
        'rpc("catalog_asset_release_get", {',
        'rpc("catalog_current", {})',
        'rpc("catalog_release", {',
        'status: "ready"',
        "EXPECTED_CATALOG_COUNTS",
    )
    missing_catalog_status_gate = [
        value
        for value in required_catalog_status_gate
        if value not in catalog_release_tool
    ]
    if missing_catalog_status_gate:
        raise SystemExit(
            "Catalog release status gate is incomplete: "
            f"{missing_catalog_status_gate}"
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
    expected = {
        "./app",
        "./app-client",
        "./app-client/errors",
        "./common",
        "./dormant-app",
        "./integrations",
        "./jobs",
        "./localization",
        "./server",
    }
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
