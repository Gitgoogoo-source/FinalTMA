"""Render the nineteen frozen task definitions."""

from catalog import sql_string


TASKS = [
    ("gacha_1", 1, "gacha", "今日开盒 1 次", "当日完成 1 次付费单抽或免费资格单抽", "gacha_single", 1, 20),
    ("gacha_10", 2, "gacha", "今日开盒 10 次", "当日累计完成 10 次付费单抽或免费资格单抽", "gacha_single", 10, 80),
    ("gacha_ten", 3, "gacha", "完成 1 次十连", "当日一次十连整批成功", "gacha_ten", 1, 50),
    ("wheel_spin", 4, "daily", "每日转动转盘 1 次", "当日单次转盘或十次转盘整批成功", "wheel", 1, 15),
    ("copy_referral", 5, "social", "复制邀请链接", "当日复制邀请链接成功且任务结果获得确认", "referral_copy", 1, 5),
    ("telegram_invite", 6, "social", "点击 Telegram 邀请", "当日成功打开 Telegram 原生分享弹窗", "referral_telegram", 1, 10),
    ("market_buy", 7, "market", "市场购买 1 次", "当日市场购买整笔成功", "market_buy", 1, 20),
    ("market_list", 8, "market", "创建出售 1 次", "当日创建出售整笔成功", "market_sell", 1, 20),
    ("market_sold", 9, "market", "成功卖出 1 次", "当日出售藏品产生真实成交", "market_manage", 1, 30),
    ("evolution_success", 10, "inventory", "进化成功 1 次", "当日进化结算为成功", "inventory_evolution", 1, 30),
    ("evolution_attempt", 11, "inventory", "尝试进化 1 次", "当日进化完成成功或失败结算；前置拒绝不计", "inventory_evolution", 1, 10),
    ("decompose", 12, "inventory", "分解成功 1 次", "当日分解整笔成功", "inventory_decomposition", 1, 20),
    ("expedition_normal", 13, "expedition", "完成 1 次普通远征", "当日普通远征奖励领取成功", "expedition_normal", 1, 15),
    ("expedition_intermediate", 14, "expedition", "完成 1 次中级远征", "当日中级远征奖励领取成功", "expedition_intermediate", 1, 25),
    ("expedition_advanced", 15, "expedition", "完成 1 次高级远征", "当日高级远征奖励领取成功", "expedition_advanced", 1, 40),
    ("album_unlock", 16, "album", "解锁 1 个新图鉴", "当日首次永久解锁 1 个此前未解锁的藏品模板", "album", 1, 30),
    ("album_chain", 17, "album", "完成 1 条图鉴链", "当日首次永久完成 1 条三节点图鉴链", "album", 1, 100),
    ("wallet_verified", 18, "wallet", "钱包验证成功", "当日新完成一次钱包验证", "wallet", 1, 50),
    ("mint_success", 19, "mint", "上链成功", "当日 Mint 链上成功结果获得确认", "inventory_mint", 1, 100),
]


def render() -> str:
    values = ",\n".join(
        "  (" + ", ".join([sql_string(code), str(order), sql_string(category), sql_string(title), sql_string(description), sql_string(completion_action), str(target), str(reward)]) + ")"
        for code, order, category, title, description, completion_action, target, reward in TASKS
    )
    return f"""insert into tasks.definitions (code, sort_order, category, title, description, completion_action, target, reward_fgems) values
{values};
"""
