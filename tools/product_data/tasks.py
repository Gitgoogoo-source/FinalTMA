"""Render the nineteen frozen task definitions."""

from catalog import sql_string


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


def render() -> str:
    values = ",\n".join(
        "  (" + ", ".join([sql_string(code), str(order), sql_string(category), sql_string(name), str(target), str(reward)]) + ")"
        for code, order, category, name, target, reward in TASKS
    )
    return f"""insert into tasks.definitions (code, sort_order, category, display_name, target, reward_fgems) values
{values};
"""
