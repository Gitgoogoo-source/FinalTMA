export type TradeTabId = "buy" | "sell" | "manage";

export type MarketCurrencyCode = "KCOIN";

export type MarketRarityCode =
  | "common"
  | "rare"
  | "epic"
  | "legendary"
  | "mythic";

export type MarketItemTypeCode =
  | "character"
  | "pet"
  | "egg"
  | "decoration"
  | "prop"
  | "material";

export type MarketListingStatus =
  | "active"
  | "partially_sold"
  | "sold"
  | "cancelled"
  | "expired"
  | "suspended";

export type MarketOrderStatus =
  | "pending"
  | "completed"
  | "cancelled"
  | "failed"
  | "refunded";

export type MarketPriceHealth = "too_low" | "healthy" | "too_high" | "unknown";

export type MarketListingSort =
  | "recently_listed"
  | "price_low_to_high"
  | "price_high_to_low"
  | "rarity_high_to_low";

export type MarketMyListingSort =
  | "recently_listed"
  | "price_low_to_high"
  | "price_high_to_low"
  | "value_high_to_low"
  | "value_low_to_high";

export type MarketSellableItemSort =
  | "recently_obtained"
  | "rarity_high_to_low"
  | "rarity_low_to_high"
  | "level_high_to_low"
  | "level_low_to_high"
  | "power_high_to_low"
  | "power_low_to_high"
  | "name_a_to_z";

export type MarketCancelReason =
  | "user_cancelled"
  | "price_too_low"
  | "price_too_high"
  | "changed_mind";

export type MarketPricePeriod = "1h" | "24h" | "7d" | "30d" | "all";

export type MarketClientContextSource =
  | "trade_buy_tab"
  | "trade_sell_tab"
  | "trade_manage_tab"
  | "unknown";

export type MarketClientContext = {
  source?: MarketClientContextSource | undefined;
  clientNonce?: string | undefined;
  clientSeenAt?: string | undefined;
};

export type MarketListingCard = {
  listingId: string;
  sellerUserId: string | null;
  templateId: string;
  formId: string | null;
  itemName: string;
  rarityCode: MarketRarityCode | string;
  rarityLabel: string;
  typeCode: MarketItemTypeCode | string | null;
  imageUrl: string | null;
  serialNo: number | null;
  unitPriceKcoin: number;
  currencyCode: MarketCurrencyCode;
  itemCount: number;
  remainingCount: number;
  status: MarketListingStatus;
  sellerDisplayName: string | null;
  priceHealth: MarketPriceHealth;
  isOwnListing: boolean;
  canBuy: boolean;
  notBuyableReason: string | null;
  createdAt: string | null;
  expiresAt: string | null;
};

export type MarketDepthLevel = {
  priceKcoin: number;
  listingCount: number;
  itemCount: number;
};

export type MarketPriceStats = {
  templateId: string;
  formId: string | null;
  floorPriceKcoin: number | null;
  avgPriceKcoin: number | null;
  lastSalePriceKcoin: number | null;
  activeListingCount: number;
  saleCount24h: number;
  volume24hKcoin: number;
  snapshotAt: string | null;
};

export type MarketListingSeller = {
  userId: string | null;
  displayName: string | null;
  avatarUrl: string | null;
};

export type MarketListingDetail = MarketListingCard & {
  description: string | null;
  seller: MarketListingSeller | null;
  floorPriceKcoin: number | null;
  avgPriceKcoin: number | null;
  lastSalePriceKcoin: number | null;
  referencePriceKcoin: number | null;
  activeListingCount: number;
  saleCount24h: number;
  volume24hKcoin: number;
  snapshotAt: string | null;
  marketDepth: MarketDepthLevel[];
  itemInstanceIds: string[];
  disabledReason: string | null;
};

export type SellableItemGroup = {
  itemInstanceId: string | null;
  itemInstanceIds: string[];
  templateId: string;
  formId: string | null;
  itemName: string;
  rarityCode: MarketRarityCode | string;
  rarityLabel: string;
  typeCode: MarketItemTypeCode | string | null;
  imageUrl: string | null;
  serialNo: number | null;
  level: number;
  power: number;
  ownedCount: number;
  availableCount: number;
  suggestedPriceKcoin: number | null;
  minPriceKcoin: number | null;
  maxPriceKcoin: number | null;
  acquiredAt: string | null;
  isTradeable: boolean;
};

export type MyListing = MarketListingCard & {
  expectedNetAmountKcoin: number | null;
  lastPriceChangedAt: string | null;
};

export type MarketListingsQuery = {
  rarities?: string[] | undefined;
  typeCodes?: string[] | undefined;
  seriesIds?: string[] | undefined;
  templateIds?: string[] | undefined;
  minPriceKcoin?: number | undefined;
  maxPriceKcoin?: number | undefined;
  sort?: MarketListingSort | undefined;
  cursor?: string | undefined;
  limit?: number | undefined;
};

export type MarketSellableItemsQuery = {
  rarities?: string[] | undefined;
  typeCodes?: string[] | undefined;
  seriesIds?: string[] | undefined;
  templateIds?: string[] | undefined;
  onlyTradeable?: boolean | undefined;
  onlyDuplicates?: boolean | undefined;
  minLevel?: number | undefined;
  maxLevel?: number | undefined;
  minPriceKcoin?: number | undefined;
  maxPriceKcoin?: number | undefined;
  sort?: MarketSellableItemSort | undefined;
  cursor?: string | undefined;
  limit?: number | undefined;
};

export type MarketMyListingsQuery = {
  statuses?: MarketListingStatus[] | undefined;
  rarities?: string[] | undefined;
  typeCodes?: string[] | undefined;
  templateIds?: string[] | undefined;
  minPriceKcoin?: number | undefined;
  maxPriceKcoin?: number | undefined;
  sort?: MarketMyListingSort | undefined;
  cursor?: string | undefined;
  limit?: number | undefined;
};

export type MarketStatsQuery = {
  templateId?: string | undefined;
  formId?: string | undefined;
  seriesId?: string | undefined;
  rarity?: MarketRarityCode | string | undefined;
  typeCode?: MarketItemTypeCode | string | undefined;
  period?: MarketPricePeriod | undefined;
  includeDepth?: boolean | undefined;
};

export type MarketListingsResponse = {
  items: MarketListingCard[];
  nextCursor: string | null;
};

export type MarketListingDetailResponse = {
  listing: MarketListingDetail | null;
};

export type MarketSellableItemsResponse = {
  items: SellableItemGroup[];
  nextCursor: string | null;
};

export type MarketMyListingsResponse = {
  items: MyListing[];
  nextCursor: string | null;
};

export type MarketMyListingStats = {
  activeCount: number;
  activeListingCount: number;
  activeItemCount: number;
  totalListingValueKcoin: number;
  expectedNetAmountKcoin: number;
  sold24hCount: number;
  sold24hValueKcoin: number;
};

export type MarketStatsResponse = {
  price: MarketPriceStats | null;
  depth: MarketDepthLevel[];
  priceHealth: MarketPriceHealth;
};

export type CreateMarketListingInput = {
  itemInstanceIds: string[];
  unitPriceKcoin: number;
  idempotencyKey?: string | undefined;
  clientContext?: MarketClientContext | undefined;
};

export type CreateMarketListingResponse = {
  listingId: string;
  itemCount: number;
  remainingCount: number;
  unitPriceKcoin: number;
  feeBps: number;
  expectedNetAmountKcoin: number;
  status: MarketListingStatus;
  priceHealth: MarketPriceHealth;
  idempotent: boolean;
};

export type BuyMarketListingInput = {
  listingId: string;
  expectedUnitPriceKcoin: number;
  quantity?: 1 | undefined;
  idempotencyKey?: string | undefined;
  clientContext?: MarketClientContext | undefined;
};

export type PurchasedMarketItem = {
  itemInstanceId: string;
  templateId: string | null;
  formId: string | null;
};

export type BuyMarketListingResponse = {
  orderId: string;
  purchasedItems: PurchasedMarketItem[];
  totalPriceKcoin: number;
  feeAmountKcoin: number;
  sellerNetAmountKcoin: number;
  buyerBalanceAfter: number;
};

export type UpdateMarketListingPriceInput = {
  listingId: string;
  newUnitPriceKcoin: number;
  idempotencyKey?: string | undefined;
  clientContext?: MarketClientContext | undefined;
};

export type UpdateMarketListingPriceResponse = {
  listingId: string;
  unitPriceKcoin: number;
  expectedNetAmountKcoin: number;
  status: MarketListingStatus | null;
};

export type CancelMarketListingInput = {
  listingId: string;
  reason?: MarketCancelReason | undefined;
  idempotencyKey?: string | undefined;
  clientContext?: MarketClientContext | undefined;
};

export type CancelMarketListingResponse = {
  listingId: string;
  status: MarketListingStatus;
  releasedItemInstanceIds: string[];
  cancelledAt: string | null;
};
