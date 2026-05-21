export type BoxStatus =
  | "not_started"
  | "active"
  | "paused"
  | "ended"
  | "sold_out"
  | "hidden";

export type BoxTier = "normal" | "ordinary" | "rare" | "legendary" | "event";

export type BoxStockStatus =
  | "available"
  | "low_stock"
  | "sold_out"
  | "unlimited";

export type BoxRarity = "common" | "rare" | "epic" | "legendary" | "mythic";

export type BoxPityProgress = {
  ruleId: string;
  threshold: number;
  currentCount: number;
  totalDraws: number;
  remainingToGuaranteed: number;
  targetRarity: BoxRarity | string;
  guaranteedNext: boolean;
  updatedAt: string | null;
} | null;

export type BlindBox = {
  id: string;
  slug: string;
  name: string;
  description: string | null;
  tier: BoxTier | string;
  status: BoxStatus;
  singleStarPrice: number;
  tenDrawPrice: number;
  discountRate: number;
  discountBps: number;
  stockStatus: BoxStockStatus;
  totalStock: number | null;
  remainingStock: number | null;
  pityProgress: BoxPityProgress;
  heroImageUrl: string | null;
  coverImageUrl: string | null;
  isOpenable: boolean;
  disabledReason: string | null;
  kcoinReturnPerDraw: number;
  sortOrder: number;
  updatedAt: string | null;
};

export type BoxListResponse = {
  items: BlindBox[];
  nextCursor: string | null;
  serverTime: string | null;
};

export type BoxRewardPreviewItem = {
  poolItemId: string;
  templateId: string;
  formId: string | null;
  name: string;
  description: string | null;
  rarity: BoxRarity | string;
  rarityLabel: string;
  itemType: string | null;
  itemTypeLabel: string | null;
  imageUrl: string | null;
  displayProbability: string;
  probabilityBps: number;
  remainingStock: number | null;
  isLimited: boolean;
  isPityEligible: boolean;
  isFeatured: boolean;
};

export type BoxRewardsResponse = {
  boxId: string;
  boxSlug: string | null;
  boxName: string;
  boxStatus: BoxStatus;
  poolVersionId: string;
  poolVersion: number;
  items: BoxRewardPreviewItem[];
  pityRule: {
    threshold: number;
    targetRarity: BoxRarity | string;
    description: string;
  } | null;
  generatedAt: string | null;
};

export type CreateOpenOrderInput = {
  boxId: string;
  drawCount: 1 | 10;
  expectedPriceStars: number;
  expectedPoolVersionId?: string | undefined;
};

export type CreateOpenOrderResponse = {
  orderId: string;
  starOrderId: string | null;
  invoicePayload: string | null;
  xtrAmount: number;
  drawCount: 1 | 10;
  orderStatus: string;
  paymentStatus: string;
  devPaymentProcessed: boolean;
  idempotent: boolean;
  resultReady: boolean;
};
