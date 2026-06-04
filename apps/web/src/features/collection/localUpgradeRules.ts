import type {
  CollectionInventoryItem,
  CollectionUpgradePreview,
} from "./collection.types";

type BaseUpgradeRule = {
  fromLevel: number;
  costFgems: number;
  powerGain: number;
};

type RarityUpgradeMultiplier = {
  cost: number;
  growth: number;
};

const MAX_LOCAL_UPGRADE_LEVEL = 100;

const RARITY_UPGRADE_MULTIPLIERS: Record<string, RarityUpgradeMultiplier> = {
  common: {
    cost: 1,
    growth: 1,
  },
  epic: {
    cost: 1.55,
    growth: 1.38,
  },
  legendary: {
    cost: 2.1,
    growth: 1.75,
  },
  mythic: {
    cost: 2.1,
    growth: 1.75,
  },
  rare: {
    cost: 1.2,
    growth: 1.16,
  },
};

const BASE_UPGRADE_RULES: BaseUpgradeRule[] = [
  { fromLevel: 1, costFgems: 70, powerGain: 5 },
  { fromLevel: 2, costFgems: 80, powerGain: 5 },
  { fromLevel: 3, costFgems: 90, powerGain: 5 },
  { fromLevel: 4, costFgems: 100, powerGain: 5 },
  { fromLevel: 5, costFgems: 110, powerGain: 5 },
  { fromLevel: 6, costFgems: 130, powerGain: 5 },
  { fromLevel: 7, costFgems: 140, powerGain: 5 },
  { fromLevel: 8, costFgems: 160, powerGain: 6 },
  { fromLevel: 9, costFgems: 180, powerGain: 6 },
  { fromLevel: 10, costFgems: 200, powerGain: 6 },
  { fromLevel: 11, costFgems: 210, powerGain: 6 },
  { fromLevel: 12, costFgems: 240, powerGain: 6 },
  { fromLevel: 13, costFgems: 260, powerGain: 6 },
  { fromLevel: 14, costFgems: 280, powerGain: 6 },
  { fromLevel: 15, costFgems: 300, powerGain: 7 },
  { fromLevel: 16, costFgems: 330, powerGain: 7 },
  { fromLevel: 17, costFgems: 360, powerGain: 7 },
  { fromLevel: 18, costFgems: 390, powerGain: 7 },
  { fromLevel: 19, costFgems: 410, powerGain: 8 },
  { fromLevel: 20, costFgems: 440, powerGain: 8 },
  { fromLevel: 21, costFgems: 480, powerGain: 8 },
  { fromLevel: 22, costFgems: 510, powerGain: 8 },
  { fromLevel: 23, costFgems: 540, powerGain: 8 },
  { fromLevel: 24, costFgems: 580, powerGain: 8 },
  { fromLevel: 25, costFgems: 610, powerGain: 9 },
  { fromLevel: 26, costFgems: 650, powerGain: 9 },
  { fromLevel: 27, costFgems: 690, powerGain: 9 },
  { fromLevel: 28, costFgems: 730, powerGain: 9 },
  { fromLevel: 29, costFgems: 760, powerGain: 10 },
  { fromLevel: 30, costFgems: 800, powerGain: 10 },
  { fromLevel: 31, costFgems: 850, powerGain: 10 },
  { fromLevel: 32, costFgems: 890, powerGain: 10 },
  { fromLevel: 33, costFgems: 930, powerGain: 11 },
  { fromLevel: 34, costFgems: 980, powerGain: 11 },
  { fromLevel: 35, costFgems: 1020, powerGain: 11 },
  { fromLevel: 36, costFgems: 1070, powerGain: 12 },
  { fromLevel: 37, costFgems: 1120, powerGain: 12 },
  { fromLevel: 38, costFgems: 1160, powerGain: 12 },
  { fromLevel: 39, costFgems: 1210, powerGain: 13 },
  { fromLevel: 40, costFgems: 1260, powerGain: 13 },
  { fromLevel: 41, costFgems: 1310, powerGain: 13 },
  { fromLevel: 42, costFgems: 1370, powerGain: 14 },
  { fromLevel: 43, costFgems: 1420, powerGain: 14 },
  { fromLevel: 44, costFgems: 1470, powerGain: 14 },
  { fromLevel: 45, costFgems: 1530, powerGain: 15 },
  { fromLevel: 46, costFgems: 1580, powerGain: 15 },
  { fromLevel: 47, costFgems: 1640, powerGain: 16 },
  { fromLevel: 48, costFgems: 1700, powerGain: 16 },
  { fromLevel: 49, costFgems: 1760, powerGain: 16 },
  { fromLevel: 50, costFgems: 1840, powerGain: 17 },
  { fromLevel: 51, costFgems: 1890, powerGain: 17 },
  { fromLevel: 52, costFgems: 1960, powerGain: 18 },
  { fromLevel: 53, costFgems: 2020, powerGain: 18 },
  { fromLevel: 54, costFgems: 2090, powerGain: 19 },
  { fromLevel: 55, costFgems: 2160, powerGain: 19 },
  { fromLevel: 56, costFgems: 2230, powerGain: 20 },
  { fromLevel: 57, costFgems: 2300, powerGain: 20 },
  { fromLevel: 58, costFgems: 2370, powerGain: 20 },
  { fromLevel: 59, costFgems: 2440, powerGain: 21 },
  { fromLevel: 60, costFgems: 2520, powerGain: 21 },
  { fromLevel: 61, costFgems: 2590, powerGain: 22 },
  { fromLevel: 62, costFgems: 2670, powerGain: 22 },
  { fromLevel: 63, costFgems: 2750, powerGain: 23 },
  { fromLevel: 64, costFgems: 2830, powerGain: 23 },
  { fromLevel: 65, costFgems: 2910, powerGain: 24 },
  { fromLevel: 66, costFgems: 2990, powerGain: 24 },
  { fromLevel: 67, costFgems: 3070, powerGain: 25 },
  { fromLevel: 68, costFgems: 3150, powerGain: 25 },
  { fromLevel: 69, costFgems: 3240, powerGain: 26 },
  { fromLevel: 70, costFgems: 3320, powerGain: 26 },
  { fromLevel: 71, costFgems: 3410, powerGain: 27 },
  { fromLevel: 72, costFgems: 3500, powerGain: 27 },
  { fromLevel: 73, costFgems: 3590, powerGain: 28 },
  { fromLevel: 74, costFgems: 3680, powerGain: 28 },
  { fromLevel: 75, costFgems: 3770, powerGain: 29 },
  { fromLevel: 76, costFgems: 3860, powerGain: 29 },
  { fromLevel: 77, costFgems: 3960, powerGain: 30 },
  { fromLevel: 78, costFgems: 4050, powerGain: 30 },
  { fromLevel: 79, costFgems: 4150, powerGain: 31 },
  { fromLevel: 80, costFgems: 4220, powerGain: 31 },
  { fromLevel: 81, costFgems: 4350, powerGain: 32 },
  { fromLevel: 82, costFgems: 4450, powerGain: 32 },
  { fromLevel: 83, costFgems: 4550, powerGain: 33 },
  { fromLevel: 84, costFgems: 4650, powerGain: 34 },
  { fromLevel: 85, costFgems: 4760, powerGain: 34 },
  { fromLevel: 86, costFgems: 4860, powerGain: 35 },
  { fromLevel: 87, costFgems: 4970, powerGain: 35 },
  { fromLevel: 88, costFgems: 5080, powerGain: 36 },
  { fromLevel: 89, costFgems: 5190, powerGain: 36 },
  { fromLevel: 90, costFgems: 5240, powerGain: 37 },
  { fromLevel: 91, costFgems: 5410, powerGain: 37 },
  { fromLevel: 92, costFgems: 5520, powerGain: 38 },
  { fromLevel: 93, costFgems: 5640, powerGain: 38 },
  { fromLevel: 94, costFgems: 5750, powerGain: 39 },
  { fromLevel: 95, costFgems: 5780, powerGain: 39 },
  { fromLevel: 96, costFgems: 5900, powerGain: 40 },
  { fromLevel: 97, costFgems: 6010, powerGain: 40 },
  { fromLevel: 98, costFgems: 6130, powerGain: 41 },
  { fromLevel: 99, costFgems: 6240, powerGain: 41 },
];

const BASE_UPGRADE_RULES_BY_LEVEL = new Map(
  BASE_UPGRADE_RULES.map((rule) => [rule.fromLevel, rule]),
);

export function getLocalUpgradePreview(
  item: CollectionInventoryItem,
  userFgemsBalance: number | null,
): CollectionUpgradePreview {
  const rule = getLocalUpgradeRule(item);
  const reason = getLocalUpgradeBlockedReason(item, rule, userFgemsBalance);
  const nextLevel = rule?.toLevel ?? null;
  const powerAfter = rule === null ? null : item.power + rule.powerGain;

  return {
    canUpgrade: reason === null,
    reason,
    currentLevel: item.level,
    nextLevel,
    targetLevel: nextLevel,
    currentPower: item.power,
    powerAfter,
    fgemsCost: rule?.costFgems ?? null,
    userFgemsBalance,
    isBalanceEnough:
      rule === null || userFgemsBalance === null
        ? null
        : userFgemsBalance >= rule.costFgems,
  };
}

function getLocalUpgradeRule(
  item: CollectionInventoryItem,
): { toLevel: number; costFgems: number; powerGain: number } | null {
  const baseRule = BASE_UPGRADE_RULES_BY_LEVEL.get(item.level);
  const multiplier = RARITY_UPGRADE_MULTIPLIERS[item.rarity.code.toLowerCase()];

  if (!baseRule || !multiplier) {
    return null;
  }

  return {
    toLevel: item.level + 1,
    costFgems: roundUpToTen(baseRule.costFgems * multiplier.cost),
    powerGain: Math.round(baseRule.powerGain * multiplier.growth),
  };
}

function getLocalUpgradeBlockedReason(
  item: CollectionInventoryItem,
  rule: { costFgems: number } | null,
  userFgemsBalance: number | null,
): string | null {
  if (item.status !== "available") {
    return "ITEM_NOT_AVAILABLE";
  }

  if (!item.isUpgradeable) {
    return "ITEM_NOT_UPGRADEABLE";
  }

  if (item.level >= MAX_LOCAL_UPGRADE_LEVEL) {
    return "ITEM_MAX_LEVEL";
  }

  if (rule === null) {
    return "UPGRADE_RULE_NOT_FOUND";
  }

  if (userFgemsBalance !== null && userFgemsBalance < rule.costFgems) {
    return "INSUFFICIENT_FGEMS";
  }

  return null;
}

function roundUpToTen(value: number): number {
  return Math.ceil((value - 1e-9) / 10) * 10;
}
