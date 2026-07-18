#!/usr/bin/env python3
"""Build the immutable catalog v1 SQL from the product document."""

from __future__ import annotations

import argparse
import hashlib
import json
import re
from pathlib import Path


ROOT = Path(__file__).resolve().parents[2]
PRODUCT = ROOT / "docs/product/功能说明文档.md"
MIGRATION = ROOT / "supabase/migrations/20260718182513_catalog_v1.sql"
MANIFEST = ROOT / "generated/catalog/catalog-v1.json"
PLACEHOLDERS = ROOT / "generated/assets/placeholders.json"
ASSET_ROOT = ROOT / "apps/web/public/assets"

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
EXPECTED_RARITIES = {"common": 40, "rare": 60, "epic": 70, "legendary": 30, "mythic": 10}
TASKS = [
    ("gacha_1", 1, "gacha", "今日开盒 1 次", 1, 20),
    ("gacha_10", 2, "gacha", "今日开盒 10 次", 10, 80),
    ("gacha_ten", 3, "gacha", "完成 1 次十连", 1, 50),
    ("wheel_spin", 4, "daily", "每日转动转盘 1 次", 1, 15),
    ("copy_referral", 5, "social", "复制邀请链接", 1, 5),
    ("telegram_invite", 6, "social", "点击 Telegram 邀请", 1, 10),
    ("market_buy", 7, "market", "市场购买 1 次", 1, 20),
    ("market_list", 8, "market", "创建出售 1 次", 1, 20),
    ("market_sold", 9, "market", "成功卖出 1 次", 1, 30),
    ("evolution_success", 10, "inventory", "进化成功 1 次", 1, 30),
    ("evolution_attempt", 11, "inventory", "尝试进化 1 次", 1, 10),
    ("decompose", 12, "inventory", "分解成功 1 次", 1, 20),
    ("expedition_normal", 13, "expedition", "完成 1 次普通远征", 1, 15),
    ("expedition_intermediate", 14, "expedition", "完成 1 次中级远征", 1, 25),
    ("expedition_advanced", 15, "expedition", "完成 1 次高级远征", 1, 40),
    ("album_unlock", 16, "album", "解锁 1 个新图鉴", 1, 30),
    ("album_chain", 17, "album", "完成 1 条图鉴链", 1, 100),
    ("wallet_verified", 18, "wallet", "钱包验证成功", 1, 50),
    ("mint_success", 19, "mint", "上链成功", 1, 100),
]


def parse_catalog(markdown: str) -> tuple[list[dict[str, object]], list[dict[str, object]]]:
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
            power = combat_power(chain_type, chain_index, stage)
            templates.append({
                "id": template_id,
                "chain_id": chain_id,
                "stage": stage,
                "rarity": rarities[stage],
                "name": name,
                "sort_order": (global_order - 1) * 3 + stage,
                "combat_power": power,
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


def build_sql(chains: list[dict[str, object]], templates: list[dict[str, object]], checksum: str) -> str:
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
    task_values = ",\n".join(
        "  (" + ", ".join([sql_string(code), str(order), sql_string(category), sql_string(name), str(target), str(reward)]) + ")"
        for code, order, category, name, target, reward in TASKS
    )
    return f"""-- Generated by python3 tools/catalog/build.py. Do not hand edit.
-- Product checksum: {checksum}

insert into catalog.chains (id, global_order, chain_type, theme, continuity, catalog_version) values
{chain_values};

insert into catalog.templates (id, chain_id, stage, rarity, name, sort_order, combat_power, market_price, decompose_fgems, expedition_fgems, image_path, draw_weight, catalog_version) values
{template_values};

insert into catalog.boxes (tier, display_name, image_path, single_price, ten_price, pity_limit, pity_rarity, rarity_weights) values
  ('normal', '普通盲盒', '/assets/boxes/normal.webp', 9, 81, 50, 'rare', '{{"common":7200,"rare":2500,"epic":300,"legendary":0,"mythic":0}}'),
  ('rare', '稀有盲盒', '/assets/boxes/rare.webp', 40, 360, 30, 'epic', '{{"common":2000,"rare":5500,"epic":2200,"legendary":300,"mythic":0}}'),
  ('legendary', '传说盲盒', '/assets/boxes/legendary.webp', 120, 1080, 15, 'legendary', '{{"common":0,"rare":1800,"epic":5500,"legendary":2400,"mythic":300}}');

insert into catalog.topup_products (amount, sort_order) values (50, 1), (500, 2), (1000, 3), (5000, 4), (10000, 5);

insert into tasks.definitions (code, sort_order, category, display_name, target, reward_fgems) values
{task_values};
"""


def asset_files(templates: list[dict[str, object]]) -> list[Path]:
    required = [ROOT / "apps/web/public" / str(item["image_path"]).lstrip("/") for item in templates]
    required += [
        ASSET_ROOT / "boxes/normal.webp",
        ASSET_ROOT / "boxes/rare.webp",
        ASSET_ROOT / "boxes/legendary.webp",
        ASSET_ROOT / "share/preview.webp",
        ASSET_ROOT / "ton/tonconnect-icon.png",
    ]
    return required


def pin_assets(templates: list[dict[str, object]]) -> dict[str, str]:
    required = asset_files(templates)
    missing = [str(path.relative_to(ROOT)) for path in required if not path.is_file() or path.stat().st_size == 0]
    if missing:
        raise SystemExit("Missing required assets:\n" + "\n".join(missing))
    pinned = {str(path.relative_to(ROOT)): hashlib.sha256(path.read_bytes()).hexdigest() for path in required}
    placeholder_manifest = json.loads(PLACEHOLDERS.read_text(encoding="utf-8")) if PLACEHOLDERS.is_file() else {}
    forbidden = set(placeholder_manifest.get("files", {}).values())
    placeholders = sorted(name for name, value in pinned.items() if value in forbidden)
    if placeholders:
        raise SystemExit("Cannot pin development placeholders as production assets:\n" + "\n".join(placeholders))
    return pinned


def check_assets(templates: list[dict[str, object]], expected: object) -> None:
    required = asset_files(templates)
    if not isinstance(expected, dict) or set(expected) != {str(path.relative_to(ROOT)) for path in required}:
        raise SystemExit("Asset checksums are not pinned. Run catalog build with --pin-assets after uploading all official assets.")
    mismatched = []
    for path in required:
        name = str(path.relative_to(ROOT))
        actual = hashlib.sha256(path.read_bytes()).hexdigest() if path.is_file() and path.stat().st_size > 0 else None
        if actual != expected[name]:
            mismatched.append(name)
    if mismatched:
        raise SystemExit("Missing or checksum-mismatched assets:\n" + "\n".join(mismatched))


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--check-assets", action="store_true")
    parser.add_argument("--pin-assets", action="store_true")
    parser.add_argument("--migration-path", type=Path, default=MIGRATION)
    parser.add_argument("--manifest-path", type=Path, default=MANIFEST)
    args = parser.parse_args()
    if args.check_assets and args.pin_assets:
        raise SystemExit("Choose either --check-assets or --pin-assets")
    markdown = PRODUCT.read_text(encoding="utf-8")
    checksum = hashlib.sha256(markdown.encode()).hexdigest()
    chains, templates = parse_catalog(markdown)
    args.migration_path.parent.mkdir(parents=True, exist_ok=True)
    args.manifest_path.parent.mkdir(parents=True, exist_ok=True)
    args.migration_path.write_text(build_sql(chains, templates, checksum), encoding="utf-8")
    previous = json.loads(args.manifest_path.read_text(encoding="utf-8")) if args.manifest_path.is_file() else {}
    assets = previous.get("assets", {}) if previous.get("product_checksum") == checksum else {}
    if args.pin_assets:
        assets = pin_assets(templates)
    args.manifest_path.write_text(json.dumps({"version": "v1", "product_checksum": checksum, "chains": chains, "templates": templates, "assets": assets}, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    if args.check_assets:
        check_assets(templates, assets)
    print(f"catalog v1: {len(chains)} chains, {len(templates)} templates, {checksum}")


if __name__ == "__main__":
    main()
