import type { CollectionInventoryItem } from "./collection.types";

export type LocalEvolutionPreview = {
  requiredCount: number;
  targetFormIndex: number;
  targetImageUrl: string | null;
  targetName: string;
};

type EvolutionDisplayStep = {
  targetFormIndex: number;
  targetName: string;
};

const REQUIRED_EVOLUTION_MATERIALS = 3;

const EVOLUTION_DISPLAY_RULES: Record<
  string,
  Partial<Record<number, EvolutionDisplayStep>>
> = {
  ancient_leaf_sentinel: {
    1: { targetFormIndex: 2, targetName: "Ancient Leaf Sentinel II" },
    2: { targetFormIndex: 3, targetName: "Ancient Leaf Sentinel III" },
  },
  blazewing_drake: {
    1: { targetFormIndex: 2, targetName: "Blazewing Drake II" },
    2: { targetFormIndex: 3, targetName: "Blazewing Drake III" },
  },
  crystal_otter: {
    1: { targetFormIndex: 2, targetName: "Crystal Otter II" },
    2: { targetFormIndex: 3, targetName: "Crystal Otter III" },
  },
  ember_whelp: {
    1: { targetFormIndex: 2, targetName: "Ember Whelp II" },
    2: { targetFormIndex: 3, targetName: "Ember Whelp III" },
  },
  forest_ranger: {
    1: { targetFormIndex: 2, targetName: "Verdant Ranger II" },
    2: { targetFormIndex: 3, targetName: "Verdant Ranger III" },
  },
  forest_sproutling: {
    1: { targetFormIndex: 2, targetName: "Forest Sproutling II" },
    2: { targetFormIndex: 3, targetName: "Forest Sproutling III" },
  },
  inferno_crown_dragon: {
    1: { targetFormIndex: 2, targetName: "Inferno Crown Dragon II" },
    2: { targetFormIndex: 3, targetName: "Inferno Crown Dragon III" },
  },
  moon_crown_guardian: {
    1: { targetFormIndex: 2, targetName: "Moon Crown Guardian II" },
    2: { targetFormIndex: 3, targetName: "Moon Crown Guardian III" },
  },
  mooncap_bard: {
    1: { targetFormIndex: 2, targetName: "Mooncap Bard II" },
    2: { targetFormIndex: 3, targetName: "Mooncap Bard III" },
  },
  moonlit_minstrel: {
    1: { targetFormIndex: 2, targetName: "Moonlit Minstrel II" },
    2: { targetFormIndex: 3, targetName: "Moonlit Minstrel III" },
  },
  prism_tide_oracle: {
    1: { targetFormIndex: 2, targetName: "Prism Tide Oracle II" },
    2: { targetFormIndex: 3, targetName: "Prism Tide Oracle III" },
  },
  tideglass_otter: {
    1: { targetFormIndex: 2, targetName: "Tideglass Otter II" },
    2: { targetFormIndex: 3, targetName: "Tideglass Otter III" },
  },
};

export function getLocalEvolutionPreview(
  item: CollectionInventoryItem | null,
): LocalEvolutionPreview | null {
  if (!item?.templateSlug) {
    return null;
  }

  const formIndex = item.form?.index ?? 1;
  const displayRule = EVOLUTION_DISPLAY_RULES[item.templateSlug]?.[formIndex];

  if (!displayRule) {
    return null;
  }

  return {
    requiredCount: REQUIRED_EVOLUTION_MATERIALS,
    targetFormIndex: displayRule.targetFormIndex,
    targetImageUrl: item.imageUrl ?? item.thumbnailUrl ?? item.avatarUrl,
    targetName: displayRule.targetName,
  };
}
