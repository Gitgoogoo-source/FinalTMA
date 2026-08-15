import { localized } from "../../platform/i18n/index.ts";
export const chainTypeLabels = localized({
  normal: "普通链",
  advanced: "高级链",
  top: "顶级链",
} as const);

export const rarityLabels = localized({
  common: "普通",
  rare: "稀有",
  epic: "史诗",
  legendary: "传说",
  mythic: "神话",
} as const);
