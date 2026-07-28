"""Parse and render the frozen battle-v1 product configuration."""

from __future__ import annotations

import hashlib
import json
import re
from typing import Any

from catalog import sql_string


VERSION = "battle-v1"
ELEMENT_IDS = {
    "火焰": "fire",
    "草系": "grass",
    "土系": "earth",
    "雷电": "lightning",
    "水系": "water",
}
RARITY_IDS = {
    "普通": "common",
    "稀有": "rare",
    "史诗": "epic",
    "传说": "legendary",
    "神话": "mythic",
}
ELEMENT_ORDER = tuple(ELEMENT_IDS)
RARITY_ORDER = tuple(RARITY_IDS)
REQUIRED_SOURCE_FACTS = (
    "唯一正式规则版本固定为 `battle-v1`",
    "火焰 → 草系 → 土系 → 雷电 → 水系 → 火焰",
    "克制倍率固定为 1.50，被克制倍率固定为 0.75，同属性或不相邻属性固定为 1.00",
    "20/100/500 三档结算",
    "5 分钟双人等待房、3 秒开战倒计时、3 秒回合展示窗口、15 秒选择时限和 20 回合上限",
    "Battle 产品数据生成器只读取本节确定数据",
    "接受成功时数据库使用 `gen_random_bytes(32)`",
    "HMAC-SHA256(room_private_seed, battle_id | turn_no | actor_side | action_ordinal | skill_id)",
)
RULE_PARAMETERS = {
    "share_prepare_timeout_seconds": 60,
    "waiting_timeout_seconds": 1800,
    "heartbeat_interval_seconds": 5,
    "presence_online_window_seconds": 10,
    "offline_reconnect_seconds": 90,
    "lobby_timeout_seconds": 300,
    "lobby_countdown_seconds": 3,
    "action_timeout_seconds": 15,
    "forced_switch_timeout_seconds": 15,
    "reveal_seconds": 3,
    "max_normal_turns": 20,
    "tick_batch_limit": 100,
    "fee_bps": 1000,
    "single_hit_cap_bps": 8000,
    "random_modulus": 10000,
    "rate_limit_window_seconds": 60,
    "rate_limit_retention_seconds": 300,
}
ENTRY_TIERS = (
    {"id": "tier-20", "entry_fee": 20, "pool": 40, "winner_payout": 36, "fee": 4},
    {"id": "tier-100", "entry_fee": 100, "pool": 200, "winner_payout": 180, "fee": 20},
    {"id": "tier-500", "entry_fee": 500, "pool": 1000, "winner_payout": 900, "fee": 100},
)
RATE_LIMITS = (
    {"action": "create", "limit": 3},
    {"action": "invite_preview", "limit": 60},
    {"action": "accept", "limit": 10},
    {"action": "combat_action", "limit": 30},
    {"action": "heartbeat", "limit": 30},
    {"action": "realtime_token", "limit": 10},
)
ROOM_STATES = (
    "preparing_share",
    "waiting",
    "lobby_waiting",
    "lobby_countdown",
    "active_select",
    "reveal",
    "forced_switch",
    "finished",
    "draw",
    "cancelled",
    "expired",
    "voided",
)
OUTBOX_RETRY_SECONDS = (1, 2, 5, 10, 30)


def section_21_8(product_extensions: str) -> str:
    marker = "### 21.8 `battle-v1` 规则快照"
    end_marker = "### 21.9 "
    if product_extensions.count(marker) != 1:
        raise ValueError("Product document must contain exactly one battle-v1 source section")
    section = product_extensions.split(marker, 1)[1]
    if end_marker not in section:
        raise ValueError("battle-v1 source section must end before section 21.9")
    section = marker + section.split(end_marker, 1)[0]
    missing = [fact for fact in REQUIRED_SOURCE_FACTS if fact not in section]
    if missing:
        raise ValueError(f"battle-v1 source facts missing from section 21.8: {missing}")
    return section


def subsection(section: str, heading: str, next_heading: str | None) -> str:
    if section.count(heading) != 1:
        raise ValueError(f"Expected exactly one Battle source heading: {heading}")
    value = section.split(heading, 1)[1]
    if next_heading is not None:
        if next_heading not in value:
            raise ValueError(f"Missing Battle source heading after {heading}: {next_heading}")
        value = value.split(next_heading, 1)[0]
    return value


def table_rows(value: str) -> list[list[str]]:
    rows: list[list[str]] = []
    for line in value.splitlines():
        if not line.startswith("|"):
            continue
        cells = [cell.strip() for cell in line.strip().strip("|").split("|")]
        if not cells or all(re.fullmatch(r":?-+:?", cell.replace(" ", "")) for cell in cells):
            continue
        rows.append(cells)
    if len(rows) < 2:
        raise ValueError("Battle source table is missing rows")
    return rows[1:]


def parse_int(value: str) -> int:
    normalized = value.replace("+", "").replace("%", "").replace(" ", "")
    if re.fullmatch(r"-?[0-9]+", normalized) is None:
        raise ValueError(f"Expected Battle integer, got {value!r}")
    return int(normalized)


def parse_rarity_factors(section: str) -> list[dict[str, Any]]:
    source = section.split("五属性循环固定为：", 1)[1].split(
        "Battle 产品数据生成器只读取本节确定数据", 1
    )[0]
    rows = table_rows(source)
    factors = [
        {
            "rarity": RARITY_IDS[row[0]],
            "factor_bps": parse_int(row[1]),
            "target_budget": parse_int(row[2]),
        }
        for row in rows
    ]
    if [item["rarity"] for item in factors] != list(RARITY_IDS.values()):
        raise ValueError("Battle rarity factors are missing or out of order")
    for item in factors:
        if item["target_budget"] * 25 != item["factor_bps"]:
            raise ValueError(f"Battle rarity budget mismatch: {item}")
    return factors


def parse_profiles(section: str) -> list[dict[str, Any]]:
    source = subsection(
        section,
        "#### 21.8.1 14 个基础角色档案",
        "#### 21.8.2 进化后的精确整数四维",
    )
    profiles = []
    for row in table_rows(source):
        profile_id = parse_int(row[0])
        profiles.append(
            {
                "id": f"P{profile_id:02d}",
                "order": profile_id,
                "name": row[1],
                "base_hp": parse_int(row[2]),
                "base_attack": parse_int(row[3]),
                "base_defense": parse_int(row[4]),
                "base_speed": parse_int(row[5]),
                "loadout_id": row[6],
            }
        )
    if [item["order"] for item in profiles] != list(range(1, 15)):
        raise ValueError("Battle role profiles must be P01 through P14")
    if any(
        item["base_hp"] // 3
        + item["base_attack"]
        + item["base_defense"]
        + item["base_speed"]
        != 400
        for item in profiles
    ):
        raise ValueError("Every Battle role profile must have budget 400")
    return profiles


def parse_chain_configs(section: str) -> list[dict[str, Any]]:
    source = subsection(
        section,
        "#### 21.8.3 70 条链的属性与档案映射",
        "#### 21.8.4 10 个技能数值槽位",
    )
    configs = []
    for row in table_rows(source):
        profile_order = parse_int(row[0])
        for index, element_cn in enumerate(ELEMENT_ORDER, start=1):
            configs.append(
                {
                    "chain_id": row[index],
                    "element": ELEMENT_IDS[element_cn],
                    "profile_id": f"P{profile_order:02d}",
                }
            )
    if len(configs) != 70 or len({item["chain_id"] for item in configs}) != 70:
        raise ValueError("Battle chain mapping must contain 70 unique chains")
    return configs


def parse_skill_slots(section: str) -> list[dict[str, Any]]:
    source = subsection(
        section,
        "#### 21.8.4 10 个技能数值槽位",
        "#### 21.8.5 五属性技能名称",
    )
    rows = table_rows(source.split("五个属性使用完全相同的数值槽位", 1)[0])
    slots = [
        {
            "id": row[0],
            "power": parse_int(row[1]),
            "accuracy_bps": parse_int(row[2]),
            "priority": parse_int(row[4]),
            "trajectory": row[5],
        }
        for row in rows
    ]
    if [item["id"] for item in slots] != [f"S{i:02d}" for i in range(1, 11)]:
        raise ValueError("Battle skill slots must be S01 through S10")
    return slots


def parse_skills(section: str) -> list[dict[str, Any]]:
    source = subsection(
        section,
        "#### 21.8.5 五属性技能名称",
        "#### 21.8.6 14 组固定四技能组合",
    )
    skills = []
    for row in table_rows(source):
        slot_id = row[0]
        for index, element_cn in enumerate(ELEMENT_ORDER, start=1):
            element = ELEMENT_IDS[element_cn]
            skills.append(
                {
                    "id": f"{element}-{slot_id.lower()}",
                    "element": element,
                    "slot_id": slot_id,
                    "name": row[index],
                    "effect_key": f"{element}-{parse_int(slot_id[1:]):02d}",
                }
            )
    if len(skills) != 50:
        raise ValueError("Battle must define 50 skills")
    if len({item["name"] for item in skills}) != 50 or len(
        {item["effect_key"] for item in skills}
    ) != 50:
        raise ValueError("Battle skill names and effect keys must be unique")
    return skills


def parse_loadouts(section: str, slots: list[dict[str, Any]]) -> list[dict[str, Any]]:
    source = subsection(
        section,
        "#### 21.8.6 14 组固定四技能组合",
        "#### 21.8.7 确定伤害公式",
    )
    accuracy = {item["id"]: item["accuracy_bps"] for item in slots}
    loadouts = []
    for row in table_rows(source):
        slot_ids = [value.strip() for value in row[1].replace("、", ",").split(",")]
        loadouts.append({"id": row[0], "slot_ids": slot_ids})
    if [item["id"] for item in loadouts] != [f"L{i:02d}" for i in range(1, 15)]:
        raise ValueError("Battle loadouts must be L01 through L14")
    if any(len(item["slot_ids"]) != 4 for item in loadouts):
        raise ValueError("Every Battle loadout must contain four slots")
    if any(max(accuracy[slot] for slot in item["slot_ids"]) != 10000 for item in loadouts):
        raise ValueError("Every Battle loadout must contain a 100% accuracy skill")
    return loadouts


def stats_for(profile: dict[str, Any], factor_bps: int) -> dict[str, int]:
    attack = (profile["base_attack"] * factor_bps + 5000) // 10000
    defense = (profile["base_defense"] * factor_bps + 5000) // 10000
    speed = (profile["base_speed"] * factor_bps + 5000) // 10000
    hp = (1200 * factor_bps // 10000) - 3 * (attack + defense + speed)
    return {"hp": hp, "attack": attack, "defense": defense, "speed": speed}


def validate_template_configs(
    configs: list[dict[str, Any]],
    profiles: list[dict[str, Any]],
    factors: list[dict[str, Any]],
) -> None:
    if len(configs) != 210 or len({item["template_id"] for item in configs}) != 210:
        raise ValueError("Battle template configuration must cover 210 unique templates")
    factor_by_rarity = {item["rarity"]: item for item in factors}
    for item in configs:
        stats = item["stats"]
        if any(value <= 0 for value in stats.values()):
            raise ValueError(f"Battle template stats must be positive: {item['template_id']}")
        budget = stats["hp"] // 3 + stats["attack"] + stats["defense"] + stats["speed"]
        if budget != factor_by_rarity[item["rarity"]]["target_budget"]:
            raise ValueError(f"Battle template budget mismatch: {item['template_id']}")
        if len(item["skill_ids"]) != 4:
            raise ValueError(f"Battle template must have four skills: {item['template_id']}")
    profile_by_id = {item["id"]: item for item in profiles}
    for profile_id, profile in profile_by_id.items():
        prior: dict[str, int] | None = None
        for rarity in RARITY_IDS.values():
            current = stats_for(profile, factor_by_rarity[rarity]["factor_bps"])
            if prior is not None and any(current[key] <= prior[key] for key in current):
                raise ValueError(f"Battle profile stats must strictly rise: {profile_id}/{rarity}")
            prior = current
    by_chain: dict[str, list[dict[str, Any]]] = {}
    for item in configs:
        by_chain.setdefault(item["chain_id"], []).append(item)
    if len(by_chain) != 70 or any(len(items) != 3 for items in by_chain.values()):
        raise ValueError("Every Battle chain must contain exactly three templates")
    for chain_id, items in by_chain.items():
        if len({item["element"] for item in items}) != 1 or len(
            {tuple(item["skill_ids"]) for item in items}
        ) != 1:
            raise ValueError(f"Battle chain element/loadout drift: {chain_id}")
    element_chains = {
        element: len({item["chain_id"] for item in configs if item["element"] == element})
        for element in ELEMENT_IDS.values()
    }
    element_templates = {
        element: sum(item["element"] == element for item in configs)
        for element in ELEMENT_IDS.values()
    }
    if set(element_chains.values()) != {14} or set(element_templates.values()) != {42}:
        raise ValueError("Battle elements must each map 14 chains and 42 templates")


def parse(
    product_extensions: str,
    catalog_chains: list[dict[str, Any]],
    catalog_templates: list[dict[str, Any]],
) -> dict[str, Any]:
    section = section_21_8(product_extensions)
    factors = parse_rarity_factors(section)
    profiles = parse_profiles(section)
    chain_configs = parse_chain_configs(section)
    slots = parse_skill_slots(section)
    skills = parse_skills(section)
    loadouts = parse_loadouts(section, slots)
    catalog_chain_ids = {item["id"] for item in catalog_chains}
    if {item["chain_id"] for item in chain_configs} != catalog_chain_ids:
        raise ValueError("Battle chain mapping does not exactly match Catalog v1")
    factors_by_rarity = {item["rarity"]: item["factor_bps"] for item in factors}
    profiles_by_id = {item["id"]: item for item in profiles}
    chains_by_id = {item["chain_id"]: item for item in chain_configs}
    loadouts_by_id = {item["id"]: item["slot_ids"] for item in loadouts}
    template_configs = []
    for template in catalog_templates:
        chain = chains_by_id[template["chain_id"]]
        profile = profiles_by_id[chain["profile_id"]]
        slot_ids = loadouts_by_id[profile["loadout_id"]]
        element = chain["element"]
        template_configs.append(
            {
                "template_id": template["id"],
                "chain_id": template["chain_id"],
                "stage": template["stage"],
                "rarity": template["rarity"],
                "element": element,
                "profile_id": profile["id"],
                "stats": stats_for(profile, factors_by_rarity[template["rarity"]]),
                "skill_ids": [f"{element}-{slot.lower()}" for slot in slot_ids],
            }
        )
    validate_template_configs(template_configs, profiles, factors)
    type_matchups = []
    for attacker_index, attacker_cn in enumerate(ELEMENT_ORDER):
        for defender_index, defender_cn in enumerate(ELEMENT_ORDER):
            if defender_index == (attacker_index + 1) % len(ELEMENT_ORDER):
                multiplier_bps = 15000
            elif attacker_index == (defender_index + 1) % len(ELEMENT_ORDER):
                multiplier_bps = 7500
            else:
                multiplier_bps = 10000
            type_matchups.append(
                {
                    "attacker": ELEMENT_IDS[attacker_cn],
                    "defender": ELEMENT_IDS[defender_cn],
                    "multiplier_bps": multiplier_bps,
                }
            )
    payload = {
        "version": VERSION,
        "source": "docs/product/功能说明文档.md#218-battle-v1-规则快照",
        "elements": [
            {"id": element_id, "name": element_cn, "order": order}
            for order, (element_cn, element_id) in enumerate(ELEMENT_IDS.items(), start=1)
        ],
        "room_states": list(ROOM_STATES),
        "rule_parameters": RULE_PARAMETERS,
        "entry_tiers": list(ENTRY_TIERS),
        "rate_limits": list(RATE_LIMITS),
        "outbox_retry_seconds": list(OUTBOX_RETRY_SECONDS),
        "rarity_factors": factors,
        "type_matchups": type_matchups,
        "skill_slots": slots,
        "skills": skills,
        "role_profiles": profiles,
        "profile_loadouts": loadouts,
        "chain_configs": chain_configs,
        "template_configs": template_configs,
        "damage_formula": {
            "raw": "floor(2*P*A*A*T_bps/((A+D)*100*10000))",
            "single_hit_cap": "max(1,floor(defender_max_hp*80/100))",
            "damage": "min(single_hit_cap,max(1,raw_damage))",
        },
        "random_formula": {
            "algorithm": "HMAC-SHA256",
            "message": "battle_id|turn_no|actor_side|action_ordinal|skill_id",
            "roll": "unsigned_first_32_bits_mod_10000",
        },
    }
    return payload


def json_bytes(payload: dict[str, Any]) -> bytes:
    lines = json.dumps(
        payload, ensure_ascii=False, indent=2, sort_keys=True
    ).splitlines()
    formatted: list[str] = []
    index = 0
    while index < len(lines):
        line = lines[index]
        if line.rstrip().endswith("["):
            closing = index + 1
            values: list[Any] = []
            while closing < len(lines):
                stripped = lines[closing].strip()
                if stripped in ("]", "],"):
                    break
                try:
                    values.append(json.loads(stripped.removesuffix(",")))
                except json.JSONDecodeError:
                    values = []
                    break
                if isinstance(values[-1], (dict, list)):
                    values = []
                    break
                closing += 1
            if values and closing < len(lines):
                compact = json.dumps(values, ensure_ascii=False, separators=(", ", ": "))
                suffix = "," if lines[closing].strip() == "]," else ""
                candidate = line.rstrip()[:-1] + compact + suffix
                if len(candidate) <= 80:
                    formatted.append(candidate)
                    index = closing + 1
                    continue
        formatted.append(line)
        index += 1
    return ("\n".join(formatted) + "\n").encode("utf-8")


def checksum(payload: dict[str, Any]) -> str:
    return hashlib.sha256(json_bytes(payload)).hexdigest()


def manifest(payload: dict[str, Any]) -> dict[str, Any]:
    return {
        "version": VERSION,
        "artifact": "battle-v1.json",
        "sha256": checksum(payload),
        "counts": {
            "elements": len(payload["elements"]),
            "entry_tiers": len(payload["entry_tiers"]),
            "rarity_factors": len(payload["rarity_factors"]),
            "type_matchups": len(payload["type_matchups"]),
            "skill_slots": len(payload["skill_slots"]),
            "skills": len(payload["skills"]),
            "role_profiles": len(payload["role_profiles"]),
            "profile_loadouts": len(payload["profile_loadouts"]),
            "chains": len(payload["chain_configs"]),
            "templates": len(payload["template_configs"]),
        },
    }


def json_literal(value: Any) -> str:
    return sql_string(json.dumps(value, ensure_ascii=False, separators=(",", ":"), sort_keys=True)) + "::jsonb"


def render(payload: dict[str, Any]) -> str:
    rules_checksum = checksum(payload)
    parameters = payload["rule_parameters"] | {
        "outbox_retry_seconds": payload["outbox_retry_seconds"]
    }
    sections = [
        f"-- Battle rules checksum: {rules_checksum}\n",
        """insert into battle.rulesets (
  id, checksum, status, parameters, source_version
) values (
  'battle-v1',
  """,
        sql_string(rules_checksum),
        ",\n  'active',\n  ",
        json_literal(parameters),
        ",\n  'v1'\n);\n\n",
    ]
    tier_values = ",\n".join(
        "  ("
        + ", ".join(
            [
                sql_string(VERSION),
                sql_string(item["id"]),
                str(item["entry_fee"]),
                str(item["pool"]),
                str(item["winner_payout"]),
                str(item["fee"]),
            ]
        )
        + ")"
        for item in payload["entry_tiers"]
    )
    sections.append(
        "insert into battle.entry_tiers "
        "(ruleset_id, id, entry_fee, pool, winner_payout, fee) values\n"
        + tier_values
        + ";\n\n"
    )
    rarity_values = ",\n".join(
        "  ("
        + ", ".join(
            [
                sql_string(VERSION),
                sql_string(item["rarity"]),
                str(item["factor_bps"]),
                str(item["target_budget"]),
            ]
        )
        + ")"
        for item in payload["rarity_factors"]
    )
    sections.append(
        "insert into battle.rarity_factors "
        "(ruleset_id, rarity, factor_bps, target_budget) values\n"
        + rarity_values
        + ";\n\n"
    )
    matchup_values = ",\n".join(
        "  ("
        + ", ".join(
            [
                sql_string(VERSION),
                sql_string(item["attacker"]),
                sql_string(item["defender"]),
                str(item["multiplier_bps"]),
            ]
        )
        + ")"
        for item in payload["type_matchups"]
    )
    sections.append(
        "insert into battle.type_matchups "
        "(ruleset_id, attacker, defender, multiplier_bps) values\n"
        + matchup_values
        + ";\n\n"
    )
    slot_values = ",\n".join(
        "  ("
        + ", ".join(
            [
                sql_string(VERSION),
                sql_string(item["id"]),
                str(item["power"]),
                str(item["accuracy_bps"]),
                str(item["priority"]),
                sql_string(item["trajectory"]),
            ]
        )
        + ")"
        for item in payload["skill_slots"]
    )
    sections.append(
        "insert into battle.skill_slots "
        "(ruleset_id, id, power, accuracy_bps, priority, trajectory) values\n"
        + slot_values
        + ";\n\n"
    )
    skill_values = ",\n".join(
        "  ("
        + ", ".join(
            [
                sql_string(VERSION),
                sql_string(item["id"]),
                sql_string(item["element"]),
                sql_string(item["slot_id"]),
                sql_string(item["name"]),
                sql_string(item["effect_key"]),
            ]
        )
        + ")"
        for item in payload["skills"]
    )
    sections.append(
        "insert into battle.skills "
        "(ruleset_id, id, element, slot_id, name, effect_key) values\n"
        + skill_values
        + ";\n\n"
    )
    profile_values = ",\n".join(
        "  ("
        + ", ".join(
            [
                sql_string(VERSION),
                sql_string(item["id"]),
                str(item["order"]),
                sql_string(item["name"]),
                str(item["base_hp"]),
                str(item["base_attack"]),
                str(item["base_defense"]),
                str(item["base_speed"]),
                sql_string(item["loadout_id"]),
            ]
        )
        + ")"
        for item in payload["role_profiles"]
    )
    sections.append(
        "insert into battle.role_profiles "
        "(ruleset_id, id, sort_order, name, base_hp, base_attack, base_defense, base_speed, loadout_id) values\n"
        + profile_values
        + ";\n\n"
    )
    loadout_values = ",\n".join(
        "  ("
        + ", ".join(
            [
                sql_string(VERSION),
                sql_string(item["id"]),
                str(position),
                sql_string(slot_id),
            ]
        )
        + ")"
        for item in payload["profile_loadouts"]
        for position, slot_id in enumerate(item["slot_ids"], start=1)
    )
    sections.append(
        "insert into battle.profile_loadouts "
        "(ruleset_id, loadout_id, position, slot_id) values\n"
        + loadout_values
        + ";\n\n"
    )
    chain_values = ",\n".join(
        "  ("
        + ", ".join(
            [
                sql_string(VERSION),
                sql_string(item["chain_id"]),
                sql_string(item["element"]),
                sql_string(item["profile_id"]),
            ]
        )
        + ")"
        for item in payload["chain_configs"]
    )
    sections.append(
        "insert into battle.chain_configs "
        "(ruleset_id, chain_id, element, profile_id) values\n"
        + chain_values
        + ";\n\n"
    )
    template_values = ",\n".join(
        "  ("
        + ", ".join(
            [
                sql_string(VERSION),
                sql_string(item["template_id"]),
                sql_string(item["chain_id"]),
                str(item["stage"]),
                sql_string(item["rarity"]),
                sql_string(item["element"]),
                sql_string(item["profile_id"]),
                str(item["stats"]["hp"]),
                str(item["stats"]["attack"]),
                str(item["stats"]["defense"]),
                str(item["stats"]["speed"]),
                sql_string(item["skill_ids"][0]),
                sql_string(item["skill_ids"][1]),
                sql_string(item["skill_ids"][2]),
                sql_string(item["skill_ids"][3]),
            ]
        )
        + ")"
        for item in payload["template_configs"]
    )
    sections.append(
        "insert into battle.template_configs "
        "(ruleset_id, template_id, chain_id, stage, rarity, element, profile_id, "
        "max_hp, attack, defense, speed, skill_1_id, skill_2_id, skill_3_id, skill_4_id) values\n"
        + template_values
        + ";\n"
    )
    return "".join(sections)
