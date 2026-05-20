/**
 * 藏品稀有度枚举与展示常量。
 *
 * 注意：
 * 1. 这里的 rank / sortOrder 只用于排序和展示。
 * 2. 保底是否命中、抽卡概率、奖励发放，必须由后端 RPC 和数据库规则决定。
 */

export const RARITY = {
  COMMON: "COMMON",
  RARE: "RARE",
  EPIC: "EPIC",
  LEGENDARY: "LEGENDARY"
} as const;

export type RarityCode = (typeof RARITY)[keyof typeof RARITY];

export type RarityTone = "gray" | "blue" | "purple" | "orange";

export interface RarityMeta {
  code: RarityCode;
  displayNameCn: string;
  displayNameEn: string;
  shortLabel: string;
  rank: number;
  sortOrder: number;
  tone: RarityTone;
  colorToken: string;
  badgeToken: string;

  /**
   * 是否通常可作为保底目标。
   * 最终保底规则仍以后端 gacha.pity_rules 为准。
   */
  defaultCanBePityTarget: boolean;

  /**
   * 是否通常参与排行榜稀有度加分。
   * 最终榜单分数仍以后端 album.score_rules 为准。
   */
  defaultCanScoreInLeaderboard: boolean;

  description: string;
}

export const RARITY_META = {
  [RARITY.COMMON]: {
    code: RARITY.COMMON,
    displayNameCn: "普通",
    displayNameEn: "Common",
    shortLabel: "Common",
    rank: 10,
    sortOrder: 10,
    tone: "gray",
    colorToken: "rarity-common",
    badgeToken: "badge-rarity-common",
    defaultCanBePityTarget: false,
    defaultCanScoreInLeaderboard: false,
    description: "基础稀有度，常见藏品。"
  },

  [RARITY.RARE]: {
    code: RARITY.RARE,
    displayNameCn: "稀有",
    displayNameEn: "Rare",
    shortLabel: "Rare",
    rank: 20,
    sortOrder: 20,
    tone: "blue",
    colorToken: "rarity-rare",
    badgeToken: "badge-rarity-rare",
    defaultCanBePityTarget: false,
    defaultCanScoreInLeaderboard: true,
    description: "较低概率获得的藏品。"
  },

  [RARITY.EPIC]: {
    code: RARITY.EPIC,
    displayNameCn: "史诗",
    displayNameEn: "Epic",
    shortLabel: "Epic",
    rank: 30,
    sortOrder: 30,
    tone: "purple",
    colorToken: "rarity-epic",
    badgeToken: "badge-rarity-epic",
    defaultCanBePityTarget: true,
    defaultCanScoreInLeaderboard: true,
    description: "高价值藏品，通常用于保底、市场交易和图鉴榜加分。"
  },

  [RARITY.LEGENDARY]: {
    code: RARITY.LEGENDARY,
    displayNameCn: "传说",
    displayNameEn: "Legendary",
    shortLabel: "Legendary",
    rank: 40,
    sortOrder: 40,
    tone: "orange",
    colorToken: "rarity-legendary",
    badgeToken: "badge-rarity-legendary",
    defaultCanBePityTarget: true,
    defaultCanScoreInLeaderboard: true,
    description: "最高常规稀有度，通常具有更高收藏价值、交易价值和排行榜权重。"
  }
} as const satisfies Record<RarityCode, RarityMeta>;

export const RARITY_CODES = Object.values(RARITY) as RarityCode[];

export const RARITY_CODES_BY_ASC = [...RARITY_CODES].sort(
  (a, b) => RARITY_META[a].sortOrder - RARITY_META[b].sortOrder
);

export const RARITY_CODES_BY_DESC = [...RARITY_CODES_BY_ASC].reverse();

export function isRarityCode(value: unknown): value is RarityCode {
  return (
    typeof value === "string" &&
    (RARITY_CODES as readonly string[]).includes(value)
  );
}

export function assertRarityCode(value: unknown): asserts value is RarityCode {
  if (!isRarityCode(value)) {
    throw new Error(`Invalid rarity code: ${String(value)}`);
  }
}

export function getRarityMeta(code: RarityCode): RarityMeta {
  return RARITY_META[code];
}

export function getRarityDisplayName(
  code: RarityCode,
  locale: "zh-CN" | "en-US" = "zh-CN"
): string {
  const meta = getRarityMeta(code);
  return locale === "en-US" ? meta.displayNameEn : meta.displayNameCn;
}

export function getRarityRank(code: RarityCode): number {
  return RARITY_META[code].rank;
}

export function compareRarity(a: RarityCode, b: RarityCode): number {
  return getRarityRank(a) - getRarityRank(b);
}

export function sortRarityCodes(
  codes: readonly RarityCode[],
  direction: "asc" | "desc" = "asc"
): RarityCode[] {
  const sorted = [...codes].sort(compareRarity);
  return direction === "desc" ? sorted.reverse() : sorted;
}