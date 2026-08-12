import commonImage from "./gacha-rarity/common-v2.webp";
import epicImage from "./gacha-rarity/epic-v2.webp";
import legendaryImage from "./gacha-rarity/legendary-v2.webp";
import mythicImage from "./gacha-rarity/mythic-v2.webp";
import rareImage from "./gacha-rarity/rare-v2.webp";

export type GachaRarity = "common" | "rare" | "epic" | "legendary" | "mythic";
export type GachaTier = "normal" | "rare" | "legendary";

type DisplayProbabilities = Record<GachaRarity, number>;

export const gachaRarityOrder = [
  "common",
  "rare",
  "epic",
  "legendary",
  "mythic",
] as const satisfies readonly GachaRarity[];

export const gachaRarityPresentation = {
  common: {
    label: "普通",
    imageSrc: commonImage,
    imageAlt: "普通级白色幼龙收藏徽章",
  },
  rare: {
    label: "稀有",
    imageSrc: rareImage,
    imageAlt: "稀有级绿色飞龙收藏徽章",
  },
  epic: {
    label: "史诗",
    imageSrc: epicImage,
    imageAlt: "史诗级橙紫飞龙收藏徽章",
  },
  legendary: {
    label: "传说",
    imageSrc: legendaryImage,
    imageAlt: "传说级红色飞龙收藏徽章",
  },
  mythic: {
    label: "神话",
    imageSrc: mythicImage,
    imageAlt: "神话级黑金雷龙收藏徽章",
  },
} as const satisfies Record<
  GachaRarity,
  { label: string; imageSrc: string; imageAlt: string }
>;

/**
 * Player-facing probability copy frozen from the current three blind-box rules.
 * This presentation map never participates in server-side drawing or settlement.
 */
export const gachaDisplayProbabilityByTier = {
  normal: {
    common: 72,
    rare: 25,
    epic: 3,
    legendary: 0,
    mythic: 0,
  },
  rare: {
    common: 20,
    rare: 55,
    epic: 22,
    legendary: 3,
    mythic: 0,
  },
  legendary: {
    common: 0,
    rare: 18,
    epic: 55,
    legendary: 24,
    mythic: 3,
  },
} as const satisfies Record<GachaTier, DisplayProbabilities>;
