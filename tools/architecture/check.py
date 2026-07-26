#!/usr/bin/env python3
"""Enforce repository module ownership and gateway isolation."""

from __future__ import annotations

import hashlib
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
    "apps/web/public/monster-tamer/src/bridge.js",
    "apps/web/public/monster-tamer/src/scenes/pet-home-scene.js",
    "apps/web/public/monster-tamer/assets/data/main_1.json",
    "apps/web/public/monster-tamer/assets/images/tiny-swords/tiny-swords-terrain-extruded.png",
    "apps/web/public/monster-tamer/assets/licenses/tiny-swords/SOURCE.json",
    "apps/web/public/monster-tamer/assets/licenses/tiny-swords/TERMS.md",
    "apps/web/public/monster-tamer/src/assets/tiny-swords-world.js",
    "assets/source/monster-tamer/tiny-swords/free-pack-2026-07-25/SOURCE.json",
    "assets/source/monster-tamer/tiny-swords/free-pack-2026-07-25/TERMS.md",
    "apps/web/public/monster-tamer/vendor/phaser-3.60.0.min.js",
    "apps/web/public/monster-tamer/vendor/licenses/PHASER-LICENSE.md",
    "tools/monster-tamer/generate-island-map.mjs",
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
    required_paths = (
        STATIC_GAME_ROOT / "index.html",
        STATIC_GAME_ROOT / "styles.css",
        STATIC_GAME_ROOT / "src/main.js",
        STATIC_GAME_ROOT / "src/bridge.js",
        STATIC_GAME_ROOT / "src/lib/phaser.js",
        STATIC_GAME_ROOT / "src/scenes/pet-home-scene.js",
        STATIC_GAME_ROOT / "src/assets/tiny-swords-world.js",
        STATIC_GAME_ROOT / "assets/data/main_1.json",
        STATIC_GAME_ROOT / "vendor/phaser-3.60.0.min.js",
        STATIC_GAME_ROOT / "vendor/licenses/PHASER-LICENSE.md",
        STATIC_GAME_ROOT / "THIRD_PARTY_NOTICES.md",
        STATIC_GAME_ROOT / "ORIGINAL_ASSET_PROVENANCE.md",
        ROOT / "tools/monster-tamer/generate-island-map.mjs",
    )
    missing = [relative(path) for path in required_paths if not path.is_file()]
    if missing:
        raise SystemExit(f"Monster Tamer home files are missing: {missing}")

    retired_paths = (
        "assets/audio",
        "assets/fonts",
        "assets/images/axulart",
        "assets/images/kenneys-assets",
        "assets/images/monster-tamer",
        "assets/images/parabellum-games",
        "assets/images/pimen",
        "src/battle",
        "src/common",
        "src/party",
        "src/types",
        "src/utils",
        "src/world",
        "src/scenes/battle-scene.js",
        "src/scenes/world-scene.js",
        "src/scenes/inventory-scene.js",
        "src/scenes/monster-party-scene.js",
        "src/scenes/dialog-scene.js",
        "vendor/tweakpane-4.0.3.min.js",
        "vendor/webfontloader-1.6.28.min.js",
    )
    present_retired = [
        path for path in retired_paths if (STATIC_GAME_ROOT / path).exists()
    ]
    legacy_data = sorted(
        path.name
        for path in (STATIC_GAME_ROOT / "assets/data").glob("*.json")
        if path.name != "main_1.json"
    )
    if present_retired or legacy_data:
        raise SystemExit(
            "Retired Monster Tamer exploration/battle files remain: "
            f"paths={present_retired}, data={legacy_data}"
        )

    launcher_files = typescript_files(MONSTER_LAUNCHER_ROOT)
    launcher_source = "\n".join(
        path.read_text(encoding="utf-8") for path in launcher_files
    )
    required_launcher_terms = (
        'useApiQuery("inventory.list")',
        ".filter((item) => item.available > 0)",
        "new Map(",
        'src="/monster-tamer/?embedded=1"',
        'sandbox="allow-scripts allow-same-origin"',
        'event.origin !== window.location.origin',
        'event.source !== iframe.current?.contentWindow',
        "createPortal(",
        "CollectionDetailShowcase",
        "resumeFrame(",
    )
    missing_launcher_terms = [
        value for value in required_launcher_terms if value not in launcher_source
    ]
    forbidden_launcher_terms = (
        'href="/monster-tamer/"',
        "apiRequest(",
        "supabase",
        ".slice(",
        "localStorage",
        "sessionStorage",
    )
    present_launcher_terms = [
        value for value in forbidden_launcher_terms if value in launcher_source
    ]
    if missing_launcher_terms or present_launcher_terms:
        raise SystemExit(
            "Monster Tamer authenticated launcher contract is incomplete: "
            f"missing={missing_launcher_terms}, forbidden={present_launcher_terms}"
        )

    static_files = [
        STATIC_GAME_ROOT / "index.html",
        STATIC_GAME_ROOT / "styles.css",
        *sorted((STATIC_GAME_ROOT / "src").rglob("*.js")),
    ]
    static_source = "\n".join(
        path.read_text(encoding="utf-8") for path in static_files
    )
    lowered_static = static_source.lower()
    forbidden_static_terms = (
        "/api/",
        "supabase",
        "initdata",
        "authorization",
        "idempotency-key",
        "access_token",
        "session_generation",
        "localstorage",
        "sessionstorage",
        "indexeddb",
        "document.cookie",
        "fetch(",
        "xmlhttprequest",
        "websocket(",
        "navigator.sendbeacon",
        "battle",
        "encounter",
        "capture",
    )
    present_static_terms = [
        value for value in forbidden_static_terms if value in lowered_static
    ]
    required_static_terms = (
        'event.origin !== window.location.origin',
        "event.source !== window.parent",
        "/assets/catalog/v1/thumb/",
        "this.scene.pause()",
        'game?.scene.resume("PET_HOME")',
        "this.reserved.add(targetKey)",
        "this.occupied.add(targetKey)",
        "configureCameraInput()",
    )
    missing_static_terms = [
        value for value in required_static_terms if value not in static_source
    ]
    if present_static_terms or missing_static_terms:
        raise SystemExit(
            "Monster Tamer renderer boundary is incomplete: "
            f"forbidden={present_static_terms}, missing={missing_static_terms}"
        )

    index = (STATIC_GAME_ROOT / "index.html").read_text(encoding="utf-8")
    for value in (
        '<base href="/monster-tamer/" />',
        'src="vendor/phaser-3.60.0.min.js"',
        'src="src/main.js"',
        "请从 FinalTMA 游戏中心进入",
    ):
        if value not in index:
            raise SystemExit(f"Monster Tamer index is missing {value}")
    external_documents = re.findall(
        r'(?:src|href)=["\'](https?://[^"\']+)["\']', index
    )
    if external_documents:
        raise SystemExit(
            f"Monster Tamer renderer has external resources: {external_documents}"
        )

    game_page = GAME_PAGE.read_text(encoding="utf-8")
    expected_panels = ("MonsterTamerPanel", "ExpeditionPanel", "WheelPanel")
    stack = re.search(
        r'<div className="game-stack">(.*?)</div>', game_page, re.DOTALL
    )
    rendered_panels = (
        tuple(re.findall(r"<([A-Z]\w*)\s*/>", stack.group(1))) if stack else ()
    )
    if rendered_panels != expected_panels:
        raise SystemExit(
            "Game page must render Monster Tamer, Expedition, and Wheel in order"
        )

    vercel = json.loads((ROOT / "vercel.json").read_text(encoding="utf-8"))
    rewrites = vercel.get("rewrites", [])
    rewrite_sources = [rewrite.get("source") for rewrite in rewrites]
    expected_routes = {
        "/monster-tamer": "/monster-tamer/index.html",
        "/monster-tamer/": "/monster-tamer/index.html",
    }
    for source, destination in expected_routes.items():
        matches = [
            index
            for index, rewrite in enumerate(rewrites)
            if rewrite.get("source") == source
            and rewrite.get("destination") == destination
        ]
        if len(matches) != 1:
            raise SystemExit(
                f"Vercel must rewrite {source} once to {destination}"
            )
    catch_all = [
        index
        for index, source in enumerate(rewrite_sources)
        if source == "/((?!api/).*)"
    ]
    if len(catch_all) != 1 or any(
        rewrite_sources.index(source) > catch_all[0] for source in expected_routes
    ):
        raise SystemExit(
            "Monster Tamer renderer rewrites must precede the SPA catch-all"
        )

    verify_monster_tamer_assets()
    verify_monster_tamer_map()

    product = (ROOT / "docs/product/功能说明文档.md").read_text(
        encoding="utf-8"
    )
    boundary = "<!-- PRODUCT_DATA_CHECKSUM_BOUNDARY -->"
    chapter = "## 21. Monster Tamer 藏品展示家园功能说明"
    if (
        product.count(boundary) != 1
        or product.count(chapter) != 1
        or product.find(chapter) < product.find(boundary)
    ):
        raise SystemExit(
            "Product chapter 21 must appear once after the checksum boundary"
        )
    chapter_text = product[product.index(chapter) :]
    required_decisions = (
        "50 × 50",
        "最外侧两格",
        "`available > 0`",
        "同一模板无论拥有多少只，地图上只显示一只",
        "不设置展示总数上限",
        "现有藏品详情视觉组件",
        "旧玩家、NPC、对话、告示牌、探索、遭遇、战斗",
    )
    missing_decisions = [
        value for value in required_decisions if value not in chapter_text
    ]
    if missing_decisions:
        raise SystemExit(
            f"Product chapter 21 is missing home decisions: {missing_decisions}"
        )


def verify_monster_tamer_assets() -> None:
    source_root = (
        ROOT
        / "assets/source/monster-tamer/tiny-swords/free-pack-2026-07-25"
    )
    manifest = json.loads((source_root / "SOURCE.json").read_text(encoding="utf-8"))
    definitions = [
        entry for entry in manifest.get("files", []) if isinstance(entry, dict)
    ]
    actual_source_paths = {
        path.relative_to(source_root).as_posix()
        for path in source_root.rglob("*.png")
    }
    recorded_source_paths = {
        str(entry.get("path")) for entry in definitions
    }
    violations: list[str] = []
    if (
        manifest.get("project") != "Tiny Swords (Free Pack)"
        or len(definitions) != 32
        or actual_source_paths != recorded_source_paths
    ):
        violations.append(
            "Tiny Swords source selection must contain exactly 32 recorded PNG files"
        )
    for definition in definitions:
        source_path = source_root / str(definition.get("path"))
        header = source_path.read_bytes()[:24]
        dimensions = (
            int.from_bytes(header[16:20], "big"),
            int.from_bytes(header[20:24], "big"),
        )
        digest = hashlib.sha256(source_path.read_bytes()).hexdigest()
        if dimensions != (
            definition.get("width"),
            definition.get("height"),
        ) or digest != definition.get("sha256"):
            violations.append(
                f"{relative(source_path)} differs from its recorded source evidence"
            )

    runtime_root = STATIC_GAME_ROOT / "assets/images/tiny-swords"
    expected_runtime = {
        "tiny-swords-terrain-extruded.png",
        "buildings/archery.png",
        "buildings/barracks.png",
        "buildings/castle.png",
        "buildings/house-1.png",
        "buildings/house-2.png",
        "buildings/house-3.png",
        "buildings/monastery.png",
        "buildings/tower.png",
        *{f"environment/bush-{value}.png" for value in range(1, 5)},
        *{f"environment/rock-{value}.png" for value in range(1, 5)},
        *{f"environment/stump-{value}.png" for value in range(1, 5)},
        *{f"environment/tree-{value}.png" for value in range(1, 5)},
        *{f"environment/water-rock-{value}.png" for value in range(1, 5)},
        "environment/shadow.png",
        "environment/water-foam.png",
    }
    actual_runtime = {
        path.relative_to(runtime_root).as_posix()
        for path in runtime_root.rglob("*.png")
    }
    if actual_runtime != expected_runtime:
        violations.append(
            "Runtime Tiny Swords files differ from the 31-file generated set: "
            f"{sorted(actual_runtime ^ expected_runtime)}"
        )
    atlas = runtime_root / "tiny-swords-terrain-extruded.png"
    atlas_header = atlas.read_bytes()[:24]
    atlas_dimensions = (
        int.from_bytes(atlas_header[16:20], "big"),
        int.from_bytes(atlas_header[20:24], "big"),
    )
    if atlas_dimensions != (528, 528):
        violations.append("Tiny Swords runtime atlas must remain 528x528")
    for published_name in ("SOURCE.json", "TERMS.md"):
        published = (
            STATIC_GAME_ROOT / "assets/licenses/tiny-swords" / published_name
        )
        source = source_root / published_name
        if published.read_bytes() != source.read_bytes():
            violations.append(
                f"{relative(published)} must match the checked source evidence"
            )
    notices = (STATIC_GAME_ROOT / "THIRD_PARTY_NOTICES.md").read_text(
        encoding="utf-8"
    )
    for term in (
        "Phaser 3.60.0",
        "Tiny Swords free-pack map art",
        "Pixel Frog",
        "32-file selection",
        "FinalTMA Catalog v1",
    ):
        if term not in notices:
            violations.append(f"Third-party notices are missing {term}")
    if violations:
        raise SystemExit(
            "Monster Tamer asset contract violations:\n"
            + "\n".join(violations)
        )


def verify_monster_tamer_map() -> None:
    map_data = json.loads(
        (STATIC_GAME_ROOT / "assets/data/main_1.json").read_text(
            encoding="utf-8"
        )
    )
    expected_geometry = {
        "width": 50,
        "height": 50,
        "tilewidth": 64,
        "tileheight": 64,
    }
    actual_geometry = {
        name: map_data.get(name) for name in expected_geometry
    }
    if actual_geometry != expected_geometry:
        raise SystemExit(
            f"Monster Tamer map geometry mismatch: {actual_geometry}"
        )
    layers = {
        str(layer.get("name")): layer for layer in map_data.get("layers", [])
    }
    expected_layers = {
        "Water-Scenery": "objectgroup",
        "Flat-Ground": "tilelayer",
        "Scenery": "objectgroup",
        "Collision": "tilelayer",
    }
    actual_layers = {
        name: layer.get("type") for name, layer in layers.items()
    }
    if actual_layers != expected_layers:
        raise SystemExit(
            f"Monster Tamer map layer mismatch: {actual_layers}"
        )
    ground = layers["Flat-Ground"].get("data", [])
    collision = layers["Collision"].get("data", [])
    if len(ground) != 2500 or len(collision) != 2500:
        raise SystemExit("Monster Tamer tile layers must contain 2500 cells")
    for y in range(50):
        for x in range(50):
            if x < 2 or y < 2 or x >= 48 or y >= 48:
                index = y * 50 + x
                if ground[index] != 0 or collision[index] != 1:
                    raise SystemExit(
                        "Monster Tamer outer two-tile water ring is broken at "
                        f"({x}, {y})"
                    )
    walkable = {index for index, blocked in enumerate(collision) if blocked == 0}
    if len(walkable) < 210:
        raise SystemExit(
            f"Monster Tamer requires at least 210 walkable cells, found {len(walkable)}"
        )
    reachable = {next(iter(walkable))}
    queue = list(reachable)
    for index in queue:
        x, y = index % 50, index // 50
        for next_x, next_y in (
            (x - 1, y),
            (x + 1, y),
            (x, y - 1),
            (x, y + 1),
        ):
            next_index = next_y * 50 + next_x
            if (
                0 <= next_x < 50
                and 0 <= next_y < 50
                and next_index in walkable
                and next_index not in reachable
            ):
                reachable.add(next_index)
                queue.append(next_index)
    if reachable != walkable:
        raise SystemExit(
            f"Monster Tamer walkable island is disconnected: {len(reachable)}/{len(walkable)}"
        )
    allowed_assets = {
        "archery",
        "barracks",
        "castle",
        "house-1",
        "house-2",
        "house-3",
        "monastery",
        "tower",
        *{f"bush-{value}" for value in range(1, 5)},
        *{f"rock-{value}" for value in range(1, 5)},
        *{f"stump-{value}" for value in range(1, 5)},
        *{f"tree-{value}" for value in range(1, 5)},
        *{f"water-rock-{value}" for value in range(1, 5)},
        "water-foam",
    }
    for layer_name in ("Water-Scenery", "Scenery"):
        for entry in layers[layer_name].get("objects", []):
            if entry.get("name") not in allowed_assets:
                raise SystemExit(
                    f"Monster Tamer map references forbidden scenery {entry.get('name')}"
                )
            tile_x = int(float(entry.get("x", 0)) // 64)
            tile_y = int(float(entry.get("y", 0)) // 64) - 1
            if tile_x < 2 or tile_y < 2 or tile_x >= 48 or tile_y >= 48:
                raise SystemExit(
                    f"Monster Tamer scenery enters the outer water ring at ({tile_x}, {tile_y})"
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
        "MonsterTamerPanel → ExpeditionPanel → WheelPanel",
        "50×50",
        "两格连续水域",
        "inventory.list",
        "available > 0",
        "一种只显示一只",
        "Tilemap_color1",
        "Blue Buildings",
        "#47ABA9",
        "现有藏品详情",
        "探索与战斗",
        "不使用浏览器持久化",
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
