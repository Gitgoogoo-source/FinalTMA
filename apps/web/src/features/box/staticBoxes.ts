import type { BlindBox } from "./box.types";
import {
  getCachedBoxIdBySlug,
  getCachedPityBySlug,
  type CachedBoxPitySnapshot,
} from "./box.pityCache";

export type StaticBoxSlug = "starter_egg" | "premium_egg" | "legendary_egg";

type StaticBoxConfig = {
  slug: StaticBoxSlug;
  name: string;
  description: string;
  tier: "normal" | "rare" | "legendary";
  singleStarPrice: number;
  sortOrder: number;
};

export const STATIC_BOX_CONFIGS: readonly StaticBoxConfig[] = [
  {
    slug: "starter_egg",
    name: "Normal Egg",
    description:
      "Best for new players. Contains Common, Rare and a small chance of Epic collectibles.",
    tier: "normal",
    singleStarPrice: 10,
    sortOrder: 10,
  },
  {
    slug: "premium_egg",
    name: "Rare Egg",
    description:
      "Higher Rare and Epic rates, with a chance for Legendary collectibles.",
    tier: "rare",
    singleStarPrice: 30,
    sortOrder: 20,
  },
  {
    slug: "legendary_egg",
    name: "Legendary Egg",
    description:
      "High-value box focused on Epic and Legendary launch collectibles.",
    tier: "legendary",
    singleStarPrice: 80,
    sortOrder: 30,
  },
] as const;

export const STATIC_BOX_SLUGS = STATIC_BOX_CONFIGS.map((box) => box.slug);

const TEN_DRAW_DISCOUNT_BPS = 1000;
const KCOIN_RETURN_PER_DRAW = 100;

export function createStaticBoxes(
  snapshot: CachedBoxPitySnapshot | null,
): BlindBox[] {
  return STATIC_BOX_CONFIGS.map((box) => {
    const serverBoxId = getCachedBoxIdBySlug(snapshot, box.slug);
    const pityProgress = getCachedPityBySlug(snapshot, box.slug);

    return {
      coverImageUrl: `/images/boxes/${box.slug}.png`,
      description: box.description,
      disabledReason: null,
      discountBps: TEN_DRAW_DISCOUNT_BPS,
      discountRate: (10000 - TEN_DRAW_DISCOUNT_BPS) / 10000,
      heroImageUrl: `/images/boxes/${box.slug}.png`,
      id: serverBoxId ?? box.slug,
      isOpenable: true,
      kcoinReturnPerDraw: KCOIN_RETURN_PER_DRAW,
      name: box.name,
      pityProgress,
      remainingStock: null,
      singleStarPrice: box.singleStarPrice,
      slug: box.slug,
      sortOrder: box.sortOrder,
      status: "active",
      stockStatus: "unlimited",
      tenDrawPrice: getTenDrawPrice(box.singleStarPrice),
      tier: box.tier,
      totalStock: null,
      updatedAt: pityProgress?.updatedAt ?? snapshot?.serverTime ?? null,
    };
  });
}

export function isStaticBoxSlug(value: string): value is StaticBoxSlug {
  return (STATIC_BOX_SLUGS as readonly string[]).includes(value);
}

function getTenDrawPrice(singleStarPrice: number): number {
  return Math.ceil(
    (singleStarPrice * 10 * (10000 - TEN_DRAW_DISCOUNT_BPS)) / 10000,
  );
}
