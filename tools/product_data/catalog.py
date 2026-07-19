"""Parse the collection catalog and render its immutable template data."""

from __future__ import annotations

import re


CHAIN_TYPES = {
    "普通链": ("normal", {1: "common", 2: "rare", 3: "epic"}),
    "高级链": ("advanced", {1: "rare", 2: "epic", 3: "legendary"}),
    "顶级链": ("top", {1: "epic", 2: "legendary", 3: "mythic"}),
}
ECONOMY = {
    ("normal", 1): (4, 2, 1),
    ("normal", 2): (12, 12, 2),
    ("normal", 3): (60, 60, 6),
    ("advanced", 1): (14, 10, 2),
    ("advanced", 2): (70, 45, 6),
    ("advanced", 3): (160, 240, 18),
    ("top", 1): (80, 40, 7),
    ("top", 2): (180, 200, 20),
    ("top", 3): (900, 900, 60),
}
EXPECTED_RARITIES = {
    "common": 40,
    "rare": 60,
    "epic": 70,
    "legendary": 30,
    "mythic": 10,
}


def parse(markdown: str) -> tuple[list[dict[str, object]], list[dict[str, object]]]:
    section = markdown.split("### 1.8 PokePets 正式藏品目录", 1)[1].split("## 2.", 1)[0]
    chains: list[dict[str, object]] = []
    templates: list[dict[str, object]] = []
    row_pattern = re.compile(r"^\|\s*(\d+)\s*\|\s*`(CHAIN-[NAT]-\d{3})`\s*\|\s*([^|]+?)\s*\|\s*([^|]+?)\s*\|\s*([^|]+?)\s*\|(.+)\|$")
    pet_pattern = re.compile(r"^\s*`(PET-[NAT]-\d{3}-([123]))`\s+(.+?)\s*$")
    for line in section.splitlines():
        row = row_pattern.match(line)
        if not row:
            continue
        global_order = int(row.group(1))
        chain_id = row.group(2)
        type_cn = row.group(3).strip()
        theme = row.group(4).strip()
        continuity = row.group(5).strip()
        stages = [cell.strip() for cell in row.group(6).split("|")]
        if len(stages) != 3 or type_cn not in CHAIN_TYPES:
            raise ValueError(f"Invalid catalog row: {line}")
        chain_type, rarities = CHAIN_TYPES[type_cn]
        chain_index = int(chain_id[-3:])
        chains.append({"id": chain_id, "global_order": global_order, "chain_type": chain_type, "theme": theme, "continuity": continuity})
        for stage_cell in stages:
            pet = pet_pattern.match(stage_cell)
            if not pet:
                raise ValueError(f"Invalid template cell: {stage_cell}")
            template_id, stage_text, name = pet.groups()
            stage = int(stage_text)
            price, decompose, expedition = ECONOMY[(chain_type, stage)]
            templates.append({
                "id": template_id,
                "chain_id": chain_id,
                "stage": stage,
                "rarity": rarities[stage],
                "name": name,
                "sort_order": (global_order - 1) * 3 + stage,
                "combat_power": combat_power(chain_type, chain_index, stage),
                "market_price": price,
                "decompose_fgems": decompose,
                "expedition_fgems": expedition,
                "image_path": f"/assets/catalog/v1/{template_id.lower()}.webp",
            })
    validate(chains, templates)
    return chains, templates


def combat_power(chain_type: str, index: int, stage: int) -> int:
    formulas = {
        ("normal", 1): 100 + index,
        ("normal", 2): 240 + 2 * index,
        ("normal", 3): 540 + 3 * index,
        ("advanced", 1): 300 + 3 * index,
        ("advanced", 2): 720 + 5 * index,
        ("advanced", 3): 1600 + 10 * index,
        ("top", 1): 900 + 10 * index,
        ("top", 2): 2200 + 20 * index,
        ("top", 3): 6000 + 50 * index,
    }
    return formulas[(chain_type, stage)]


def validate(chains: list[dict[str, object]], templates: list[dict[str, object]]) -> None:
    if len(chains) != 70 or len(templates) != 210:
        raise ValueError(f"Expected 70 chains/210 templates, got {len(chains)}/{len(templates)}")
    if [item["global_order"] for item in chains] != list(range(1, 71)):
        raise ValueError("Global chain order is not continuous")
    if [item["sort_order"] for item in templates] != list(range(1, 211)):
        raise ValueError("Template sort order is not continuous")
    if len({item["id"] for item in templates}) != 210:
        raise ValueError("Template identifiers are not unique")
    actual = {rarity: sum(item["rarity"] == rarity for item in templates) for rarity in EXPECTED_RARITIES}
    if actual != EXPECTED_RARITIES:
        raise ValueError(f"Rarity counts mismatch: {actual}")


def sql_string(value: object) -> str:
    return "'" + str(value).replace("'", "''") + "'"


def render(chains: list[dict[str, object]], templates: list[dict[str, object]]) -> str:
    chain_values = ",\n".join(
        "  (" + ", ".join([
            sql_string(item["id"]), str(item["global_order"]), sql_string(item["chain_type"]),
            sql_string(item["theme"]), sql_string(item["continuity"]), sql_string("v1")
        ]) + ")" for item in chains
    )
    template_values = ",\n".join(
        "  (" + ", ".join([
            sql_string(item["id"]), sql_string(item["chain_id"]), str(item["stage"]),
            sql_string(item["rarity"]), sql_string(item["name"]), str(item["sort_order"]),
            str(item["combat_power"]), str(item["market_price"]), str(item["decompose_fgems"]),
            str(item["expedition_fgems"]), sql_string(item["image_path"]), "1", sql_string("v1")
        ]) + ")" for item in templates
    )
    return f"""insert into catalog.chains (id, global_order, chain_type, theme, continuity, catalog_version) values
{chain_values};

insert into catalog.templates (id, chain_id, stage, rarity, name, sort_order, combat_power, market_price, decompose_fgems, expedition_fgems, image_path, draw_weight, catalog_version) values
{template_values};
"""
