"""Render the fixed Monster Tamer rules, combat profiles, and world data."""

from __future__ import annotations

import hashlib
import json
import math
from typing import Any

from catalog import sql_string


RULES_VERSION = "v1"
ELEMENTS = ("water", "fire", "wood", "wind", "lightning")
AREA_LAYOUT = {
    "camp": (0x1A4B, 0.08),
    "luminous_forest": (0x31C7, 0.20),
    "tidal_wetland": (0x5EA1, 0.16),
    "windswept_highlands": (0x7D35, 0.14),
    "crystal_cavern": (0x92EF, 0.19),
    "molten_basin": (0xB419, 0.18),
    "hidden_cave": (0xD264, 0.23),
    "guardian_lair": (0xF0A7, 0.12),
}
CHAIN_ELEMENTS = (
    "fire", "water", "wood", "wood", "wind", "wind", "lightning", "fire", "water", "wood",
    "water", "wood", "wind", "water", "fire", "water", "fire", "water", "wood", "wood",
    "water", "fire", "wind", "wood", "water", "wood", "wind", "fire", "water", "lightning",
    "wood", "water", "wood", "wind", "wood", "water", "fire", "lightning", "water", "wind",
    "wind", "lightning", "water", "wind", "fire", "lightning", "wood", "fire", "wind", "lightning",
    "water", "wind", "wind", "fire", "wind", "fire", "wood", "lightning", "lightning", "lightning",
    "lightning", "lightning", "fire", "lightning", "lightning", "fire", "wood", "lightning", "fire", "wind",
)

REGIONS = (
    {
        "id": "camp",
        "name": "中心营地",
        "sort_order": 1,
        "element": None,
        "width": 32,
        "height": 24,
        "spawn": (16, 12),
        "effect": "camp_rest",
        "difficulty": (10000, 10000),
    },
    {
        "id": "luminous_forest",
        "name": "萤光森林",
        "sort_order": 2,
        "element": "wood",
        "width": 48,
        "height": 36,
        "spawn": (4, 18),
        "effect": "forest_regen",
        "difficulty": (8500, 10500),
    },
    {
        "id": "tidal_wetland",
        "name": "潮汐湿地",
        "sort_order": 3,
        "element": "water",
        "width": 48,
        "height": 36,
        "spawn": (4, 18),
        "effect": "wetland_shield",
        "difficulty": (8500, 10500),
    },
    {
        "id": "windswept_highlands",
        "name": "风蚀高原",
        "sort_order": 4,
        "element": "wind",
        "width": 48,
        "height": 36,
        "spawn": (4, 18),
        "effect": "highland_tailwind",
        "difficulty": (9000, 11000),
    },
    {
        "id": "crystal_cavern",
        "name": "晶矿洞窟",
        "sort_order": 5,
        "element": "lightning",
        "width": 48,
        "height": 36,
        "spawn": (4, 18),
        "effect": "cavern_charge",
        "difficulty": (9000, 11000),
    },
    {
        "id": "molten_basin",
        "name": "熔火盆地",
        "sort_order": 6,
        "element": "fire",
        "width": 48,
        "height": 36,
        "spawn": (4, 18),
        "effect": "basin_heat_guard",
        "difficulty": (9500, 11500),
    },
    {
        "id": "hidden_cave",
        "name": "隐藏洞穴",
        "sort_order": 7,
        "element": "lightning",
        "width": 32,
        "height": 24,
        "spawn": (3, 12),
        "effect": "cavern_charge",
        "difficulty": (10000, 12000),
    },
    {
        "id": "guardian_lair",
        "name": "最终守护者巢穴",
        "sort_order": 8,
        "element": None,
        "width": 32,
        "height": 24,
        "spawn": (3, 12),
        "effect": "guardian_cycle",
        "difficulty": (10000, 12500),
    },
)

WORLD_NODES = (
    ("forest_supply_grove", "luminous_forest", "supply", "荧苔补给丛", 11, 8, None, None, True, 1, 0),
    ("forest_gather_spring", "luminous_forest", "gather", "森息泉眼", 24, 28, None, None, True, 0, 1500),
    ("forest_first_chest", "luminous_forest", "chest", "林冠宝箱", 20, 5, None, None, False, 2, 0),
    ("forest_vine_shortcut", "luminous_forest", "shortcut", "古藤捷径", 34, 9, "vine_bridge", None, False, 1, 0),
    ("forest_hidden_gate", "luminous_forest", "gate", "潮痕石门", 43, 30, "tidal_walk", "hidden_cave", False, 2, 0),
    ("forest_exit_camp", "luminous_forest", "exit", "返回中心营地", 2, 18, None, "camp", False, 0, 0),
    ("forest_rematch_altar", "luminous_forest", "rematch", "萤光首领再战祭坛", 41, 18, None, None, False, 0, 0),
    ("wetland_supply_islet", "tidal_wetland", "supply", "浮叶补给岛", 13, 27, None, None, True, 1, 0),
    ("wetland_gather_pool", "tidal_wetland", "gather", "澄潮恢复池", 28, 8, None, None, True, 0, 1500),
    ("wetland_first_chest", "tidal_wetland", "chest", "沉沙宝箱", 20, 30, None, None, False, 2, 0),
    ("wetland_tidal_shortcut", "tidal_wetland", "shortcut", "回潮浅道", 39, 23, "tidal_walk", None, False, 1, 0),
    ("wetland_exit_camp", "tidal_wetland", "exit", "返回中心营地", 2, 18, None, "camp", False, 0, 0),
    ("wetland_rematch_altar", "tidal_wetland", "rematch", "潮汐首领再战祭坛", 41, 18, None, None, False, 0, 0),
    ("highland_supply_nest", "windswept_highlands", "supply", "风巢补给点", 10, 29, None, None, True, 1, 0),
    ("highland_gather_updraft", "windswept_highlands", "gather", "上升气流台", 25, 8, None, None, True, 0, 1500),
    ("highland_first_chest", "windswept_highlands", "chest", "风蚀宝箱", 20, 5, None, None, False, 2, 0),
    ("highland_glide_shortcut", "windswept_highlands", "shortcut", "云脊飞渡", 40, 18, "wind_glide", None, False, 1, 0),
    ("highland_exit_camp", "windswept_highlands", "exit", "返回中心营地", 2, 18, None, "camp", False, 0, 0),
    ("highland_rematch_altar", "windswept_highlands", "rematch", "风蚀首领再战祭坛", 41, 18, None, None, False, 0, 0),
    ("cavern_supply_cache", "crystal_cavern", "supply", "晶簇补给箱", 12, 7, None, None, True, 1, 0),
    ("cavern_gather_conduit", "crystal_cavern", "gather", "静电导流柱", 27, 28, None, None, True, 0, 1500),
    ("cavern_first_chest", "crystal_cavern", "chest", "晶矿宝箱", 20, 30, None, None, False, 2, 0),
    ("cavern_charge_shortcut", "crystal_cavern", "shortcut", "雷门捷径", 40, 11, "lightning_charge", None, False, 1, 0),
    ("cavern_exit_camp", "crystal_cavern", "exit", "返回中心营地", 2, 18, None, "camp", False, 0, 0),
    ("cavern_rematch_altar", "crystal_cavern", "rematch", "晶矿首领再战祭坛", 41, 18, None, None, False, 0, 0),
    ("basin_supply_shelter", "molten_basin", "supply", "耐热补给棚", 11, 28, None, None, True, 1, 0),
    ("basin_gather_vent", "molten_basin", "gather", "温泉散热口", 27, 7, None, None, True, 0, 1500),
    ("basin_first_chest", "molten_basin", "chest", "熔岩宝箱", 20, 5, None, None, False, 2, 0),
    ("basin_heat_shortcut", "molten_basin", "shortcut", "熔沟近道", 40, 25, "heat_shield", None, False, 1, 0),
    ("basin_exit_camp", "molten_basin", "exit", "返回中心营地", 2, 18, None, "camp", False, 0, 0),
    ("basin_rematch_altar", "molten_basin", "rematch", "熔火首领再战祭坛", 41, 18, None, None, False, 0, 0),
    ("hidden_supply_cache", "hidden_cave", "supply", "遗落探险包", 10, 18, None, None, True, 1, 0),
    ("hidden_gather_crystal", "hidden_cave", "gather", "幽光共鸣晶", 21, 7, None, None, True, 0, 2000),
    ("hidden_ancient_chest", "hidden_cave", "chest", "古代补给箱", 28, 18, "lightning_charge", None, False, 3, 0),
    ("hidden_exit_camp", "hidden_cave", "exit", "返回中心营地", 2, 12, None, "camp", False, 0, 0),
    ("guardian_supply_altar", "guardian_lair", "supply", "守护者补给坛", 10, 18, None, None, True, 2, 0),
    ("guardian_gather_focus", "guardian_lair", "gather", "五相凝神台", 21, 7, None, None, True, 0, 2500),
    ("guardian_exit_camp", "guardian_lair", "exit", "返回中心营地", 2, 12, None, "camp", False, 0, 0),
    ("guardian_rematch_altar", "guardian_lair", "rematch", "最终守护者再战祭坛", 24, 12, None, None, False, 0, 0),
)

ENCOUNTERS = (
    ("forest_normal_moss", "luminous_forest", "normal", "PET-N-003-1", 14, 13, 1, None, "none", 5),
    ("forest_normal_deer", "luminous_forest", "normal", "PET-N-012-2", 29, 27, 1, None, "none", 5),
    ("forest_elite_wall", "luminous_forest", "elite", "PET-N-033-3", 38, 9, 2, None, "none", 5),
    ("boss_luminous_forest", "luminous_forest", "boss", "PET-A-017-3", 44, 18, 3, "vine_bridge", "forest_regrowth", 1),
    ("wetland_normal_otter", "tidal_wetland", "normal", "PET-N-002-1", 13, 10, 1, None, "none", 5),
    ("wetland_normal_squid", "tidal_wetland", "normal", "PET-N-014-2", 27, 25, 1, None, "none", 5),
    ("wetland_elite_dolphin", "tidal_wetland", "elite", "PET-N-032-3", 38, 11, 2, None, "none", 5),
    ("boss_tidal_wetland", "tidal_wetland", "boss", "PET-A-003-3", 44, 18, 3, "tidal_walk", "wetland_tide_shield", 1),
    ("highland_normal_sparrow", "windswept_highlands", "normal", "PET-N-005-1", 13, 26, 1, None, "none", 5),
    ("highland_normal_sheep", "windswept_highlands", "normal", "PET-N-013-2", 28, 9, 1, None, "none", 5),
    ("highland_elite_ray", "windswept_highlands", "elite", "PET-N-040-3", 38, 27, 2, None, "none", 5),
    ("boss_windswept_highlands", "windswept_highlands", "boss", "PET-A-009-3", 44, 18, 3, "wind_glide", "highland_gust_followup", 1),
    ("cavern_normal_mouse", "crystal_cavern", "normal", "PET-N-007-1", 13, 9, 1, None, "none", 5),
    ("cavern_normal_mole", "crystal_cavern", "normal", "PET-N-030-2", 28, 27, 1, None, "none", 5),
    ("cavern_elite_bear", "crystal_cavern", "elite", "PET-A-018-2", 38, 8, 2, None, "none", 5),
    ("boss_crystal_cavern", "crystal_cavern", "boss", "PET-A-002-3", 44, 18, 3, "lightning_charge", "cavern_thunder_cycle", 1),
    ("basin_normal_fox", "molten_basin", "normal", "PET-N-001-1", 13, 27, 1, None, "none", 5),
    ("basin_normal_raccoon", "molten_basin", "normal", "PET-N-017-2", 28, 9, 1, None, "none", 5),
    ("basin_elite_salamander", "molten_basin", "elite", "PET-N-028-3", 38, 26, 2, None, "none", 5),
    ("boss_molten_basin", "molten_basin", "boss", "PET-A-005-3", 44, 18, 3, "heat_shield", "basin_scorch", 1),
    ("hidden_normal_bat", "hidden_cave", "normal", "PET-N-023-2", 12, 7, 2, None, "none", 5),
    ("hidden_elite_scorpion", "hidden_cave", "elite", "PET-A-010-3", 27, 17, 3, None, "none", 5),
    ("guardian_final", "guardian_lair", "guardian", "PET-T-001-3", 27, 12, 5, None, "guardian_element_cycle", 1),
)

REMATCH_NODES = (
    ("forest_rematch_altar", "boss_luminous_forest"),
    ("wetland_rematch_altar", "boss_tidal_wetland"),
    ("highland_rematch_altar", "boss_windswept_highlands"),
    ("cavern_rematch_altar", "boss_crystal_cavern"),
    ("basin_rematch_altar", "boss_molten_basin"),
    ("guardian_rematch_altar", "guardian_final"),
)

SKILL_BLUEPRINTS = {
    "water": (
        ("涌流击", "none", (8500, 9500, 10500), (0, 0, 0), (0, 0, 0)),
        ("愈潮", "heal_self", (6500, 7500, 8500), (900, 1300, 1700), (0, 0, 0)),
        ("潮盾", "shield_self", (9000, 10000, 11000), (1000, 1500, 2000), (0, 0, 0)),
    ),
    "fire": (
        ("烈焰击", "none", (9000, 10000, 11000), (0, 0, 0), (0, 0, 0)),
        ("灼痕", "burn_enemy", (7000, 8000, 9000), (700, 900, 1100), (2, 2, 3)),
        ("焰势", "attack_up_self", (9500, 10500, 11500), (1000, 1500, 2000), (1, 1, 1)),
    ),
    "wood": (
        ("藤袭", "none", (8500, 9500, 10500), (0, 0, 0), (0, 0, 0)),
        ("生息", "regen_self", (6500, 7500, 8500), (500, 700, 900), (2, 3, 3)),
        ("汲取", "drain_self", (9000, 10000, 11000), (2500, 3500, 4500), (0, 0, 0)),
    ),
    "wind": (
        ("岚刃", "none", (9000, 10000, 11000), (0, 0, 0), (0, 0, 0)),
        ("追风", "attack_up_self", (7500, 8500, 9500), (900, 1300, 1700), (1, 1, 1)),
        ("乱流", "weaken_enemy", (9000, 10000, 11000), (900, 1300, 1700), (1, 1, 1)),
    ),
    "lightning": (
        ("雷击", "none", (9000, 10000, 11000), (0, 0, 0), (0, 0, 0)),
        ("导能", "charge_self", (7500, 8500, 9500), (800, 1200, 1600), (1, 1, 1)),
        ("震荡", "weaken_enemy", (9500, 10500, 11500), (800, 1200, 1600), (1, 1, 1)),
    ),
}


def sql_value(value: object) -> str:
    if value is None:
        return "null"
    if isinstance(value, bool):
        return "true" if value else "false"
    if isinstance(value, int):
        return str(value)
    return sql_string(value)


def u32(value: int) -> int:
    return value & 0xFFFFFFFF


def imul(left: int, right: int) -> int:
    return u32(left * right)


def cell_noise(seed: int, x: int, y: int) -> float:
    value = imul(x + 17, 0x45D9F3B) ^ imul(y + 37, 0x119DE1F3)
    value = imul(value ^ seed, 0x27D4EB2D)
    value = u32(value ^ (value >> 15))
    return value / 0xFFFFFFFF


def topology_value(
    region_id: str,
    x: int,
    y: int,
    width: int,
    height: int,
    noise: float,
) -> float:
    nx = x / max(1, width - 1)
    ny = y / max(1, height - 1)
    if region_id == "camp":
        return noise + abs(nx - 0.5) * 0.15 + abs(ny - 0.5) * 0.15
    if region_id == "luminous_forest":
        return noise * 0.72 + math.sin(x * 0.7) * 0.08 + 0.16
    if region_id == "tidal_wetland":
        return noise * 0.72 + abs(math.sin(y * 0.48 + x * 0.12)) * 0.23
    if region_id == "windswept_highlands":
        return noise * 0.78 + abs(math.sin((x + y) * 0.24)) * 0.2
    if region_id == "crystal_cavern":
        return noise * 0.7 + abs(math.cos(x * 0.31) * math.sin(y * 0.37)) * 0.26
    if region_id == "molten_basin":
        return noise * 0.72 + abs(math.sin(x * 0.25) - math.cos(y * 0.3)) * 0.14
    if region_id == "hidden_cave":
        return noise * 0.66 + abs(math.sin(x * 0.36 + y * 0.19)) * 0.24
    distance = math.hypot(nx - 0.5, ny - 0.5)
    return noise * 0.5 + abs(math.sin(distance * 28)) * 0.38


def clear_cell_radius(
    blocked: set[tuple[int, int]],
    center: tuple[int, int],
    width: int,
    height: int,
    radius: int,
) -> None:
    for y in range(center[1] - radius, center[1] + radius + 1):
        for x in range(center[0] - radius, center[0] + radius + 1):
            if 0 < x < width - 1 and 0 < y < height - 1:
                blocked.discard((x, y))


def carve_route(
    blocked: set[tuple[int, int]],
    start: tuple[int, int],
    target: tuple[int, int],
    width: int,
    height: int,
    horizontal_first: bool,
) -> None:
    x, y = start

    def clear() -> None:
        clear_cell_radius(blocked, (x, y), width, height, 0)
        if x + 1 < width - 1:
            blocked.discard((x + 1, y))
        if y + 1 < height - 1:
            blocked.discard((x, y + 1))

    def walk_x() -> None:
        nonlocal x
        while x != target[0]:
            x += 1 if target[0] > x else -1
            clear()

    def walk_y() -> None:
        nonlocal y
        while y != target[1]:
            y += 1 if target[1] > y else -1
            clear()

    clear()
    if horizontal_first:
        walk_x()
        walk_y()
    else:
        walk_y()
        walk_x()


def blocked_cells(region: dict[str, object]) -> set[tuple[int, int]]:
    region_id = str(region["id"])
    width = int(region["width"])
    height = int(region["height"])
    seed, density = AREA_LAYOUT[region_id]
    blocked = {
        (x, y)
        for y in range(height)
        for x in range(width)
        if x == 0
        or y == 0
        or x == width - 1
        or y == height - 1
        or topology_value(
            region_id,
            x,
            y,
            width,
            height,
            cell_noise(seed, x, y),
        )
        < density * (0.75 if region_id == "guardian_lair" else 1)
    }
    spawn = tuple(region["spawn"])
    protected = [
        (int(row[4]), int(row[5]))
        for row in (*WORLD_NODES, *ENCOUNTERS)
        if row[1] == region_id
    ]
    clear_cell_radius(blocked, spawn, width, height, 1)
    for cell in protected:
        clear_cell_radius(blocked, cell, width, height, 0)
    for target in sorted(
        protected,
        key=lambda cell: (
            abs(spawn[0] - cell[0]) + abs(spawn[1] - cell[1]),
            cell[1],
            cell[0],
        ),
    ):
        carve_route(
            blocked,
            spawn,
            target,
            width,
            height,
            cell_noise(seed, target[0], target[1]) > 0.5,
        )
    return blocked


def world_cells() -> list[tuple[str, int, int, str, bool]]:
    rows: list[tuple[str, int, int, str, bool]] = []
    for region in REGIONS:
        blocked = blocked_cells(region)
        for y in range(int(region["height"])):
            for x in range(int(region["width"])):
                rows.append((str(region["id"]), x, y, f"{x}:{y}", (x, y) not in blocked))
    return rows


def skills() -> list[tuple[object, ...]]:
    rows: list[tuple[object, ...]] = []
    for element in ELEMENTS:
        for slot, (name, effect, powers, values, durations) in enumerate(
            SKILL_BLUEPRINTS[element],
            start=1,
        ):
            for stage in range(1, 4):
                rows.append(
                    (
                        RULES_VERSION,
                        element,
                        stage,
                        slot,
                        f"{element}_s{stage}_{slot}",
                        name,
                        powers[stage - 1],
                        effect,
                        values[stage - 1],
                        durations[stage - 1],
                    )
                )
    return rows


def validate(chains: list[dict[str, object]], templates: list[dict[str, object]]) -> None:
    if len(CHAIN_ELEMENTS) != 70 or set(CHAIN_ELEMENTS) != set(ELEMENTS):
        raise ValueError("Monster Tamer requires one fixed element for all 70 chains")
    if [chain["global_order"] for chain in chains] != list(range(1, 71)):
        raise ValueError("Monster Tamer chain elements require the fixed 1..70 catalog order")
    if len(skills()) != 45:
        raise ValueError("Monster Tamer must define 45 element/stage/slot skill rows")
    template_ids = {str(template["id"]) for template in templates}
    missing = sorted({row[3] for row in ENCOUNTERS} - template_ids)
    if missing:
        raise ValueError(f"Monster Tamer encounters reference unknown templates: {missing}")
    region_by_id = {str(region["id"]): region for region in REGIONS}
    if len(region_by_id) != len(REGIONS):
        raise ValueError("Monster Tamer region identifiers must be unique")
    occupied: set[tuple[str, int, int]] = set()
    for row in (*WORLD_NODES, *ENCOUNTERS):
        region_id, x, y = str(row[1]), int(row[4]), int(row[5])
        region = region_by_id[region_id]
        if not (0 <= x < int(region["width"]) and 0 <= y < int(region["height"])):
            raise ValueError(f"Monster Tamer object {row[0]} is outside {region_id}")
        position = (region_id, x, y)
        if position in occupied:
            raise ValueError(f"Monster Tamer objects overlap at {position}")
        occupied.add(position)
    expected_cells = sum(int(region["width"]) * int(region["height"]) for region in REGIONS)
    if len(world_cells()) != expected_cells or len({row[3] for row in world_cells() if row[0] == "camp"}) != 32 * 24:
        raise ValueError("Monster Tamer world cells are incomplete")
    if any(not row[4] for row in world_cells() if any(
        object_row[1] == row[0] and object_row[4] == row[1] and object_row[5] == row[2]
        for object_row in (*WORLD_NODES, *ENCOUNTERS)
    )):
        raise ValueError("Monster Tamer protected object cells must be walkable")
    rematch_ids = {row[0] for row in REMATCH_NODES}
    if rematch_ids != {row[0] for row in WORLD_NODES if row[2] == "rematch"}:
        raise ValueError("Every rematch altar must map to one encounter")


def map_checksum() -> str:
    content: dict[str, Any] = {
        "regions": REGIONS,
        "world_cells": world_cells(),
        "world_nodes": WORLD_NODES,
        "encounters": ENCOUNTERS,
        "rematches": REMATCH_NODES,
    }
    canonical = json.dumps(content, ensure_ascii=False, sort_keys=True, separators=(",", ":"))
    return hashlib.sha256(canonical.encode()).hexdigest()


def values(rows: list[tuple[object, ...]] | tuple[tuple[object, ...], ...]) -> str:
    return ",\n".join(
        "  (" + ", ".join(sql_value(value) for value in row) + ")"
        for row in rows
    )


def render(chains: list[dict[str, object]], templates: list[dict[str, object]]) -> str:
    validate(chains, templates)
    chain_rows = [
        (chain["id"], RULES_VERSION, CHAIN_ELEMENTS[index])
        for index, chain in enumerate(chains)
    ]
    region_rows = [
        (
            region["id"],
            RULES_VERSION,
            region["name"],
            region["sort_order"],
            region["element"],
            region["width"],
            region["height"],
            region["spawn"][0],
            region["spawn"][1],
            region["effect"],
            region["difficulty"][0],
            region["difficulty"][1],
        )
        for region in REGIONS
    ]
    cell_rows = [
        (RULES_VERSION, region_id, cell_id, x, y, walkable)
        for region_id, x, y, cell_id, walkable in world_cells()
    ]
    node_rows = [
        (node_id, RULES_VERSION, region_id, kind, name, x, y, ability, target, refreshable, supply, heal)
        for node_id, region_id, kind, name, x, y, ability, target, refreshable, supply, heal in WORLD_NODES
    ]
    encounter_rows = [
        (encounter_id, RULES_VERSION, region_id, kind, template_id, x, y, supply, ability, mechanic, engage_radius)
        for encounter_id, region_id, kind, template_id, x, y, supply, ability, mechanic, engage_radius in ENCOUNTERS
    ]
    return f"""insert into monster_tamer.rulesets (id, map_checksum, active) values
  ({sql_string(RULES_VERSION)}, {sql_string(map_checksum())}, true);

insert into monster_tamer.chain_profiles (chain_id, rules_version, element) values
{values(chain_rows)};

insert into monster_tamer.skill_profiles (rules_version, element, stage, slot, code, name, power_bp, effect_kind, effect_value_bp, duration_turns) values
{values(skills())};

insert into monster_tamer.regions (id, rules_version, name, sort_order, element, width_tiles, height_tiles, spawn_x, spawn_y, environment_effect_code, difficulty_min_bp, difficulty_max_bp) values
{values(region_rows)};

insert into monster_tamer.world_cells (rules_version, region_id, cell_id, x, y, walkable) values
{values(cell_rows)};

insert into monster_tamer.world_nodes (id, rules_version, region_id, kind, name, x, y, required_ability, target_region, refreshable, supply_reward, heal_bp) values
{values(node_rows)};

insert into monster_tamer.encounter_definitions (id, rules_version, region_id, kind, template_id, x, y, supply_reward, reward_ability, mechanic_code, engage_radius) values
{values(encounter_rows)};

insert into monster_tamer.rematch_nodes (node_id, encounter_id) values
{values(list(REMATCH_NODES))};
"""
