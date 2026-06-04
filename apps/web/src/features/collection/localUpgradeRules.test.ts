import { describe, expect, it } from "vitest";

import type { CollectionInventoryItem } from "./collection.types";
import { getLocalUpgradePreview } from "./localUpgradeRules";

describe("local upgrade rules", () => {
  it("calculates the common 1 to 2 upgrade from the base table", () => {
    const preview = getLocalUpgradePreview(makeItem(), 80);

    expect(preview).toMatchObject({
      canUpgrade: true,
      currentLevel: 1,
      currentPower: 10,
      fgemsCost: 70,
      isBalanceEnough: true,
      nextLevel: 2,
      powerAfter: 15,
      reason: null,
      userFgemsBalance: 80,
    });
  });

  it("rounds rarity-scaled cost up to 10 and power gain to nearest integer", () => {
    const rarePreview = getLocalUpgradePreview(
      makeItem({
        level: 50,
        power: 1000,
        rarity: {
          code: "rare",
          label: "稀有",
          sortOrder: 20,
        },
      }),
      3000,
    );
    const epicPreview = getLocalUpgradePreview(
      makeItem({
        level: 50,
        power: 1000,
        rarity: {
          code: "epic",
          label: "史诗",
          sortOrder: 30,
        },
      }),
      3000,
    );
    const legendaryPreview = getLocalUpgradePreview(
      makeItem({
        level: 50,
        power: 1000,
        rarity: {
          code: "legendary",
          label: "传说",
          sortOrder: 40,
        },
      }),
      4000,
    );

    expect(rarePreview).toMatchObject({
      fgemsCost: 2210,
      powerAfter: 1020,
    });
    expect(epicPreview).toMatchObject({
      fgemsCost: 2860,
      powerAfter: 1023,
    });
    expect(legendaryPreview).toMatchObject({
      fgemsCost: 3870,
      powerAfter: 1030,
    });
  });

  it("uses legendary multipliers for mythic items", () => {
    const mythicPreview = getLocalUpgradePreview(
      makeItem({
        level: 50,
        power: 1000,
        rarity: {
          code: "mythic",
          label: "神话",
          sortOrder: 50,
        },
      }),
      4000,
    );

    expect(mythicPreview).toMatchObject({
      canUpgrade: true,
      fgemsCost: 3870,
      powerAfter: 1030,
    });
  });
});

function makeItem(
  overrides: Partial<CollectionInventoryItem> = {},
): CollectionInventoryItem {
  return {
    avatarUrl: null,
    description: null,
    form: {
      description: null,
      displayName: "基础形态",
      id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
      index: 1,
    },
    imageUrl: null,
    isDecomposable: true,
    isEvolvable: true,
    isMintable: true,
    isTradeable: true,
    isUpgradeable: true,
    itemInstanceId: "66666666-6666-4666-8666-666666666666",
    level: 1,
    name: "森林幼芽",
    nftMintStatus: "not_minted",
    obtainedAt: "2026-05-24T08:00:00.000Z",
    power: 10,
    rarity: {
      code: "common",
      label: "普通",
      sortOrder: 10,
    },
    serialNo: 1,
    series: null,
    sourceId: null,
    sourceType: "gacha",
    status: "available",
    subtitle: null,
    templateId: "55555555-5555-4555-8555-555555555555",
    templateSlug: "forest_sproutling",
    thumbnailUrl: null,
    typeCode: "CHARACTER",
    ...overrides,
  };
}
