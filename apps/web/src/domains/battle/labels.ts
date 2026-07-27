import type {
  BattleCurrentResult,
  BattleEntryTier,
  BattleRoomStatus,
} from "@pokepets/api-contracts/app";

export const battleRarityLabels = {
  common: "普通",
  rare: "稀有",
  epic: "史诗",
  legendary: "传说",
  mythic: "神话",
} as const;

export const battleElementLabels = {
  fire: "火焰",
  grass: "草系",
  earth: "土系",
  lightning: "雷电",
  water: "水系",
} as const;

export const battleStatusLabels: Record<BattleRoomStatus, string> = {
  preparing_share: "正在准备挑战卡",
  waiting: "等待对手接受",
  active_select: "选择本回合动作",
  reveal: "回合结算展示",
  forced_switch: "强制换宠",
  finished: "战斗已结束",
  draw: "战斗平局",
  cancelled: "挑战已取消",
  expired: "挑战已过期",
  voided: "战斗已安全作废",
};

export const battleResultLabels: Record<BattleCurrentResult["result"], string> =
  {
    win: "胜利",
    loss: "失败",
    draw: "平局",
    void: "安全作废",
  };

export function tierTitle(tier: BattleEntryTier): string {
  return `${tier.entry_fee} K-coin`;
}

export function formatBattleTime(seconds: number | null): string {
  if (seconds === null) return "--:--";
  const minutes = Math.floor(seconds / 60);
  const rest = seconds % 60;
  return `${String(minutes).padStart(2, "0")}:${String(rest).padStart(2, "0")}`;
}
