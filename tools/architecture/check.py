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
    "apps/web/public/monster-tamer/src/utils/controls.js",
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
    "apps/web/public/monster-tamer/assets/data/main_1.json",
    "apps/web/public/monster-tamer/assets/images/tiny-swords/tiny-swords-terrain-extruded.png",
    "apps/web/public/monster-tamer/assets/licenses/tiny-swords/SOURCE.json",
    "apps/web/public/monster-tamer/assets/licenses/tiny-swords/TERMS.md",
    "apps/web/public/monster-tamer/src/assets/tiny-swords-world.js",
    "assets/source/monster-tamer/tiny-swords/free-pack-2026-07-25/SOURCE.json",
    "assets/source/monster-tamer/tiny-swords/free-pack-2026-07-25/TERMS.md",
    "apps/web/public/monster-tamer/vendor/phaser-3.60.0.min.js",
    "apps/web/public/monster-tamer/vendor/webfontloader-1.6.28.min.js",
    "apps/web/public/monster-tamer/vendor/tweakpane-4.0.3.min.js",
    "apps/web/public/monster-tamer/vendor/licenses/PHASER-LICENSE.md",
    "apps/web/public/monster-tamer/vendor/licenses/WEBFONTLOADER-LICENSE",
    "apps/web/public/monster-tamer/vendor/licenses/TWEAKPANE-LICENSE.txt",
    "tools/monster-tamer/generate-original-assets.mjs",
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
    required_world_migration = (
        "const WORLD_VERSION = 4;",
        "const migratedFromPreviousWorld = savedWorldVersion < WORLD_VERSION;",
        "if (savedWorldVersion > WORLD_VERSION)",
        "parsedData.player.position = { ...WORLD_SPAWN_POSITION };",
        "parsedData.player.direction = DIRECTION.DOWN;",
        "area: 'main_1'",
        "if (migratedFromPreviousWorld) {\n        this.saveData();",
    )
    missing_world_migration = [
        value for value in required_world_migration if value not in data_manager
    ]
    if missing_world_migration:
        raise SystemExit(
            f"Monster Tamer retired-map save migration is incomplete: {missing_world_migration}"
        )
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
    tiny_swords_evidence = (
        "Tiny Swords free-pack map art",
        "Pixel Frog",
        "https://pixelfrog-assets.itch.io/tiny-swords",
        "Tilemap_color1",
        "Blue Buildings",
        "#47ABA9",
        "assets/images/tiny-swords/tiny-swords-terrain-extruded.png",
        "assets/licenses/tiny-swords/SOURCE.json",
        "assets/licenses/tiny-swords/TERMS.md",
        "32 selected source PNG files",
    )
    missing_tiny_swords_evidence = [
        term for term in tiny_swords_evidence if term not in notices
    ]
    stale_original_claims = (
        "Every file under `assets/images/monster-tamer/**` and `favicon.ico`",
        "world and interior backgrounds and foregrounds",
        "The generated maps use only the fixed gameplay JSON",
    )
    present_stale_claims = [
        term for term in stale_original_claims if term in f"{notices}\n{provenance}"
    ]
    if present_blockers or missing_tiny_swords_evidence or present_stale_claims:
        raise SystemExit(
            "Monster Tamer visual release evidence is incomplete: "
            f"blockers={present_blockers}, missing_tiny_swords={missing_tiny_swords_evidence}, "
            f"stale_original_claims={present_stale_claims}"
        )
    verify_monster_tamer_tiny_swords_assets()
    verify_monster_tamer_map()

    controls = (STATIC_GAME_ROOT / "src/utils/controls.js").read_text(encoding="utf-8")
    required_desktop_movement = ("KeyCodes.W", "KeyCodes.A", "KeyCodes.S", "KeyCodes.D")
    missing_desktop_movement = [
        value for value in required_desktop_movement if value not in controls
    ]
    if missing_desktop_movement:
        raise SystemExit(
            f"Monster Tamer desktop movement must support WASD: {missing_desktop_movement}"
        )
    required_joystick_markup = ('id="movement-joystick"', 'class="movement-joystick-knob"')
    missing_joystick_markup = [value for value in required_joystick_markup if value not in index]
    if missing_joystick_markup:
        raise SystemExit(
            f"Monster Tamer mobile joystick markup is incomplete: {missing_joystick_markup}"
        )
    world_scene = (STATIC_GAME_ROOT / "src/scenes/world-scene.js").read_text(encoding="utf-8")
    retired_world_behaviors = (
        "movementTarget",
        "Scene-Transitions",
        "handleWorldPointer",
        "PLAYER_ENTRANCE",
    )
    present_retired_behaviors = [
        value for value in retired_world_behaviors if value in world_scene
    ]
    required_world_camera = (
        "startFollow(this.#player.sprite, true, WORLD_CAMERA_LERP, WORLD_CAMERA_LERP)",
        "setBounds(0, 0, map.widthInPixels, map.heightInPixels)",
        "#movePlayerFromDirections",
        "orderedDirections.some",
        "#secondaryMovementProgress",
        "releaseWorldMovement()",
    )
    missing_world_camera = [value for value in required_world_camera if value not in world_scene]
    if present_retired_behaviors or missing_world_camera:
        raise SystemExit(
            "Monster Tamer world movement/camera contract is incomplete: "
            f"retired={present_retired_behaviors}, missing_camera={missing_world_camera}"
        )
    if "orderedDirections.pop()" in controls:
        raise SystemExit("Monster Tamer joystick collision sliding must retain its secondary axis")
    character = (
        STATIC_GAME_ROOT / "src/world/characters/character.js"
    ).read_text(encoding="utf-8")
    if "setFrame(this._getIdleFrame())" not in character:
        raise SystemExit("Monster Tamer blocked movement must use the current direction's idle frame")
    game_config = (STATIC_GAME_ROOT / "src/config.js").read_text(encoding="utf-8")
    required_world_tuning = (
        "export const PLAYER_WALK_DURATION = 400;",
        "export const PLAYER_RUN_DURATION = 220;",
        "export const WORLD_CAMERA_LERP = 0.16;",
    )
    missing_world_tuning = [value for value in required_world_tuning if value not in game_config]
    if missing_world_tuning:
        raise SystemExit(
            f"Monster Tamer world movement tuning is incomplete: {missing_world_tuning}"
        )
    preload = (STATIC_GAME_ROOT / "src/scenes/preload-scene.js").read_text(encoding="utf-8")
    if (
        preload.count("tilemapTiledJSON(") != 1
        or "tilemapTiledJSON(WORLD_ASSET_KEYS.MAIN_1_LEVEL, `assets/data/main_1.json`)" not in preload
    ):
        raise SystemExit("Monster Tamer runtime must preload main_1 as its only world tilemap")
    compact_atlas_path = "assets/images/tiny-swords/tiny-swords-terrain-extruded.png"
    if (
        preload.count(compact_atlas_path) != 1
        or world_scene.count(
            "map.addTilesetImage('tiny-swords-terrain', WORLD_ASSET_KEYS.TINY_SWORDS_TERRAIN)"
        )
        != 1
    ):
        raise SystemExit(
            "Monster Tamer runtime must load and bind the compact Tiny Swords atlas exactly once"
        )
    retired_preload_assets = (
        "forest_1",
        "building_1",
        "building_2",
        "building_3",
        "level_background",
        "level_foreground",
        "kenney-tiny",
        "tiny-town",
        "tiny-farm",
        "tiny-battle",
    )
    present_retired_preload_assets = [
        value for value in retired_preload_assets if value in preload
    ]
    if present_retired_preload_assets:
        raise SystemExit(
            f"Monster Tamer preload still references retired maps: {present_retired_preload_assets}"
        )
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
    chapter_text = product[product.index(chapter) :]
    required_map_decisions = (
        "120 × 64",
        "36.8 秒",
        "Tilemap_color1",
        "Blue Buildings",
        "#47ABA9",
        "WASD",
        "虚拟摇杆",
        "MONSTER_TAMER_DATA",
        "不新增采集系统、NPC、怪物",
    )
    missing_map_decisions = [
        value for value in required_map_decisions if value not in chapter_text
    ]
    if missing_map_decisions:
        raise SystemExit(
            f"Product chapter 21 is missing settled valley-map decisions: {missing_map_decisions}"
        )


def verify_monster_tamer_tiny_swords_assets() -> None:
    source_root = (
        ROOT
        / "assets/source/monster-tamer/tiny-swords/free-pack-2026-07-25"
    )
    manifest_path = source_root / "SOURCE.json"
    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    expected_source_paths = {
        "Buildings/Blue Buildings/Archery.png",
        "Buildings/Blue Buildings/Barracks.png",
        "Buildings/Blue Buildings/Castle.png",
        "Buildings/Blue Buildings/House1.png",
        "Buildings/Blue Buildings/House2.png",
        "Buildings/Blue Buildings/House3.png",
        "Buildings/Blue Buildings/Monastery.png",
        "Buildings/Blue Buildings/Tower.png",
        "Terrain/Decorations/Bushes/Bushe1.png",
        "Terrain/Decorations/Bushes/Bushe2.png",
        "Terrain/Decorations/Bushes/Bushe3.png",
        "Terrain/Decorations/Bushes/Bushe4.png",
        "Terrain/Decorations/Rocks in the Water/Water Rocks_01.png",
        "Terrain/Decorations/Rocks in the Water/Water Rocks_02.png",
        "Terrain/Decorations/Rocks in the Water/Water Rocks_03.png",
        "Terrain/Decorations/Rocks in the Water/Water Rocks_04.png",
        "Terrain/Decorations/Rocks/Rock1.png",
        "Terrain/Decorations/Rocks/Rock2.png",
        "Terrain/Decorations/Rocks/Rock3.png",
        "Terrain/Decorations/Rocks/Rock4.png",
        "Terrain/Resources/Wood/Trees/Stump 1.png",
        "Terrain/Resources/Wood/Trees/Stump 2.png",
        "Terrain/Resources/Wood/Trees/Stump 3.png",
        "Terrain/Resources/Wood/Trees/Stump 4.png",
        "Terrain/Resources/Wood/Trees/Tree1.png",
        "Terrain/Resources/Wood/Trees/Tree2.png",
        "Terrain/Resources/Wood/Trees/Tree3.png",
        "Terrain/Resources/Wood/Trees/Tree4.png",
        "Terrain/Tileset/Shadow.png",
        "Terrain/Tileset/Tilemap_color1.png",
        "Terrain/Tileset/Water Background color.png",
        "Terrain/Tileset/Water Foam.png",
    }
    runtime_copies = {
        "Buildings/Blue Buildings/Archery.png": "buildings/archery.png",
        "Buildings/Blue Buildings/Barracks.png": "buildings/barracks.png",
        "Buildings/Blue Buildings/Castle.png": "buildings/castle.png",
        "Buildings/Blue Buildings/House1.png": "buildings/house-1.png",
        "Buildings/Blue Buildings/House2.png": "buildings/house-2.png",
        "Buildings/Blue Buildings/House3.png": "buildings/house-3.png",
        "Buildings/Blue Buildings/Monastery.png": "buildings/monastery.png",
        "Buildings/Blue Buildings/Tower.png": "buildings/tower.png",
        "Terrain/Decorations/Bushes/Bushe1.png": "environment/bush-1.png",
        "Terrain/Decorations/Bushes/Bushe2.png": "environment/bush-2.png",
        "Terrain/Decorations/Bushes/Bushe3.png": "environment/bush-3.png",
        "Terrain/Decorations/Bushes/Bushe4.png": "environment/bush-4.png",
        "Terrain/Decorations/Rocks in the Water/Water Rocks_01.png": "environment/water-rock-1.png",
        "Terrain/Decorations/Rocks in the Water/Water Rocks_02.png": "environment/water-rock-2.png",
        "Terrain/Decorations/Rocks in the Water/Water Rocks_03.png": "environment/water-rock-3.png",
        "Terrain/Decorations/Rocks in the Water/Water Rocks_04.png": "environment/water-rock-4.png",
        "Terrain/Decorations/Rocks/Rock1.png": "environment/rock-1.png",
        "Terrain/Decorations/Rocks/Rock2.png": "environment/rock-2.png",
        "Terrain/Decorations/Rocks/Rock3.png": "environment/rock-3.png",
        "Terrain/Decorations/Rocks/Rock4.png": "environment/rock-4.png",
        "Terrain/Resources/Wood/Trees/Stump 1.png": "environment/stump-1.png",
        "Terrain/Resources/Wood/Trees/Stump 2.png": "environment/stump-2.png",
        "Terrain/Resources/Wood/Trees/Stump 3.png": "environment/stump-3.png",
        "Terrain/Resources/Wood/Trees/Stump 4.png": "environment/stump-4.png",
        "Terrain/Resources/Wood/Trees/Tree1.png": "environment/tree-1.png",
        "Terrain/Resources/Wood/Trees/Tree2.png": "environment/tree-2.png",
        "Terrain/Resources/Wood/Trees/Tree3.png": "environment/tree-3.png",
        "Terrain/Resources/Wood/Trees/Tree4.png": "environment/tree-4.png",
        "Terrain/Tileset/Shadow.png": "environment/shadow.png",
        "Terrain/Tileset/Water Foam.png": "environment/water-foam.png",
    }
    violations: list[str] = []
    definitions = {
        entry.get("path"): entry
        for entry in manifest.get("files", [])
        if isinstance(entry, dict)
    }
    actual_source_paths = {
        path.relative_to(source_root).as_posix()
        for path in source_root.rglob("*.png")
    }
    if (
        manifest.get("project") != "Tiny Swords (Free Pack)"
        or set(definitions) != expected_source_paths
        or actual_source_paths != expected_source_paths
    ):
        violations.append(
            "Tiny Swords source selection must contain exactly the 32 approved PNG files"
        )
    for source_name, definition in definitions.items():
        source_path = source_root / str(source_name)
        dimensions = png_dimensions(source_path)
        expected_dimensions = (definition.get("width"), definition.get("height"))
        actual_hash = hashlib.sha256(source_path.read_bytes()).hexdigest()
        if dimensions != expected_dimensions or actual_hash != definition.get("sha256"):
            violations.append(
                f"{relative(source_path)} does not match its recorded dimensions/SHA-256"
            )

    runtime_root = STATIC_GAME_ROOT / "assets/images/tiny-swords"
    runtime_atlas = runtime_root / "tiny-swords-terrain-extruded.png"
    if png_dimensions(runtime_atlas) != (528, 528):
        violations.append(
            "assets/images/tiny-swords/tiny-swords-terrain-extruded.png must be 528x528"
        )
    expected_runtime_pngs = {
        "tiny-swords-terrain-extruded.png",
        *runtime_copies.values(),
    }
    actual_runtime_pngs = {
        path.relative_to(runtime_root).as_posix()
        for path in runtime_root.rglob("*.png")
    }
    if actual_runtime_pngs != expected_runtime_pngs:
        violations.append(
            "Monster Tamer runtime Tiny Swords PNG set differs from the approved whitelist: "
            f"{sorted(actual_runtime_pngs ^ expected_runtime_pngs)}"
        )
    for source_name, runtime_name in runtime_copies.items():
        source_path = source_root / source_name
        runtime_path = runtime_root / runtime_name
        if runtime_path.read_bytes() != source_path.read_bytes():
            violations.append(
                f"{relative(runtime_path)} must be an exact runtime copy of {relative(source_path)}"
            )

    public_license_root = STATIC_GAME_ROOT / "assets/licenses/tiny-swords"
    for published_name in ("SOURCE.json", "TERMS.md"):
        published = public_license_root / published_name
        source = source_root / published_name
        if published.read_bytes() != source.read_bytes():
            violations.append(
                f"{relative(published)} must be an exact copy of {relative(source)}"
            )

    retired_roots = (
        STATIC_GAME_ROOT / "assets/images/tuxemon",
        STATIC_GAME_ROOT / "assets/licenses/tuxemon",
        ROOT / "assets/source/monster-tamer/tuxemon",
        STATIC_GAME_ROOT / "assets/images/kenney-tiny",
        STATIC_GAME_ROOT / "assets/licenses/kenney-tiny",
        ROOT / "assets/source/monster-tamer/kenney-tiny",
    )
    present_retired_roots = [
        relative(path) for path in retired_roots if path.exists()
    ]
    if present_retired_roots:
        violations.append(
            f"Retired Monster Tamer map-art roots remain: {present_retired_roots}"
        )
    if violations:
        raise SystemExit(
            "Monster Tamer Tiny Swords asset contract violations:\n"
            + "\n".join(violations)
        )


def verify_monster_tamer_map() -> None:
    data_root = STATIC_GAME_ROOT / "assets/data"
    legacy_json_names = (
        "building_1.json",
        "building_2.json",
        "building_3.json",
        "forest_1.json",
        "level.json",
        "level_old.json",
    )
    legacy_json = [name for name in legacy_json_names if (data_root / name).exists()]
    map_art_root = STATIC_GAME_ROOT / "assets/images/monster-tamer/map"
    legacy_map_art = (
        [
            relative(path)
            for path in map_art_root.rglob("*.png")
            if path.name.endswith(("_level_background.png", "_level_foreground.png"))
            or path.name in {"level_background.png", "level_foreground.png"}
        ]
        if map_art_root.exists()
        else []
    )
    if legacy_json or legacy_map_art:
        raise SystemExit(
            "Monster Tamer legacy maps must remain deleted: "
            f"json={legacy_json}, raster={legacy_map_art}"
        )

    map_path = data_root / "main_1.json"
    map_data = json.loads(map_path.read_text(encoding="utf-8"))
    expected_geometry = {"width": 120, "height": 64, "tilewidth": 64, "tileheight": 64}
    actual_geometry = {name: map_data.get(name) for name in expected_geometry}
    if actual_geometry != expected_geometry:
        raise SystemExit(
            f"Monster Tamer main_1 geometry mismatch: expected {expected_geometry}, found {actual_geometry}"
        )

    expected_tilesets = {"tiny-swords-terrain", "collision", "encounter"}
    tilesets = {entry.get("name"): entry for entry in map_data.get("tilesets", [])}
    if len(map_data.get("tilesets", [])) != len(expected_tilesets) or set(tilesets) != expected_tilesets:
        raise SystemExit(
            f"Monster Tamer main_1 tilesets mismatch: expected {sorted(expected_tilesets)}, "
            f"found {sorted(str(name) for name in tilesets)}"
        )
    expected_tiny_swords_tileset = {
        "columns": 8,
        "firstgid": 1,
        "image": "../images/tiny-swords/tiny-swords-terrain-extruded.png",
        "imageheight": 528,
        "imagewidth": 528,
        "margin": 1,
        "name": "tiny-swords-terrain",
        "spacing": 2,
        "tilecount": 64,
        "tileheight": 64,
        "tilewidth": 64,
    }
    actual_tiny_swords_tileset = {
        key: tilesets["tiny-swords-terrain"].get(key)
        for key in expected_tiny_swords_tileset
    }
    if actual_tiny_swords_tileset != expected_tiny_swords_tileset:
        raise SystemExit(
            "Monster Tamer compact Tiny Swords tileset mismatch: "
            f"expected {expected_tiny_swords_tileset}, found {actual_tiny_swords_tileset}"
        )
    if (
        tilesets["collision"].get("firstgid") != 65
        or tilesets["encounter"].get("firstgid") != 66
    ):
        raise SystemExit(
            "Monster Tamer hidden tiles must use collision firstgid 65 and "
            "encounter firstgid 66"
        )

    expected_layer_types = {
        "Water-Scenery": "objectgroup",
        "Flat-Ground": "tilelayer",
        "Shadow-Level-1": "objectgroup",
        "Elevation-Level-1": "tilelayer",
        "Shadow-Level-2": "objectgroup",
        "Elevation-Level-2": "tilelayer",
        "Scenery": "objectgroup",
        "Collision": "tilelayer",
        "Encounter": "group",
        "Item": "objectgroup",
        "Area-Metadata": "objectgroup",
        "Revive-Location": "objectgroup",
        "Sign": "objectgroup",
        "Player-Spawn-Location": "objectgroup",
        "NPC": "group",
    }
    layers = {layer.get("name"): layer for layer in map_data.get("layers", [])}
    actual_layer_types = {name: layer.get("type") for name, layer in layers.items()}
    if len(map_data.get("layers", [])) != len(expected_layer_types) or actual_layer_types != expected_layer_types:
        raise SystemExit(
            f"Monster Tamer main_1 layer contract mismatch: expected {expected_layer_types}, "
            f"found {actual_layer_types}"
        )
    all_layers = nested_layers(map_data.get("layers", []))
    if any(layer.get("name") == "Scene-Transitions" for layer in all_layers):
        raise SystemExit("Monster Tamer seamless main_1 cannot contain Scene-Transitions")

    expected_tile_count = expected_geometry["width"] * expected_geometry["height"]
    malformed_tile_layers = [
        layer.get("name")
        for layer in all_layers
        if layer.get("type") == "tilelayer"
        and (
            layer.get("width") != expected_geometry["width"]
            or layer.get("height") != expected_geometry["height"]
            or len(layer.get("data", [])) != expected_tile_count
        )
    ]
    if malformed_tile_layers:
        raise SystemExit(
            f"Monster Tamer main_1 tile layers must cover the full map: {malformed_tile_layers}"
        )
    empty_required_layers = [
        name
        for name in ("Flat-Ground", "Elevation-Level-1", "Elevation-Level-2", "Collision")
        if not any(tile_gid(value) for value in layers[name].get("data", []))
    ]
    if empty_required_layers:
        raise SystemExit(
            f"Monster Tamer main_1 required tile layers cannot be empty: {empty_required_layers}"
        )

    item_contract = {1: 1, 2: 1, 3: 2, 4: 1, 5: 2, 6: 1}
    item_objects = layers["Item"].get("objects", [])
    items = {
        object_property(item, "id"): object_property(item, "item_id")
        for item in item_objects
    }
    if len(item_objects) != 6 or items != item_contract:
        raise SystemExit(
            f"Monster Tamer main_1 must retain six item identities: expected {item_contract}, found {items}"
        )
    expected_item_positions = {
        1: (14, 34),
        2: (29, 49),
        3: (82, 22),
        4: (108, 46),
        5: (94, 50),
        6: (31, 13),
    }
    item_positions = {
        object_property(item, "id"): object_grid_position(item)
        for item in item_objects
    }
    if item_positions != expected_item_positions:
        raise SystemExit(
            f"Monster Tamer item placement mismatch: expected {expected_item_positions}, "
            f"found {item_positions}"
        )
    sign_objects = layers["Sign"].get("objects", [])
    sign_ids = [object_property(sign, "id") for sign in sign_objects]
    if len(sign_objects) != 9 or set(sign_ids) != set(range(1, 10)):
        raise SystemExit(
            "Monster Tamer main_1 must retain sign ids 1 through 9 exactly once: "
            f"{sorted(sign_ids, key=str)}"
        )
    expected_sign_positions = {
        1: (25, 36),
        2: (68, 40),
        3: (75, 36),
        4: (57, 37),
        5: (93, 39),
        6: (84, 36),
        7: (99, 36),
        8: (72, 44),
        9: (20, 39),
    }
    sign_positions = {
        object_property(sign, "id"): object_grid_position(sign)
        for sign in sign_objects
    }
    if sign_positions != expected_sign_positions:
        raise SystemExit(
            f"Monster Tamer sign placement mismatch: expected {expected_sign_positions}, "
            f"found {sign_positions}"
        )

    npc_layers = layers["NPC"].get("layers", [])
    npc_layer_names = {layer.get("name") for layer in npc_layers}
    expected_npc_layer_names = {f"NPC{value}" for value in range(1, 11)}
    npc_objects = [
        entry
        for layer in npc_layers
        for entry in layer.get("objects", [])
        if object_property(entry, "id") is not None
    ]
    npc_ids = [object_property(entry, "id") for entry in npc_objects]
    if (
        len(npc_objects) != 10
        or npc_layer_names != expected_npc_layer_names
        or set(npc_ids) != set(range(1, 11))
    ):
        raise SystemExit(
            "Monster Tamer main_1 must retain NPC ids 1 through 10 exactly once: "
            f"layers={sorted(str(name) for name in npc_layer_names)}, "
            f"ids={sorted(npc_ids, key=str)}"
        )
    expected_npc_positions = {
        1: (64, 34),
        2: (55, 34),
        3: (62, 37),
        4: (93, 35),
        5: (72, 48),
        6: (84, 37),
        7: (18, 39),
        8: (66, 37),
        9: (31, 18),
        10: (33, 46),
    }
    npc_positions = {
        object_property(npc, "id"): object_grid_position(npc)
        for npc in npc_objects
    }
    if npc_positions != expected_npc_positions:
        raise SystemExit(
            f"Monster Tamer NPC placement mismatch: expected {expected_npc_positions}, "
            f"found {npc_positions}"
        )

    encounter_layers = layers["Encounter"].get("layers", [])
    expected_encounter_names = {f"Encounter-Area-{value}" for value in range(1, 4)}
    encounter_names = {layer.get("name") for layer in encounter_layers}
    encounter_areas = [object_property(layer, "area") for layer in encounter_layers]
    encounter_types = {object_property(layer, "tileType") for layer in encounter_layers}
    empty_encounters = [
        layer.get("name")
        for layer in encounter_layers
        if not any(tile_gid(value) for value in layer.get("data", []))
    ]
    if (
        encounter_names != expected_encounter_names
        or len(encounter_layers) != 3
        or set(encounter_areas) != {1, 2, 3}
        or encounter_types != {"GRASS"}
        or empty_encounters
    ):
        raise SystemExit(
            "Monster Tamer main_1 encounter contract mismatch: "
            f"names={encounter_names}, areas={sorted(encounter_areas, key=str)}, "
            f"types={encounter_types}, empty={empty_encounters}"
        )

    singleton_object_layers = ("Area-Metadata", "Revive-Location", "Player-Spawn-Location")
    invalid_singletons = [
        name for name in singleton_object_layers if len(layers[name].get("objects", [])) != 1
    ]
    area_metadata = layers["Area-Metadata"].get("objects", [{}])[0]
    if invalid_singletons or object_property(area_metadata, "faint_location") != "main_1":
        raise SystemExit(
            "Monster Tamer main_1 spawn/revive metadata is incomplete: "
            f"invalid_singletons={invalid_singletons}, "
            f"faint_location={object_property(area_metadata, 'faint_location')}"
        )
    player_spawn = layers["Player-Spawn-Location"]["objects"][0]
    revive_location = layers["Revive-Location"]["objects"][0]
    if (
        object_grid_position(player_spawn) != (60, 34)
        or object_grid_position(revive_location) != (62, 34)
    ):
        raise SystemExit(
            "Monster Tamer main_1 spawn/revive placement must remain "
            "spawn=(60, 34), revive=(62, 34)"
        )

    scenery_objects = layers["Scenery"].get("objects", [])
    expected_building_positions = {
        "castle": (27, 17),
        "tower-west": (11, 43),
        "tower-east": (105, 22),
        "tower-south": (59, 61),
        "barracks": (16, 20),
        "archery": (39, 20),
        "monastery": (73, 50),
        "house-1-a": (79, 42),
        "house-1-b": (104, 45),
        "house-2-a": (87, 40),
        "house-2-b": (88, 49),
        "house-3-a": (98, 40),
        "house-3-b": (96, 49),
    }
    building_positions = {
        entry.get("name"): object_grid_position(entry)
        for entry in scenery_objects
        if entry.get("name") in expected_building_positions
    }
    scenery_asset_keys = {
        object_property(entry, "asset_key")
        for layer_name in (
            "Water-Scenery",
            "Shadow-Level-1",
            "Shadow-Level-2",
            "Scenery",
        )
        for entry in layers[layer_name].get("objects", [])
    }
    landmark_trees = {
        entry.get("name")
        for entry in scenery_objects
        if str(entry.get("name", "")).startswith("landmark-tree-")
    }
    if (
        building_positions != expected_building_positions
        or len(scenery_objects) != 152
        or len(layers["Water-Scenery"].get("objects", [])) != 38
        or landmark_trees != {f"landmark-tree-{value}" for value in range(1, 11)}
        or not scenery_asset_keys
        or any(
            not isinstance(key, str) or not key.startswith("TINY_SWORDS_")
            for key in scenery_asset_keys
        )
    ):
        raise SystemExit(
            "Monster Tamer Tiny Swords scenery/building contract mismatch: "
            f"buildings={building_positions}, scenery={len(scenery_objects)}, "
            f"water={len(layers['Water-Scenery'].get('objects', []))}, "
            f"landmarks={sorted(map(str, landmark_trees))}, "
            f"assets={sorted(map(str, scenery_asset_keys))}"
        )

    invalid_visual_gids = {
        tile_gid(value)
        for name in ("Flat-Ground", "Elevation-Level-1", "Elevation-Level-2")
        for value in layers[name].get("data", [])
        if tile_gid(value) not in range(65)
    }
    invalid_collision_gids = {
        tile_gid(value)
        for value in layers["Collision"].get("data", [])
        if tile_gid(value) not in {0, 65}
    }
    invalid_encounter_gids = {
        tile_gid(value)
        for layer in encounter_layers
        for value in layer.get("data", [])
        if tile_gid(value) not in {0, 66}
    }
    if invalid_visual_gids or invalid_collision_gids or invalid_encounter_gids:
        raise SystemExit(
            "Monster Tamer main_1 uses GIDs outside the compact atlas contract: "
            f"visual={sorted(invalid_visual_gids)}, "
            f"collision={sorted(invalid_collision_gids)}, "
            f"encounter={sorted(invalid_encounter_gids)}"
        )


def nested_layers(layers: list[dict[str, object]]) -> list[dict[str, object]]:
    result: list[dict[str, object]] = []
    for layer in layers:
        result.append(layer)
        children = layer.get("layers", [])
        if isinstance(children, list):
            result.extend(nested_layers(children))
    return result


def object_property(entry: dict[str, object], name: str) -> object | None:
    properties = entry.get("properties", [])
    if not isinstance(properties, list):
        return None
    return next(
        (
            prop.get("value")
            for prop in properties
            if isinstance(prop, dict) and prop.get("name") == name
        ),
        None,
    )


def object_grid_position(entry: dict[str, object]) -> tuple[int, int]:
    return (
        round(float(entry.get("x", 0)) / 64),
        round(float(entry.get("y", 0)) / 64) - 1,
    )


def tile_gid(value: object) -> int:
    return int(value) & 0x0FFFFFFF if isinstance(value, int) else 0


def png_dimensions(path: Path) -> tuple[int, int]:
    header = path.read_bytes()[:24]
    if len(header) != 24 or header[:8] != b"\x89PNG\r\n\x1a\n" or header[12:16] != b"IHDR":
        raise SystemExit(f"Monster Tamer runtime atlas is not a valid PNG: {relative(path)}")
    return int.from_bytes(header[16:20], "big"), int.from_bytes(header[20:24], "big")


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
        "120×64",
        "Tilemap_color1",
        "Blue Buildings",
        "#47ABA9",
        "36.8 秒",
        "WASD",
        "虚拟摇杆",
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
