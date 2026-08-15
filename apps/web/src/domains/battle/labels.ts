import type {
  BattleEntryTier,
  BattleRoomStatus,
  BattleTerminalResultDto,
} from "@pokepets/api-contracts/app-client";
import { localized } from "../../platform/i18n/index.ts";

export const battleRarityLabels = localized({
  common: "普通",
  rare: "稀有",
  epic: "史诗",
  legendary: "传说",
  mythic: "神话",
} as const);

export const battleArenaTierLabels = localized({
  "tier-20": {
    name: "新手峡谷",
    rarity: "普通",
    rarityGems: 1,
  },
  "tier-100": {
    name: "熔岩遗迹",
    rarity: "稀有",
    rarityGems: 2,
  },
  "tier-500": {
    name: "冠军火山",
    rarity: "史诗",
    rarityGems: 3,
  },
} as const satisfies Record<
  BattleEntryTier["id"],
  {
    name: string;
    rarity: string;
    rarityGems: number;
  }
>);

export const battleElementLabels = localized({
  fire: "火焰",
  grass: "草系",
  earth: "土系",
  lightning: "雷电",
  water: "水系",
} as const);

export const battleStatusLabels: Record<BattleRoomStatus, string> = localized({
  preparing_share: "正在准备挑战卡",
  waiting: "等待对手接受",
  lobby_waiting: "等待双方进入房间",
  lobby_countdown: "开战倒计时",
  active_turn: "轮到当前玩家行动",
  finished: "战斗已结束",
  draw: "战斗平局",
  cancelled: "挑战已取消",
  expired: "挑战已过期",
  voided: "战斗已安全作废",
});

export const battleResultLabels: Record<
  BattleTerminalResultDto["result"],
  string
> = localized({
  win: "胜利",
  loss: "失败",
  draw: "平局",
  void: "安全作废",
});

export function tierTitle(tier: BattleEntryTier): string {
  return `${tier.entry_fee} K-coin`;
}

export function formatBattleTime(seconds: number | null): string {
  if (seconds === null) return "--:--";
  const minutes = Math.floor(seconds / 60);
  const rest = seconds % 60;
  return `${String(minutes).padStart(2, "0")}:${String(rest).padStart(2, "0")}`;
}
