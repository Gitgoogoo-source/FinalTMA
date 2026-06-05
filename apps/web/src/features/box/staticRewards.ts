import type {
  BlindBox,
  BoxRewardPreviewItem,
  BoxRewardsResponse,
} from "./box.types";

type StaticBoxRewardConfig = {
  poolVersion: number;
  pityRule: BoxRewardsResponse["pityRule"];
  items: BoxRewardPreviewItem[];
};

type RewardSeed = {
  slug: string;
  name: string;
  rarity: "common" | "rare" | "epic" | "legendary";
  itemType: "CHARACTER" | "PET";
  itemTypeLabel: "Character" | "Pet";
  probabilityBps: number;
  isPityEligible: boolean;
};

const COLLECTIBLE_IMAGE_BASE = "/images/collectibles/";

const STATIC_BOX_REWARDS = {
  starter_egg: createConfig("starter_egg", {
    pityThreshold: 30,
    pityTargetRarity: "rare",
    rewards: [
      reward("forest_sproutling", "Forest Sproutling", "common", 3200),
      reward("mooncap_bard", "Mooncap Bard", "common", 2600),
      reward("crystal_otter", "Crystal Otter", "common", 2200, {
        itemType: "PET",
        itemTypeLabel: "Pet",
      }),
      reward("forest_ranger", "Verdant Ranger", "rare", 850, {
        isPityEligible: true,
      }),
      reward("moonlit_minstrel", "Moonlit Minstrel", "rare", 650, {
        isPityEligible: true,
      }),
      reward("tideglass_otter", "Tideglass Otter", "rare", 350, {
        itemType: "PET",
        itemTypeLabel: "Pet",
        isPityEligible: true,
      }),
      reward("ancient_leaf_sentinel", "Ancient Leaf Sentinel", "epic", 100, {
        isPityEligible: true,
      }),
      reward("prism_tide_oracle", "Prism Tide Oracle", "epic", 50, {
        isPityEligible: true,
      }),
    ],
  }),
  premium_egg: createConfig("premium_egg", {
    pityThreshold: 50,
    pityTargetRarity: "epic",
    rewards: [
      reward("forest_ranger", "Verdant Ranger", "rare", 1800, {
        isPityEligible: true,
      }),
      reward("moonlit_minstrel", "Moonlit Minstrel", "rare", 1600, {
        isPityEligible: true,
      }),
      reward("tideglass_otter", "Tideglass Otter", "rare", 1500, {
        itemType: "PET",
        itemTypeLabel: "Pet",
        isPityEligible: true,
      }),
      reward("ember_whelp", "Ember Whelp", "rare", 1400, {
        itemType: "PET",
        itemTypeLabel: "Pet",
        isPityEligible: true,
      }),
      reward("ancient_leaf_sentinel", "Ancient Leaf Sentinel", "epic", 1100, {
        isPityEligible: true,
      }),
      reward("prism_tide_oracle", "Prism Tide Oracle", "epic", 900, {
        isPityEligible: true,
      }),
      reward("blazewing_drake", "Blazewing Drake", "epic", 850, {
        itemType: "PET",
        itemTypeLabel: "Pet",
        isPityEligible: true,
      }),
      reward("moon_crown_guardian", "Moon Crown Guardian", "legendary", 450, {
        isPityEligible: true,
      }),
      reward("inferno_crown_dragon", "Inferno Crown Dragon", "legendary", 400, {
        itemType: "PET",
        itemTypeLabel: "Pet",
        isPityEligible: true,
      }),
    ],
  }),
  legendary_egg: createConfig("legendary_egg", {
    pityThreshold: 80,
    pityTargetRarity: "legendary",
    rewards: [
      reward("ember_whelp", "Ember Whelp", "rare", 1000, {
        itemType: "PET",
        itemTypeLabel: "Pet",
        isPityEligible: true,
      }),
      reward("ancient_leaf_sentinel", "Ancient Leaf Sentinel", "epic", 1800, {
        isPityEligible: true,
      }),
      reward("prism_tide_oracle", "Prism Tide Oracle", "epic", 1700, {
        isPityEligible: true,
      }),
      reward("blazewing_drake", "Blazewing Drake", "epic", 1600, {
        itemType: "PET",
        itemTypeLabel: "Pet",
        isPityEligible: true,
      }),
      reward("moon_crown_guardian", "Moon Crown Guardian", "legendary", 2000, {
        isPityEligible: true,
      }),
      reward(
        "inferno_crown_dragon",
        "Inferno Crown Dragon",
        "legendary",
        1900,
        {
          itemType: "PET",
          itemTypeLabel: "Pet",
          isPityEligible: true,
        },
      ),
    ],
  }),
} satisfies Record<string, StaticBoxRewardConfig>;

type StaticBoxSlug = keyof typeof STATIC_BOX_REWARDS;

const DEFAULT_BOX_REWARD_SLUG: StaticBoxSlug = "starter_egg";

const BOX_SLUG_BY_TIER: Record<string, StaticBoxSlug> = {
  normal: "starter_egg",
  ordinary: "starter_egg",
  rare: "premium_egg",
  legendary: "legendary_egg",
};

export function getStaticBoxRewards(box: BlindBox | null): BoxRewardsResponse {
  const config = getStaticRewardConfig(box);

  return {
    boxId: box?.id ?? "static-box",
    boxSlug: box?.slug ?? null,
    boxName: box?.name ?? "盲盒",
    boxStatus: box?.status ?? "active",
    poolVersionId: "",
    poolVersion: config.poolVersion,
    items: config.items,
    pityRule: config.pityRule,
    generatedAt: null,
  };
}

function getStaticRewardConfig(box: BlindBox | null): StaticBoxRewardConfig {
  const slug = box?.slug;

  if (slug && isStaticBoxSlug(slug)) {
    return STATIC_BOX_REWARDS[slug];
  }

  const fallbackSlug = BOX_SLUG_BY_TIER[String(box?.tier ?? "").toLowerCase()];

  return STATIC_BOX_REWARDS[fallbackSlug ?? DEFAULT_BOX_REWARD_SLUG];
}

function isStaticBoxSlug(slug: string): slug is StaticBoxSlug {
  return Object.hasOwn(STATIC_BOX_REWARDS, slug);
}

function createConfig(
  boxSlug: string,
  input: {
    pityThreshold: number;
    pityTargetRarity: "rare" | "epic" | "legendary";
    rewards: RewardSeed[];
  },
): StaticBoxRewardConfig {
  return {
    poolVersion: 1,
    pityRule: {
      threshold: input.pityThreshold,
      targetRarity: input.pityTargetRarity,
      description: `累计未命中达到 ${input.pityThreshold} 次后，保底 ${getRarityLabel(input.pityTargetRarity)}。`,
    },
    items: input.rewards.map((item) => toPreviewItem(boxSlug, item)),
  };
}

function reward(
  slug: string,
  name: string,
  rarity: RewardSeed["rarity"],
  probabilityBps: number,
  overrides: Partial<
    Pick<RewardSeed, "itemType" | "itemTypeLabel" | "isPityEligible">
  > = {},
): RewardSeed {
  return {
    slug,
    name,
    rarity,
    itemType: overrides.itemType ?? "CHARACTER",
    itemTypeLabel: overrides.itemTypeLabel ?? "Character",
    probabilityBps,
    isPityEligible: overrides.isPityEligible ?? false,
  };
}

function toPreviewItem(
  boxSlug: string,
  item: RewardSeed,
): BoxRewardPreviewItem {
  return {
    poolItemId: `static:${boxSlug}:${item.slug}`,
    templateId: item.slug,
    formId: `${item.slug}:base`,
    name: item.name,
    description: null,
    rarity: item.rarity,
    rarityLabel: getRarityLabel(item.rarity),
    itemType: item.itemType,
    itemTypeLabel: item.itemTypeLabel,
    imageUrl: `${COLLECTIBLE_IMAGE_BASE}${item.slug}.png`,
    displayProbability: formatProbability(item.probabilityBps),
    probabilityBps: item.probabilityBps,
    remainingStock: null,
    isLimited: false,
    isPityEligible: item.isPityEligible,
    isFeatured: item.rarity === "epic" || item.rarity === "legendary",
  };
}

function getRarityLabel(rarity: string): string {
  switch (rarity) {
    case "common":
      return "Common";
    case "rare":
      return "Rare";
    case "epic":
      return "Epic";
    case "legendary":
      return "Legendary";
    default:
      return rarity;
  }
}

function formatProbability(probabilityBps: number): string {
  const percentage = probabilityBps / 100;

  return `${percentage.toFixed(2).replace(/\.?0+$/, "")}%`;
}
