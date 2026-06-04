import { describe, expect, it } from "vitest";

import type { BlindBox, BoxListResponse } from "./box.types";
import {
  BOX_PITY_CACHE_STORAGE_KEY,
  createBoxPitySnapshot,
  getCachedBoxIdBySlug,
  readCachedBoxPitySnapshot,
  writeCachedBoxPitySnapshot,
} from "./box.pityCache";

describe("box pity cache", () => {
  it("stores and reads the server box id with pity progress", () => {
    const storage = createMemoryStorage();
    const snapshot = createBoxPitySnapshot(createBoxListResponse(), new Date("2026-05-28T01:00:00.000Z"));

    writeCachedBoxPitySnapshot(snapshot, storage);

    const cached = readCachedBoxPitySnapshot(storage);

    expect(cached).toMatchObject({
      serverTime: "2026-05-28T00:00:00.000Z",
      syncedAt: "2026-05-28T01:00:00.000Z",
      version: 1,
    });
    expect(getCachedBoxIdBySlug(cached, "starter_egg")).toBe(
      "11111111-1111-4111-8111-111111111111",
    );
    expect(cached?.items[0]?.pityProgress).toMatchObject({
      currentCount: 3,
      remainingToGuaranteed: 27,
      threshold: 30,
    });
  });

  it("removes invalid cache payloads", () => {
    const storage = createMemoryStorage();
    storage.setItem(BOX_PITY_CACHE_STORAGE_KEY, JSON.stringify({ version: 0 }));

    expect(readCachedBoxPitySnapshot(storage)).toBeNull();
    expect(storage.getItem(BOX_PITY_CACHE_STORAGE_KEY)).toBeNull();
  });
});

function createBoxListResponse(): BoxListResponse {
  return {
    items: [
      {
        coverImageUrl: "/images/boxes/starter_egg.png",
        description: "Normal launch box",
        disabledReason: null,
        discountBps: 1000,
        discountRate: 0.9,
        heroImageUrl: "/images/boxes/starter_egg.png",
        id: "11111111-1111-4111-8111-111111111111",
        isOpenable: true,
        kcoinReturnPerDraw: 100,
        name: "Normal Egg",
        pityProgress: {
          currentCount: 3,
          guaranteedNext: false,
          remainingToGuaranteed: 27,
          ruleId: "aaaa1111-1111-4111-8111-111111111111",
          targetRarity: "rare",
          threshold: 30,
          totalDraws: 3,
          updatedAt: "2026-05-28T00:00:00.000Z",
        },
        remainingStock: null,
        singleStarPrice: 10,
        slug: "starter_egg",
        sortOrder: 10,
        status: "active",
        stockStatus: "unlimited",
        tenDrawPrice: 90,
        tier: "normal",
        totalStock: null,
        updatedAt: "2026-05-28T00:00:00.000Z",
      },
    ] satisfies BlindBox[],
    nextCursor: null,
    serverTime: "2026-05-28T00:00:00.000Z",
  };
}

function createMemoryStorage(): Storage {
  const values = new Map<string, string>();

  return {
    clear: () => values.clear(),
    getItem: (key) => values.get(key) ?? null,
    key: (index) => Array.from(values.keys())[index] ?? null,
    get length() {
      return values.size;
    },
    removeItem: (key) => values.delete(key),
    setItem: (key, value) => values.set(key, value),
  };
}
