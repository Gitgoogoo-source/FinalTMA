export type BoxStatus =
  | "draft"
  | "not_started"
  | "active"
  | "paused"
  | "sold_out"
  | "ended"
  | "archived";

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
  invoiceLink: string | null;
  invoiceOpenMode: string | null;
  xtrAmount: number;
  drawCount: 1 | 10;
  orderStatus: string;
  paymentStatus: string;
  paymentOrderStatus: string;
  expiresAt: string | null;
  paidAt?: string | null;
  fulfilledAt?: string | null;
  devPaymentProcessed: boolean;
  idempotent: boolean;
  resultReady: boolean;
};

export type DrawResultStatus = "completed" | "pending";

export type DrawResultItem = {
  drawIndex: number;
  rewardSource: string;
  isPityHit: boolean;
  itemInstanceId: string | null;
  templateId: string | null;
  templateSlug: string | null;
  name: string;
  subtitle: string | null;
  description: string | null;
  serialNumber: number | null;
  rarity: BoxRarity | string | null;
  rarityLabel: string | null;
  itemType: string | null;
  formId: string | null;
  formIndex: number | null;
  formName: string | null;
  imageUrl: string | null;
  thumbnailUrl: string | null;
  level: number;
  power: number;
};

export type DrawResultBalances = {
  kcoin: string | null;
  fgems: string | null;
  stars: string | null;
};

export type DrawResultResponse = {
  orderId: string;
  status: DrawResultStatus;
  orderStatus: string;
  quantity: number;
  paidStars: number;
  returnedKcoin: number;
  invoicePayload: string | null;
  paidAt: string | null;
  completedAt: string | null;
  boxName: string | null;
  paymentStatus: string | null;
  paymentOrderStatus: string | null;
  balances: DrawResultBalances | null;
  results: DrawResultItem[];
  serverTime: string | null;
};
