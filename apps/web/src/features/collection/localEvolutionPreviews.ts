import type { CollectionInventoryItem } from "./collection.types";

export type LocalEvolutionPreview = {
  requiredCount: number;
  targetTemplateSlug: string;
  targetImageUrl: string | null;
  targetName: string;
};

type EvolutionDisplayStep = {
  targetTemplateSlug: string;
  targetName: string;
};

const REQUIRED_EVOLUTION_MATERIALS = 3;

const EVOLUTION_DISPLAY_RULES: Record<string, EvolutionDisplayStep> = {
  crystal_otter: {
    targetTemplateSlug: "tideglass_otter",
    targetName: "Tideglass Otter",
  },
  ember_whelp: {
    targetTemplateSlug: "blazewing_drake",
    targetName: "Blazewing Drake",
  },
  forest_ranger: {
    targetTemplateSlug: "ancient_leaf_sentinel",
    targetName: "Ancient Leaf Sentinel",
  },
  forest_sproutling: {
    targetTemplateSlug: "forest_ranger",
    targetName: "Verdant Ranger",
  },
  mooncap_bard: {
    targetTemplateSlug: "moonlit_minstrel",
    targetName: "Moonlit Minstrel",
  },
  moonlit_minstrel: {
    targetTemplateSlug: "moon_crown_guardian",
    targetName: "Moon Crown Guardian",
  },
  tideglass_otter: {
    targetTemplateSlug: "prism_tide_oracle",
    targetName: "Prism Tide Oracle",
  },
  blazewing_drake: {
    targetTemplateSlug: "inferno_crown_dragon",
    targetName: "Inferno Crown Dragon",
  },
};

export function getLocalEvolutionPreview(
  item: CollectionInventoryItem | null,
): LocalEvolutionPreview | null {
  if (!item?.templateSlug) {
    return null;
  }

  const formIndex = item.form?.index ?? 1;
  const displayRule =
    formIndex === 1 ? EVOLUTION_DISPLAY_RULES[item.templateSlug] : undefined;

  if (!displayRule) {
    return null;
  }

  return {
    requiredCount: REQUIRED_EVOLUTION_MATERIALS,
    targetTemplateSlug: displayRule.targetTemplateSlug,
    targetImageUrl: null,
    targetName: displayRule.targetName,
  };
}
