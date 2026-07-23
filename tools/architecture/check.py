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
STATIC_GAME_ROOT = ROOT / "apps/web/public/monster-tamer"
MONSTER_LAUNCHER_ROOT = WEB_ROOT / "domains/monster-tamer"
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
    "apps/web/src/workflows/payment-recovery",
    "apps/web/public/monster-tamer/index.html",
    "apps/web/public/monster-tamer/styles.css",
    "apps/web/public/monster-tamer/LICENSE",
    "apps/web/public/monster-tamer/THIRD_PARTY_NOTICES.md",
    "apps/web/public/monster-tamer/ORIGINAL_ASSET_PROVENANCE.md",
    "apps/web/public/monster-tamer/src/main.js",
    "apps/web/public/monster-tamer/src/utils/data-manager.js",
    "apps/web/public/monster-tamer/src/utils/touch-controls.js",
    "apps/web/public/monster-tamer/src/scenes/world-scene.js",
    "apps/web/public/monster-tamer/src/scenes/battle-scene.js",
    "apps/web/public/monster-tamer/src/scenes/monster-party-scene.js",
    "apps/web/public/monster-tamer/src/scenes/inventory-scene.js",
    "apps/web/public/monster-tamer/src/scenes/options-scene.js",
    "apps/web/public/monster-tamer/assets/data/monsters.json",
    "apps/web/public/monster-tamer/assets/data/encounters.json",
    "apps/web/public/monster-tamer/assets/data/items.json",
    "apps/web/public/monster-tamer/vendor/phaser-3.60.0.min.js",
    "apps/web/public/monster-tamer/vendor/webfontloader-1.6.28.min.js",
    "apps/web/public/monster-tamer/vendor/tweakpane-4.0.3.min.js",
    "apps/web/public/monster-tamer/vendor/licenses/PHASER-LICENSE.md",
    "apps/web/public/monster-tamer/vendor/licenses/WEBFONTLOADER-LICENSE",
    "apps/web/public/monster-tamer/vendor/licenses/TWEAKPANE-LICENSE.txt",
    "tools/monster-tamer/generate-original-assets.mjs",
    "docs/architecture/adr/ADR-011-monster-tamer-static-subapplication.md",
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
    launcher_files = typescript_files(MONSTER_LAUNCHER_ROOT)
    launcher_source = "\n".join(path.read_text(encoding="utf-8") for path in launcher_files)
    launcher_violations: list[str] = []
    allowed_packages = {"lucide-react", "react"}
    for source in launcher_files:
        for specifier in MODULE_IMPORT_PATTERN.findall(source.read_text(encoding="utf-8")):
            if specifier.startswith("."):
                target = (source.parent / specifier).resolve()
                if MONSTER_LAUNCHER_ROOT.resolve() not in (target, *target.parents):
                    launcher_violations.append(f"{relative(source)} imports outside the launcher boundary")
            elif specifier not in allowed_packages:
                launcher_violations.append(f"{relative(source)} imports forbidden package {specifier}")
    forbidden_launcher_references = (
        "@pokepets",
        "/api/",
        "apirequest(",
        "useapiquery(",
        "supabase",
        "initdata",
        "platform/",
        "session",
    )
    lowered_launcher = launcher_source.lower()
    for reference in forbidden_launcher_references:
        if reference in lowered_launcher:
            launcher_violations.append(f"launcher contains forbidden business reference {reference}")
    if launcher_source.count('href="/monster-tamer/"') != 1:
        launcher_violations.append("launcher must contain exactly one ordinary /monster-tamer/ link")
    if launcher_violations:
        raise SystemExit("Monster Tamer launcher boundary violations:\n" + "\n".join(sorted(launcher_violations)))

    static_files = [
        STATIC_GAME_ROOT / "index.html",
        STATIC_GAME_ROOT / "styles.css",
        *sorted((STATIC_GAME_ROOT / "src").rglob("*.js")),
    ]
    static_source = "\n".join(path.read_text(encoding="utf-8") for path in static_files)
    lowered_static = static_source.lower()
    forbidden_static_references = (
        "@pokepets",
        "/api/",
        "supabase",
        "initdata",
        "authorization",
        "idempotency-key",
        "/assets/catalog/",
        "access_token",
        "session_generation",
        "session_token",
        "finaltma",
        "fgems",
        "k-coin",
    )
    static_violations = [
        reference for reference in forbidden_static_references if reference in lowered_static
    ]
    if static_violations:
        raise SystemExit(f"Monster Tamer static source references FinalTMA business state: {static_violations}")
    network_primitives = ("fetch(", "xmlhttprequest", "websocket(", "navigator.sendbeacon")
    used_network_primitives = [value for value in network_primitives if value in lowered_static]
    if used_network_primitives:
        raise SystemExit(f"Monster Tamer static source performs network calls: {used_network_primitives}")

    data_manager_path = STATIC_GAME_ROOT / "src/utils/data-manager.js"
    data_manager = data_manager_path.read_text(encoding="utf-8")
    if data_manager.count("const LOCAL_STORAGE_KEY = 'MONSTER_TAMER_DATA';") != 1:
        raise SystemExit("Monster Tamer must define MONSTER_TAMER_DATA as its only storage key")
    required_storage_calls = (
        "localStorage.getItem(LOCAL_STORAGE_KEY)",
        "localStorage.setItem(LOCAL_STORAGE_KEY",
    )
    missing_storage_calls = [value for value in required_storage_calls if value not in data_manager]
    if missing_storage_calls:
        raise SystemExit(f"Monster Tamer local save contract is incomplete: {missing_storage_calls}")
    storage_owners = [
        path
        for path in static_files
        if "localStorage" in path.read_text(encoding="utf-8") and path != data_manager_path
    ]
    if storage_owners or any(value in static_source for value in ("sessionStorage", "document.cookie", "indexedDB")):
        raise SystemExit(
            f"Monster Tamer may persist only through its data manager: {[relative(path) for path in storage_owners]}"
        )

    index = (STATIC_GAME_ROOT / "index.html").read_text(encoding="utf-8")
    required_local_runtime = (
        '<base href="/monster-tamer/" />',
        'src="vendor/webfontloader-1.6.28.min.js"',
        'src="vendor/phaser-3.60.0.min.js"',
        'src="src/main.js"',
    )
    missing_runtime = [value for value in required_local_runtime if value not in index]
    tweakpane = (STATIC_GAME_ROOT / "src/lib/tweakpane.js").read_text(encoding="utf-8")
    if missing_runtime or "../../vendor/tweakpane-4.0.3.min.js" not in tweakpane:
        raise SystemExit(f"Monster Tamer local runtime references are incomplete: {missing_runtime}")
    notices = (STATIC_GAME_ROOT / "THIRD_PARTY_NOTICES.md").read_text(encoding="utf-8")
    provenance = (STATIC_GAME_ROOT / "ORIGINAL_ASSET_PROVENANCE.md").read_text(encoding="utf-8")
    release_blockers = ("unverified", "replacement required", "不可发布")
    present_blockers = [
        marker for marker in release_blockers if marker in f"{notices}\n{provenance}".lower()
    ]
    required_original_terms = (
        "Every file under `assets/images/monster-tamer/**` and `favicon.ico`",
        "generate-original-assets.mjs",
        "No uncleared upstream Monster Tamer raster remains",
    )
    missing_original_terms = [term for term in required_original_terms if term not in notices]
    if present_blockers or missing_original_terms:
        raise SystemExit(
            "Monster Tamer visual release evidence is incomplete: "
            f"blockers={present_blockers}, missing={missing_original_terms}"
        )
    preload = (STATIC_GAME_ROOT / "src/scenes/preload-scene.js").read_text(encoding="utf-8")
    required_music = (
        "And-the-Journey-Begins.mp3",
        "Decisive-Battle.mp3",
        "Title-Theme.mp3",
    )
    music_directory = STATIC_GAME_ROOT / "assets/audio/xDeviruchi"
    missing_music = [name for name in required_music if not (music_directory / name).is_file()]
    legacy_music = sorted(path.name for path in music_directory.glob("*.wav"))
    if any(name not in preload for name in required_music) or missing_music or legacy_music:
        raise SystemExit("Monster Tamer music must use the local mobile MP3 assets")
    external_documents = re.findall(r'(?:src|href)=["\'](https?://[^"\']+)["\']', index)
    if external_documents != ["https://telegram.org/js/telegram-web-app.js"]:
        raise SystemExit(f"Monster Tamer HTML has unexpected external runtime resources: {external_documents}")
    forbidden_cdns = ("cdn.jsdelivr.net", "cdnjs.cloudflare.com", "unpkg.com", "esm.sh")
    used_cdns = [value for value in forbidden_cdns if value in lowered_static]
    if used_cdns:
        raise SystemExit(f"Monster Tamer runtime dependencies must be local: {used_cdns}")

    game_page = GAME_PAGE.read_text(encoding="utf-8")
    expected_panels = ("MonsterTamerPanel", "ExpeditionPanel", "WheelPanel")
    stack = re.search(r'<div className="game-stack">(.*?)</div>', game_page, re.DOTALL)
    rendered_panels = tuple(re.findall(r"<([A-Z]\w*)\s*/>", stack.group(1))) if stack else ()
    if rendered_panels != expected_panels or any(game_page.count(panel) != 2 for panel in expected_panels):
        raise SystemExit("Game page must contain only MonsterTamerPanel, ExpeditionPanel, and WheelPanel in order")

    vercel = json.loads((ROOT / "vercel.json").read_text(encoding="utf-8"))
    rewrites = vercel.get("rewrites", [])
    expected_routes = {
        "/monster-tamer": "/monster-tamer/index.html",
        "/monster-tamer/": "/monster-tamer/index.html",
    }
    rewrite_sources = [rewrite.get("source") for rewrite in rewrites]
    for source, destination in expected_routes.items():
        matches = [index for index, rewrite in enumerate(rewrites) if rewrite.get("source") == source]
        if len(matches) != 1 or rewrites[matches[0]].get("destination") != destination:
            raise SystemExit(f"Vercel must rewrite {source} exactly once to {destination}")
    catch_all = [index for index, source in enumerate(rewrite_sources) if source == "/((?!api/).*)"]
    route_positions = [rewrite_sources.index(source) for source in expected_routes]
    if len(catch_all) != 1 or not all(position < catch_all[0] for position in route_positions):
        raise SystemExit("Monster Tamer rewrites must appear before the Web SPA catch-all")

    product = (ROOT / "docs/product/功能说明文档.md").read_text(encoding="utf-8")
    boundary = "<!-- PRODUCT_DATA_CHECKSUM_BOUNDARY -->"
    chapter = "## 21. Monster Tamer 独立游戏功能说明"
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
    monster_tamer_adr = ROOT / "docs/architecture/adr/ADR-011-monster-tamer-static-subapplication.md"
    required_monster_tamer_terms = (
        "/monster-tamer/",
        "MONSTER_TAMER_DATA",
        "MonsterTamerPanel → ExpeditionPanel → WheelPanel",
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
