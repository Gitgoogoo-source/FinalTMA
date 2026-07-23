#!/usr/bin/env python3
"""Enforce repository module ownership and gateway isolation."""

from __future__ import annotations

import json
import re
from pathlib import Path


ROOT = Path(__file__).resolve().parents[2]
MATRIX = ROOT / "docs/architecture/domain-map.md"
WEB_ROOT = ROOT / "apps/web/src"
API_ROOT = ROOT / "apps/api/src"
CONTRACT_ROOT = ROOT / "packages/api-contracts/src"
LEGACY_GAME_ROOT = ROOT / "apps/web/public/monster-tamer"
MONSTER_TAMER_ROOT = WEB_ROOT / "domains/monster-tamer"
GAME_PAGE = WEB_ROOT / "pages/game/GamePage.tsx"
IMPORT_PATTERN = re.compile(r"(?:from\s+|import\()\s*[\"']([^\"']+)[\"']")
MODULE_IMPORT_PATTERN = re.compile(r"(?:from\s+|import\s*(?:\(\s*)?)[\"']([^\"']+)[\"']")

REQUIRED_PATHS = (
    "apps/web/src/app/guards",
    "apps/web/src/app/providers",
    "apps/web/src/app/recovery",
    "apps/web/src/app/router",
    "apps/web/src/app/shell",
    "apps/web/src/pages",
    "apps/web/src/domains",
    "apps/web/src/domains/monster-tamer",
    "apps/web/src/domains/monster-tamer/game",
    "apps/web/src/workflows/payment-recovery",
    "apps/api/src/domains/monster-tamer/routes.ts",
    "packages/api-contracts/src/domains/monster-tamer/routes.ts",
    "supabase/schemas/44_monster_tamer.sql",
    "docs/architecture/adr/ADR-011-monster-tamer-embedded-game.md",
    "apps/api/src/entrypoints/app",
    "apps/api/src/entrypoints/integrations",
    "apps/api/src/entrypoints/jobs",
    "apps/api/src/http",
    "apps/api/src/domains",
    "apps/api/src/workflows",
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
)
WEB_DOMAINS = {
    "album",
    "decomposition",
    "evolution",
    "expedition",
    "gacha",
    "inventory",
    "market",
    "mint",
    "monster-tamer",
    "referral",
    "tasks",
    "topup",
    "vip",
    "wallet",
    "wheel",
}
API_DOMAINS = {
    "album",
    "catalog",
    "decomposition",
    "evolution",
    "expedition",
    "gacha",
    "identity",
    "inventory",
    "market",
    "mint",
    "monster-tamer",
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
        raise SystemExit(f"Retired Pet World paths must remain deleted: {retired}")
    assert_directories(WEB_ROOT / "domains", WEB_DOMAINS, "Web domains")
    assert_directories(API_ROOT / "domains", API_DOMAINS, "API domains")
    assert_nonempty_domains(WEB_ROOT / "domains")
    assert_nonempty_domains(API_ROOT / "domains")
    verify_web_boundaries()
    verify_monster_tamer_boundary()
    verify_api_boundaries()
    verify_contract_boundaries()
    verify_documentation()
    verify_package_exports()
    verify_typescript_configuration()
    print("module ownership, gateway isolation, and twenty-one product domains are traceable")


def verify_domain_matrix() -> None:
    text = MATRIX.read_text(encoding="utf-8")
    chapters = [int(value) for value in re.findall(r"^\|\s*(\d+)\s+", text, re.MULTILINE)]
    if chapters != list(range(1, 22)):
        raise SystemExit(f"Domain matrix must contain chapters 1 through 21 exactly once: {chapters}")
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


def verify_monster_tamer_boundary() -> None:
    source_files = typescript_files(MONSTER_TAMER_ROOT)
    source = "\n".join(path.read_text(encoding="utf-8") for path in source_files)
    lowered = source.lower()
    required_web_terms = (
        "MonsterTamerOverlay",
        "monster_tamer.bootstrap",
        "monster_tamer.checkpoint",
        "monster_tamer.battle",
        "mountMonsterTamer",
        "showModal",
    )
    missing_web_terms = [term for term in required_web_terms if term not in source]
    if missing_web_terms:
        raise SystemExit(f"Monster Tamer embedded Web contract is incomplete: {missing_web_terms}")
    forbidden_persistence = (
        "localstorage",
        "sessionstorage",
        "document.cookie",
        "indexeddb",
        "monster_tamer_data",
    )
    used_persistence = [term for term in forbidden_persistence if term in lowered]
    if used_persistence:
        raise SystemExit(f"Monster Tamer cannot persist game state in the browser: {used_persistence}")

    game_root = MONSTER_TAMER_ROOT / "game"
    game_source = "\n".join(
        path.read_text(encoding="utf-8") for path in typescript_files(game_root)
    ).lower()
    forbidden_game_terms = (
        "apirequest(",
        "useapiquery(",
        "/api/",
        "authorization",
        "access_token",
        "supabase",
        "platform/session",
    )
    used_game_terms = [term for term in forbidden_game_terms if term in game_source]
    if used_game_terms:
        raise SystemExit(f"Phaser bridge crossed the authentication boundary: {used_game_terms}")
    required_game_terms = (
        "mountmonstertamer",
        "destroy",
        "setpaused",
        "replacesnapshot",
        "phaser",
    )
    missing_game_terms = [term for term in required_game_terms if term not in game_source]
    if missing_game_terms:
        raise SystemExit(f"Monster Tamer Phaser lifecycle is incomplete: {missing_game_terms}")

    package = json.loads((ROOT / "apps/web/package.json").read_text(encoding="utf-8"))
    if package.get("dependencies", {}).get("phaser") != "3.60.0":
        raise SystemExit("Monster Tamer must pin Phaser 3.60.0 in the Web package")
    if LEGACY_GAME_ROOT.exists():
        raise SystemExit("The retired unauthenticated Monster Tamer public bundle must remain deleted")

    game_page = GAME_PAGE.read_text(encoding="utf-8")
    expected_panels = ("MonsterTamerPanel", "ExpeditionPanel", "WheelPanel")
    stack = re.search(r'<div className="game-stack">(.*?)</div>', game_page, re.DOTALL)
    rendered_panels = tuple(re.findall(r"<([A-Z]\w*)\s*/>", stack.group(1))) if stack else ()
    if rendered_panels != expected_panels or any(game_page.count(panel) != 2 for panel in expected_panels):
        raise SystemExit("Game page must contain only MonsterTamerPanel, ExpeditionPanel, and WheelPanel in order")

    vercel = json.loads((ROOT / "vercel.json").read_text(encoding="utf-8"))
    rewrites = vercel.get("rewrites", [])
    rewrite_sources = [rewrite.get("source") for rewrite in rewrites]
    if any(source in {"/monster-tamer", "/monster-tamer/"} for source in rewrite_sources):
        raise SystemExit("Monster Tamer legacy paths must use the authenticated SPA catch-all")
    if rewrite_sources.count("/((?!api/).*)") != 1:
        raise SystemExit("The Web SPA catch-all must exist exactly once")

    contract = (CONTRACT_ROOT / "domains/monster-tamer/routes.ts").read_text(encoding="utf-8")
    handler = (API_ROOT / "domains/monster-tamer/routes.ts").read_text(encoding="utf-8")
    schema = (ROOT / "supabase/schemas/44_monster_tamer.sql").read_text(encoding="utf-8")
    foundation = (ROOT / "supabase/schemas/00_foundation.sql").read_text(encoding="utf-8").lower()
    for route_id in ("monster_tamer.bootstrap", "monster_tamer.checkpoint", "monster_tamer.battle"):
        if route_id not in contract or route_id not in handler:
            raise SystemExit(f"Monster Tamer route is not end-to-end: {route_id}")
    if "create schema if not exists monster_tamer" not in foundation:
        raise SystemExit("The Monster Tamer schema must be declared in the foundation schema")
    required_database_terms = (
        "create table monster_tamer.player_progress",
        "create table monster_tamer.battles",
        "result_acknowledged_at",
        "v_command = 'acknowledge'",
        "api.monster_tamer_bootstrap",
        "api.monster_tamer_checkpoint",
        "api.monster_tamer_battle",
        "security definer",
        "set search_path = ''",
        "inventory.available_quantity",
    )
    lowered_schema = schema.lower()
    missing_database_terms = [
        term for term in required_database_terms if term not in lowered_schema
    ]
    if missing_database_terms:
        raise SystemExit(f"Monster Tamer database boundary is incomplete: {missing_database_terms}")
    if 'command: z.literal("acknowledge")' not in contract:
        raise SystemExit("Monster Tamer terminal battle acknowledgement is missing from the contract")

    product = (ROOT / "docs/product/功能说明文档.md").read_text(encoding="utf-8")
    boundary = "<!-- PRODUCT_DATA_CHECKSUM_BOUNDARY -->"
    chapter = "## 21. Monster Tamer 嵌入式游戏功能说明"
    if product.count(boundary) != 1 or product.count(chapter) != 1 or product.find(chapter) < product.find(boundary):
        raise SystemExit("Product chapter 21 must appear exactly once after the product-data checksum boundary")


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
    monster_tamer_adr = ROOT / "docs/architecture/adr/ADR-011-monster-tamer-embedded-game.md"
    required_monster_tamer_terms = (
        "登录后嵌入式游戏",
        "monster_tamer.bootstrap",
        "monster_tamer.checkpoint",
        "monster_tamer.battle",
        "Phaser",
        "inventory.available_quantity",
    )
    monster_tamer_documentation = monster_tamer_adr.read_text(encoding="utf-8")
    missing_monster_tamer_terms = [
        value for value in required_monster_tamer_terms if value not in monster_tamer_documentation
    ]
    if missing_monster_tamer_terms:
        raise SystemExit(f"Monster Tamer ADR is incomplete: {missing_monster_tamer_terms}")


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
