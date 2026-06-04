export type CollectionRarity = {
  code: string;
  label: string;
  sortOrder: number | null;
};

export type CollectionSeries = {
  id: string | null;
  slug: string | null;
  displayName: string | null;
};

export type CollectionForm = {
  id: string | null;
  index: number | null;
  displayName: string | null;
  description?: string | null;
};

export type CollectionNamedObject = {
  id: string | null;
  code: string | null;
  slug: string | null;
  displayName: string | null;
  sortOrder: number | null;
};

export type CollectionActiveLock = {
  lockId: string | null;
  reason: string | null;
  sourceType: string | null;
  sourceId: string | null;
  lockedAt: string | null;
  expiresAt: string | null;
};

export type CollectionMarketStatus = {
  isListed: boolean;
  listingId: string | null;
  unitPrice: number | null;
  currency: string | null;
};

export type CollectionOnchainStatus = {
  isMinted: boolean;
  mintStatus: string | null;
};

export type CollectionUpgradePreview = {
  canUpgrade: boolean;
  reason: string | null;
  currentLevel: number | null;
  nextLevel: number | null;
  targetLevel: number | null;
  currentPower: number | null;
  powerAfter: number | null;
  fgemsCost: number | null;
  userFgemsBalance: number | null;
  isBalanceEnough: boolean | null;
};

export type CollectionEvolutionPreview = {
  canEvolve: boolean;
  reason: string | null;
  requiredCount: number;
  availableSameItems: number | null;
  kcoinCost: number | null;
  userKcoinBalance: number | null;
  isBalanceEnough: boolean | null;
  successRateBps: number | null;
  targetTemplateId: string | null;
  targetFormId: string | null;
  targetName: string | null;
  targetImageUrl: string | null;
  selectedItemIds: string[];
  mainReturnItemId: string | null;
};

export type CollectionDecomposePreview = {
  canDecompose: boolean;
  reason: string | null;
  fgemsReward: number | null;
  totalRewardFgems: number | null;
  duplicateCount: number | null;
  itemStatus: string | null;
  itemInstanceIds: string[];
  items: unknown[];
};

export type CollectionInventoryItem = {
  itemInstanceId: string;
  templateId: string | null;
  templateSlug: string | null;
  name: string;
  subtitle: string | null;
  description: string | null;
  rarity: CollectionRarity;
  series: CollectionSeries | null;
  form: CollectionForm | null;
  typeCode: string | null;
  serialNo: number | null;
  level: number;
  power: number;
  status: string | null;
  nftMintStatus: string | null;
  itemVersion?: number | null;
  imageUrl: string | null;
  thumbnailUrl: string | null;
  avatarUrl: string | null;
  isTradeable: boolean;
  isUpgradeable: boolean;
  isEvolvable: boolean;
  isDecomposable: boolean;
  isMintable: boolean;
  sourceType: string | null;
  sourceId: string | null;
  obtainedAt: string | null;
};

export type CollectionInventoryGroup = {
  key: string;
  representativeItem: CollectionInventoryItem;
  itemInstanceIds: string[];
  ownedCount: number;
  availableCount: number;
  listedCount: number;
  lockedCount: number;
  mintingCount: number;
  mintedCount: number;
  maxLevel: number | null;
  maxPower: number | null;
  latestObtainedAt: string | null;
};

export type CollectionInventoryDetail = CollectionInventoryItem & {
  formId: string | null;
  basePower: number | null;
  faction: CollectionNamedObject | null;
  attributes: Record<string, unknown>;
  activeLock: CollectionActiveLock | null;
  marketStatus: CollectionMarketStatus | null;
  onchainStatus: CollectionOnchainStatus | null;
  upgradePreview: CollectionUpgradePreview | null;
  evolutionPreview: CollectionEvolutionPreview | null;
  decomposePreview: CollectionDecomposePreview | null;
  sameItemCount: number;
  availableSameItemCount: number;
  updatedAt: string | null;
};

export type CollectionInventoryResponse = {
  items: CollectionInventoryItem[];
  total: number;
  limit: number;
  offset: number;
  nextCursor: string | null;
  statuses: string[];
  serverTime: string | null;
};

export type CollectionInventorySummaryCounts = {
  totalCount: number;
  availableCount: number;
  listedCount: number;
  lockedCount: number;
  mintingCount: number;
  mintedCount: number;
  groupCount: number;
};

export type CollectionInventorySummaryResponse = {
  groups: CollectionInventoryGroup[];
  items: CollectionInventoryItem[];
  total: number;
  groupTotal: number;
  summary: CollectionInventorySummaryCounts;
  statuses: string[];
  serverTime: string | null;
};

export type CollectionUpgradeItemInput = {
  itemInstanceId: string;
  expectedFgemsCost?: number | null;
  expectedItemVersion?: number | null;
  targetLevel?: number | null;
  idempotencyKey?: string | null;
};

export type CollectionUpgradeItemResponse = {
  itemInstanceId: string;
  fromLevel: number | null;
  toLevel: number;
  fromPower: number | null;
  toPower: number;
  consumedFgems: number;
  costFgems: number;
  fgemsBalanceBefore: number | null;
  fgemsBalanceAfter: number | null;
  balanceChange: number | null;
  ledgerId: string | null;
  upgradedAt: string | null;
  idempotent: boolean;
};

export type CollectionEvolveItemInput = {
  sourceItemInstanceIds: string[];
  targetFormId?: string | null;
  expectedKcoinCost?: number | null;
  expectedSuccessRateBps?: number | null;
  expectedReturnItemInstanceId?: string | null;
  idempotencyKey?: string | null;
};

export type CollectionEvolveItemResponse = {
  result: "success" | "failed";
  success: boolean;
  attemptId: string | null;
  sourceItemInstanceIds: string[];
  consumedItemInstanceIds: string[];
  returnedItemInstanceId: string | null;
  createdItemInstanceId: string | null;
  mainItemInstanceId: string | null;
  consumedKcoin: number;
  costKcoin: number;
  kcoinBalanceBefore: number | null;
  kcoinBalanceAfter: number | null;
  balanceChange: number | null;
  ledgerId: string | null;
  successRateBps: number;
  randomRollBps: number | null;
  evolvedAt: string | null;
  idempotent: boolean;
};

export type CollectionDecomposeItemInput = {
  itemInstanceIds: string[];
  expectedFgemsReward?: number | null;
  idempotencyKey?: string | null;
};

export type CollectionDecomposeItemResponse = {
  decomposedItemInstanceIds: string[];
  gainedFgems: number;
  totalRewardFgems: number;
  fgemsBalanceBefore: number | null;
  fgemsBalanceAfter: number | null;
  balanceChange: number | null;
  ledgerId: string | null;
  items: unknown[];
  decomposedAt: string | null;
  idempotent: boolean;
};

export type CollectionSellEntryInput = {
  itemInstanceId: string;
  unitPriceKcoin: number;
  idempotencyKey?: string | null;
};

export type CollectionSellEntryResponse = {
  listingId: string;
  itemCount: number;
  remainingCount: number;
  unitPriceKcoin: number;
  feeBps: number;
  expectedNetAmountKcoin: number;
  status: string;
  priceHealth: string;
  idempotent: boolean;
};

export type CollectionCancelSellInput = {
  itemInstanceId: string;
  listingId?: string | null;
  idempotencyKey?: string | null;
};

export type CollectionCancelSellResponse = {
  listingId: string;
  status: string;
  releasedItemInstanceIds: string[];
  cancelledAt: string | null;
};
