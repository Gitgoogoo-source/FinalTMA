import { apiRequest } from "@/api/client";
import { API_ENDPOINTS } from "@/api/endpoints";

import { getRarityLabel } from "./trade.utils";
import type {
  BuyMarketListingInput,
  BuyMarketListingResponse,
  CancelMarketListingInput,
  CancelMarketListingResponse,
  CreateMarketListingInput,
  CreateMarketListingResponse,
  MarketClientContext,
  MarketClientContextSource,
  MarketCurrencyCode,
  MarketDepthLevel,
  MarketListingCard,
  MarketListingDetail,
  MarketListingDetailResponse,
  MarketListingSeller,
  MarketListingStatus,
  MarketListingsQuery,
  MarketListingsResponse,
  MarketMyListingSort,
  MarketMyListingsQuery,
  MarketMyListingsResponse,
  MarketMyListingStats,
  MarketPriceHealth,
  MarketPriceStats,
  MarketSellableItemsQuery,
  MarketSellableItemsResponse,
  MarketStatsQuery,
  MarketStatsResponse,
  MyListing,
  PurchasedMarketItem,
  SellableItemGroup,
  UpdateMarketListingPriceInput,
  UpdateMarketListingPriceResponse,
} from "./trade.types";

export async function fetchMarketListings(
  query: MarketListingsQuery = {},
): Promise<MarketListingsResponse> {
  const queryString = buildMarketListingsQuery(query);
  const response = await apiRequest<unknown>(
    withQuery(API_ENDPOINTS.market.listings, queryString),
    {
      method: "GET",
    },
  );

  return normalizeMarketListingsResponse(response);
}

export async function fetchMarketListingDetail(
  listingId: string,
): Promise<MarketListingDetailResponse> {
  const params = new URLSearchParams({
    listing_id: listingId,
  });
  const response = await apiRequest<unknown>(
    `${API_ENDPOINTS.market.listingDetail}?${params.toString()}`,
    {
      method: "GET",
    },
  );

  return normalizeMarketListingDetailResponse(response);
}

export async function fetchSellableItems(
  query: MarketSellableItemsQuery = {},
): Promise<MarketSellableItemsResponse> {
  const queryString = buildSellableItemsQuery(query);
  const response = await apiRequest<unknown>(
    withQuery(API_ENDPOINTS.market.sellableItems, queryString),
    {
      method: "GET",
    },
  );

  return normalizeSellableItemsResponse(response);
}

export async function createMarketListing(
  input: CreateMarketListingInput,
): Promise<CreateMarketListingResponse> {
  const idempotencyKey =
    input.idempotencyKey ?? createIdempotencyKey("market:create");
  const response = await apiRequest<unknown>(
    API_ENDPOINTS.market.createListing,
    {
      method: "POST",
      body: {
        item_instance_ids: input.itemInstanceIds,
        unit_price_kcoin: input.unitPriceKcoin,
        idempotency_key: idempotencyKey,
        client_context: createClientContext(
          input.clientContext,
          "trade_sell_tab",
          idempotencyKey,
        ),
      },
      headers: {
        "X-Idempotency-Key": idempotencyKey,
      },
    },
  );

  return normalizeCreateMarketListingResponse(response);
}

export async function buyMarketListing(
  input: BuyMarketListingInput,
): Promise<BuyMarketListingResponse> {
  const idempotencyKey =
    input.idempotencyKey ?? createIdempotencyKey("market:buy");
  const response = await apiRequest<unknown>(API_ENDPOINTS.market.buy, {
    method: "POST",
    body: {
      listing_id: input.listingId,
      quantity: input.quantity ?? 1,
      expected_unit_price_kcoin: input.expectedUnitPriceKcoin,
      idempotency_key: idempotencyKey,
      client_context: createClientContext(
        input.clientContext,
        "trade_buy_tab",
        idempotencyKey,
      ),
    },
    headers: {
      "X-Idempotency-Key": idempotencyKey,
    },
  });

  return normalizeBuyMarketListingResponse(response);
}

export async function fetchMyListings(
  query: MarketMyListingsQuery = {},
): Promise<MarketMyListingsResponse> {
  const queryString = buildMyListingsQuery(query);
  const response = await apiRequest<unknown>(
    withQuery(API_ENDPOINTS.market.myListings, queryString),
    {
      method: "GET",
    },
  );

  return normalizeMyListingsResponse(response);
}

export async function fetchMyListingStats(): Promise<MarketMyListingStats> {
  const response = await apiRequest<unknown>(
    API_ENDPOINTS.market.myListingStats,
    {
      method: "GET",
    },
  );

  return normalizeMyListingStats(response);
}

export async function updateMarketListingPrice(
  input: UpdateMarketListingPriceInput,
): Promise<UpdateMarketListingPriceResponse> {
  const idempotencyKey =
    input.idempotencyKey ?? createIdempotencyKey("market:price");
  const response = await apiRequest<unknown>(API_ENDPOINTS.market.updatePrice, {
    method: "POST",
    body: {
      listing_id: input.listingId,
      new_unit_price_kcoin: input.newUnitPriceKcoin,
      idempotency_key: idempotencyKey,
      client_context: createClientContext(
        input.clientContext,
        "trade_manage_tab",
        idempotencyKey,
      ),
    },
    headers: {
      "X-Idempotency-Key": idempotencyKey,
    },
  });

  return normalizeUpdateMarketListingPriceResponse(response);
}

export async function cancelMarketListing(
  input: CancelMarketListingInput,
): Promise<CancelMarketListingResponse> {
  const idempotencyKey =
    input.idempotencyKey ?? createIdempotencyKey("market:cancel");
  const response = await apiRequest<unknown>(
    API_ENDPOINTS.market.cancelListing,
    {
      method: "POST",
      body: {
        listing_id: input.listingId,
        reason: input.reason ?? "user_cancelled",
        idempotency_key: idempotencyKey,
        client_context: createClientContext(
          input.clientContext,
          "trade_manage_tab",
          idempotencyKey,
        ),
      },
      headers: {
        "X-Idempotency-Key": idempotencyKey,
      },
    },
  );

  return normalizeCancelMarketListingResponse(response);
}

export async function fetchMarketStats(
  query: MarketStatsQuery,
): Promise<MarketStatsResponse> {
  const queryString = buildMarketStatsQuery(query);
  const response = await apiRequest<unknown>(
    withQuery(API_ENDPOINTS.market.stats, queryString),
    {
      method: "GET",
    },
  );

  return normalizeMarketStatsResponse(response);
}

function buildMarketListingsQuery(query: MarketListingsQuery): string {
  const params = new URLSearchParams();

  appendArray(params, "rarities", query.rarities);
  appendArray(params, "type_codes", query.typeCodes);
  appendArray(params, "series_ids", query.seriesIds);
  appendArray(params, "template_ids", query.templateIds);
  appendNumber(params, "min_price", query.minPriceKcoin);
  appendNumber(params, "max_price", query.maxPriceKcoin);
  appendString(params, "sort", query.sort);
  appendString(params, "cursor", query.cursor);
  appendNumber(params, "limit", query.limit);

  return params.toString();
}

function buildSellableItemsQuery(query: MarketSellableItemsQuery): string {
  const params = new URLSearchParams();

  appendArray(params, "rarities", query.rarities);
  appendArray(params, "type_codes", query.typeCodes);
  appendArray(params, "series_ids", query.seriesIds);
  appendArray(params, "template_ids", query.templateIds);
  appendBoolean(params, "only_tradeable", query.onlyTradeable);
  appendBoolean(params, "only_duplicates", query.onlyDuplicates);
  appendNumber(params, "min_level", query.minLevel);
  appendNumber(params, "max_level", query.maxLevel);
  appendString(params, "sort", query.sort);
  appendString(params, "cursor", query.cursor);
  appendNumber(params, "limit", query.limit);

  return params.toString();
}

function buildMyListingsQuery(query: MarketMyListingsQuery): string {
  const params = new URLSearchParams();

  appendArray(params, "statuses", query.statuses);
  appendArray(params, "rarities", query.rarities);
  appendArray(params, "type_codes", query.typeCodes);
  appendArray(params, "template_ids", query.templateIds);
  appendNumber(params, "min_price", query.minPriceKcoin);
  appendNumber(params, "max_price", query.maxPriceKcoin);
  appendString(params, "sort", query.sort as MarketMyListingSort | undefined);
  appendString(params, "cursor", query.cursor);
  appendNumber(params, "limit", query.limit);

  return params.toString();
}

function buildMarketStatsQuery(query: MarketStatsQuery): string {
  const params = new URLSearchParams();

  appendString(params, "template_id", query.templateId);
  appendString(params, "form_id", query.formId);
  appendString(params, "series_id", query.seriesId);
  appendString(params, "rarity", query.rarity);
  appendString(params, "type_code", query.typeCode);
  appendString(params, "period", query.period);
  appendBoolean(params, "include_depth", query.includeDepth);

  return params.toString();
}

function normalizeMarketListingsResponse(
  response: unknown,
): MarketListingsResponse {
  const payload = isRecord(response) ? response : {};
  const items = Array.isArray(payload.items)
    ? payload.items.map(normalizeListingCard).filter(isListingCard)
    : [];

  return {
    items,
    nextCursor:
      readString(payload.nextCursor) ?? readString(payload.next_cursor),
  };
}

function normalizeMarketListingDetailResponse(
  response: unknown,
): MarketListingDetailResponse {
  const payload = isRecord(response) ? response : {};
  const source = payload.listing ?? payload;

  return {
    listing: normalizeListingDetail(source),
  };
}

function normalizeSellableItemsResponse(
  response: unknown,
): MarketSellableItemsResponse {
  const payload = isRecord(response) ? response : {};
  const items = Array.isArray(payload.items)
    ? payload.items.map(normalizeSellableItem).filter(isSellableItem)
    : [];

  return {
    items,
    nextCursor:
      readString(payload.nextCursor) ?? readString(payload.next_cursor),
  };
}

function normalizeMyListingsResponse(
  response: unknown,
): MarketMyListingsResponse {
  const payload = isRecord(response) ? response : {};
  const items = Array.isArray(payload.items)
    ? payload.items.map(normalizeMyListing).filter(isMyListing)
    : [];

  return {
    items,
    nextCursor:
      readString(payload.nextCursor) ?? readString(payload.next_cursor),
  };
}

function normalizeListingCard(value: unknown): MarketListingCard | null {
  if (!isRecord(value)) {
    return null;
  }

  const listingId = readString(value.listingId) ?? readString(value.listing_id);
  const templateId =
    readString(value.templateId) ?? readString(value.template_id);

  if (!listingId || !templateId) {
    return null;
  }

  const rarityCode =
    readString(value.rarityCode) ??
    readString(value.rarity_code) ??
    readString(value.rarity) ??
    "common";
  const isOwnListing =
    readBoolean(value.isOwnListing) ??
    readBoolean(value.is_own_listing) ??
    false;
  const serverCanBuy =
    readBoolean(value.canBuy) ??
    readBoolean(value.can_buy) ??
    readBoolean(value.isBuyable) ??
    readBoolean(value.is_buyable);

  return {
    listingId,
    sellerUserId:
      readString(value.sellerUserId) ?? readString(value.seller_user_id),
    templateId,
    formId: readString(value.formId) ?? readString(value.form_id),
    itemName:
      readString(value.itemName) ??
      readString(value.item_name) ??
      readString(value.name) ??
      "未命名藏品",
    rarityCode,
    rarityLabel:
      readString(value.rarityLabel) ??
      readString(value.rarity_label) ??
      getRarityLabel(rarityCode),
    typeCode: readString(value.typeCode) ?? readString(value.type_code),
    imageUrl: readString(value.imageUrl) ?? readString(value.image_url),
    serialNo:
      readNullableNumber(value.serialNo) ?? readNullableNumber(value.serial_no),
    unitPriceKcoin:
      readNumber(value.unitPriceKcoin) ??
      readNumber(value.unit_price_kcoin) ??
      0,
    currencyCode: normalizeCurrencyCode(
      readString(value.currencyCode) ?? readString(value.currency_code),
    ),
    itemCount: readNumber(value.itemCount) ?? readNumber(value.item_count) ?? 1,
    remainingCount:
      readNumber(value.remainingCount) ??
      readNumber(value.remaining_count) ??
      0,
    status: normalizeListingStatus(value.status),
    sellerDisplayName:
      readString(value.sellerDisplayName) ??
      readString(value.seller_display_name),
    priceHealth: normalizePriceHealth(value.priceHealth ?? value.price_health),
    isOwnListing,
    canBuy: serverCanBuy ?? false,
    notBuyableReason:
      readString(value.notBuyableReason) ??
      readString(value.not_buyable_reason) ??
      readString(value.disabledReason) ??
      readString(value.disabled_reason),
    createdAt: readString(value.createdAt) ?? readString(value.created_at),
    expiresAt: readString(value.expiresAt) ?? readString(value.expires_at),
  };
}

function normalizeListingDetail(value: unknown): MarketListingDetail | null {
  const card = normalizeListingCard(value);

  if (!card || !isRecord(value)) {
    return null;
  }

  const canBuy =
    readBoolean(value.canBuy) ??
    readBoolean(value.can_buy) ??
    readBoolean(value.isBuyable) ??
    readBoolean(value.is_buyable) ??
    card.canBuy;

  return {
    ...card,
    canBuy,
    description: readString(value.description),
    seller: normalizeSeller(value.seller),
    floorPriceKcoin:
      readNullableNumber(value.floorPriceKcoin) ??
      readNullableNumber(value.floor_price_kcoin),
    avgPriceKcoin:
      readNullableNumber(value.avgPriceKcoin) ??
      readNullableNumber(value.avg_price_kcoin),
    lastSalePriceKcoin:
      readNullableNumber(value.lastSalePriceKcoin) ??
      readNullableNumber(value.last_sale_price_kcoin),
    referencePriceKcoin:
      readNullableNumber(value.referencePriceKcoin) ??
      readNullableNumber(value.reference_price_kcoin),
    activeListingCount:
      readNumber(value.activeListingCount) ??
      readNumber(value.active_listing_count) ??
      0,
    saleCount24h:
      readNumber(value.saleCount24h) ?? readNumber(value.sale_count_24h) ?? 0,
    volume24hKcoin:
      readNumber(value.volume24hKcoin) ??
      readNumber(value.volume_24h_kcoin) ??
      0,
    snapshotAt: readString(value.snapshotAt) ?? readString(value.snapshot_at),
    marketDepth: readArray(value.marketDepth ?? value.market_depth)
      .map(normalizeDepthLevel)
      .filter(isDepthLevel),
    itemInstanceIds: readStringArray(
      value.itemInstanceIds ?? value.item_instance_ids,
    ),
    disabledReason:
      readString(value.disabledReason) ??
      readString(value.disabled_reason) ??
      card.notBuyableReason,
  };
}

function normalizeSeller(value: unknown): MarketListingSeller | null {
  if (!isRecord(value)) {
    return null;
  }

  return {
    userId: readString(value.userId) ?? readString(value.user_id),
    displayName:
      readString(value.displayName) ?? readString(value.display_name),
    avatarUrl: readString(value.avatarUrl) ?? readString(value.avatar_url),
  };
}

function normalizeSellableItem(value: unknown): SellableItemGroup | null {
  if (!isRecord(value)) {
    return null;
  }

  const itemInstanceId =
    readString(value.itemInstanceId) ?? readString(value.item_instance_id);
  const itemInstanceIds = readStringArray(
    value.itemInstanceIds ?? value.item_instance_ids,
  );
  const normalizedItemInstanceIds =
    itemInstanceIds.length > 0
      ? itemInstanceIds
      : itemInstanceId
        ? [itemInstanceId]
        : [];
  const templateId =
    readString(value.templateId) ?? readString(value.template_id);

  if (!templateId || normalizedItemInstanceIds.length === 0) {
    return null;
  }

  const rarityCode =
    readString(value.rarityCode) ??
    readString(value.rarity_code) ??
    readString(value.rarity) ??
    "common";
  const availableCount =
    readNumber(value.availableCount) ??
    readNumber(value.available_count) ??
    normalizedItemInstanceIds.length;

  return {
    itemInstanceId,
    itemInstanceIds: normalizedItemInstanceIds,
    templateId,
    formId: readString(value.formId) ?? readString(value.form_id),
    itemName:
      readString(value.itemName) ??
      readString(value.item_name) ??
      readString(value.name) ??
      "未命名藏品",
    rarityCode,
    rarityLabel:
      readString(value.rarityLabel) ??
      readString(value.rarity_label) ??
      getRarityLabel(rarityCode),
    typeCode: readString(value.typeCode) ?? readString(value.type_code),
    imageUrl: readString(value.imageUrl) ?? readString(value.image_url),
    serialNo:
      readNullableNumber(value.serialNo) ?? readNullableNumber(value.serial_no),
    level: readNumber(value.level) ?? 1,
    power: readNumber(value.power) ?? 0,
    ownedCount:
      readNumber(value.ownedCount) ??
      readNumber(value.owned_count) ??
      availableCount,
    availableCount,
    suggestedPriceKcoin:
      readNullableNumber(value.suggestedPriceKcoin) ??
      readNullableNumber(value.suggested_price_kcoin) ??
      readNullableNumber(value.suggestedPrice) ??
      readNullableNumber(value.suggested_price),
    minPriceKcoin:
      readNullableNumber(value.minPriceKcoin) ??
      readNullableNumber(value.min_price_kcoin) ??
      readNullableNumber(value.minPrice) ??
      readNullableNumber(value.min_price),
    maxPriceKcoin:
      readNullableNumber(value.maxPriceKcoin) ??
      readNullableNumber(value.max_price_kcoin) ??
      readNullableNumber(value.maxPrice) ??
      readNullableNumber(value.max_price),
    acquiredAt: readString(value.acquiredAt) ?? readString(value.acquired_at),
    isTradeable:
      readBoolean(value.isTradeable) ?? readBoolean(value.is_tradeable) ?? true,
  };
}

function normalizeMyListing(value: unknown): MyListing | null {
  const card = normalizeListingCard(value);

  if (!card || !isRecord(value)) {
    return null;
  }

  return {
    ...card,
    expectedNetAmountKcoin:
      readNullableNumber(value.expectedNetAmountKcoin) ??
      readNullableNumber(value.expected_net_amount_kcoin) ??
      readNullableNumber(value.expectedNetAmount) ??
      readNullableNumber(value.expected_net_amount),
    lastPriceChangedAt:
      readString(value.lastPriceChangedAt) ??
      readString(value.last_price_changed_at),
  };
}

function normalizeMyListingStats(response: unknown): MarketMyListingStats {
  const payload = isRecord(response) ? response : {};
  const activeCount =
    readNumber(payload.activeCount) ??
    readNumber(payload.active_count) ??
    readNumber(payload.activeListingCount) ??
    readNumber(payload.active_listing_count) ??
    0;

  return {
    activeCount,
    activeListingCount:
      readNumber(payload.activeListingCount) ??
      readNumber(payload.active_listing_count) ??
      activeCount,
    activeItemCount:
      readNumber(payload.activeItemCount) ??
      readNumber(payload.active_item_count) ??
      0,
    totalListingValueKcoin:
      readNumber(payload.totalListingValueKcoin) ??
      readNumber(payload.total_listing_value_kcoin) ??
      0,
    expectedNetAmountKcoin:
      readNumber(payload.expectedNetAmountKcoin) ??
      readNumber(payload.expected_net_amount_kcoin) ??
      0,
    sold24hCount:
      readNumber(payload.sold24hCount) ??
      readNumber(payload.sold_24h_count) ??
      0,
    sold24hValueKcoin:
      readNumber(payload.sold24hValueKcoin) ??
      readNumber(payload.sold_24h_value_kcoin) ??
      0,
  };
}

function normalizeCreateMarketListingResponse(
  response: unknown,
): CreateMarketListingResponse {
  const payload = isRecord(response) ? response : {};

  return {
    listingId:
      readString(payload.listingId) ?? readString(payload.listing_id) ?? "",
    itemCount:
      readNumber(payload.itemCount) ?? readNumber(payload.item_count) ?? 0,
    remainingCount:
      readNumber(payload.remainingCount) ??
      readNumber(payload.remaining_count) ??
      0,
    unitPriceKcoin:
      readNumber(payload.unitPriceKcoin) ??
      readNumber(payload.unit_price_kcoin) ??
      0,
    feeBps: readNumber(payload.feeBps) ?? readNumber(payload.fee_bps) ?? 0,
    expectedNetAmountKcoin:
      readNumber(payload.expectedNetAmountKcoin) ??
      readNumber(payload.expected_net_amount_kcoin) ??
      readNumber(payload.expectedNetAmount) ??
      readNumber(payload.expected_net_amount) ??
      0,
    status: normalizeListingStatus(payload.status),
    priceHealth: normalizePriceHealth(
      payload.priceHealth ?? payload.price_health,
    ),
    idempotent: readBoolean(payload.idempotent) ?? false,
  };
}

function normalizeBuyMarketListingResponse(
  response: unknown,
): BuyMarketListingResponse {
  const payload = isRecord(response) ? response : {};

  return {
    orderId: readString(payload.orderId) ?? readString(payload.order_id) ?? "",
    purchasedItems: readArray(payload.purchasedItems ?? payload.purchased_items)
      .map(normalizePurchasedItem)
      .filter(isPurchasedItem),
    totalPriceKcoin:
      readNumber(payload.totalPriceKcoin) ??
      readNumber(payload.total_price_kcoin) ??
      0,
    feeAmountKcoin:
      readNumber(payload.feeAmountKcoin) ??
      readNumber(payload.fee_amount_kcoin) ??
      0,
    sellerNetAmountKcoin:
      readNumber(payload.sellerNetAmountKcoin) ??
      readNumber(payload.seller_net_amount_kcoin) ??
      0,
    buyerBalanceAfter:
      readNumber(payload.buyerBalanceAfter) ??
      readNumber(payload.buyer_balance_after) ??
      0,
  };
}

function normalizePurchasedItem(value: unknown): PurchasedMarketItem | null {
  if (!isRecord(value)) {
    return null;
  }

  const itemInstanceId =
    readString(value.itemInstanceId) ?? readString(value.item_instance_id);

  if (!itemInstanceId) {
    return null;
  }

  return {
    itemInstanceId,
    templateId: readString(value.templateId) ?? readString(value.template_id),
    formId: readString(value.formId) ?? readString(value.form_id),
  };
}

function normalizeUpdateMarketListingPriceResponse(
  response: unknown,
): UpdateMarketListingPriceResponse {
  const payload = isRecord(response) ? response : {};

  return {
    listingId:
      readString(payload.listingId) ?? readString(payload.listing_id) ?? "",
    unitPriceKcoin:
      readNumber(payload.unitPriceKcoin) ??
      readNumber(payload.unit_price_kcoin) ??
      0,
    expectedNetAmountKcoin:
      readNumber(payload.expectedNetAmountKcoin) ??
      readNumber(payload.expected_net_amount_kcoin) ??
      readNumber(payload.expectedNetAmount) ??
      readNumber(payload.expected_net_amount) ??
      0,
    status:
      payload.status === undefined || payload.status === null
        ? null
        : normalizeListingStatus(payload.status),
  };
}

function normalizeCancelMarketListingResponse(
  response: unknown,
): CancelMarketListingResponse {
  const payload = isRecord(response) ? response : {};

  return {
    listingId:
      readString(payload.listingId) ?? readString(payload.listing_id) ?? "",
    status: normalizeListingStatus(payload.status),
    releasedItemInstanceIds: readStringArray(
      payload.releasedItemInstanceIds ??
        payload.released_item_instance_ids ??
        payload.released_item_ids,
    ),
    cancelledAt:
      readString(payload.cancelledAt) ?? readString(payload.cancelled_at),
  };
}

function normalizeMarketStatsResponse(response: unknown): MarketStatsResponse {
  const payload = isRecord(response) ? response : {};

  return {
    price: normalizePriceStats(payload.price),
    depth: readArray(payload.depth)
      .map(normalizeDepthLevel)
      .filter(isDepthLevel),
    priceHealth: normalizePriceHealth(
      payload.priceHealth ?? payload.price_health,
    ),
  };
}

function normalizePriceStats(value: unknown): MarketPriceStats | null {
  if (!isRecord(value)) {
    return null;
  }

  const templateId =
    readString(value.templateId) ?? readString(value.template_id);

  if (!templateId) {
    return null;
  }

  return {
    templateId,
    formId: readString(value.formId) ?? readString(value.form_id),
    floorPriceKcoin:
      readNullableNumber(value.floorPriceKcoin) ??
      readNullableNumber(value.floor_price_kcoin),
    avgPriceKcoin:
      readNullableNumber(value.avgPriceKcoin) ??
      readNullableNumber(value.avg_price_kcoin),
    lastSalePriceKcoin:
      readNullableNumber(value.lastSalePriceKcoin) ??
      readNullableNumber(value.last_sale_price_kcoin),
    activeListingCount:
      readNumber(value.activeListingCount) ??
      readNumber(value.active_listing_count) ??
      0,
    saleCount24h:
      readNumber(value.saleCount24h) ?? readNumber(value.sale_count_24h) ?? 0,
    volume24hKcoin:
      readNumber(value.volume24hKcoin) ??
      readNumber(value.volume_24h_kcoin) ??
      0,
    snapshotAt: readString(value.snapshotAt) ?? readString(value.snapshot_at),
  };
}

function normalizeDepthLevel(value: unknown): MarketDepthLevel | null {
  if (!isRecord(value)) {
    return null;
  }

  return {
    priceKcoin:
      readNumber(value.priceKcoin) ??
      readNumber(value.price_kcoin) ??
      readNumber(value.priceBucketKcoin) ??
      readNumber(value.price_bucket_kcoin) ??
      0,
    listingCount:
      readNumber(value.listingCount) ?? readNumber(value.listing_count) ?? 0,
    itemCount: readNumber(value.itemCount) ?? readNumber(value.item_count) ?? 0,
  };
}

function createClientContext(
  input: MarketClientContext | undefined,
  fallbackSource: MarketClientContextSource,
  idempotencyKey: string,
): Record<string, unknown> {
  return {
    source: input?.source ?? fallbackSource,
    client_nonce: input?.clientNonce ?? idempotencyKey,
    client_seen_at: input?.clientSeenAt ?? new Date().toISOString(),
  };
}

function createIdempotencyKey(prefix: string): string {
  const randomPart =
    typeof crypto !== "undefined" && "randomUUID" in crypto
      ? crypto.randomUUID()
      : `${Date.now()}-${Math.random().toString(16).slice(2)}`;

  return `${prefix}:${randomPart}`;
}

function withQuery(path: string, queryString: string): string {
  return queryString ? `${path}?${queryString}` : path;
}

function appendString(
  params: URLSearchParams,
  key: string,
  value: string | undefined,
): void {
  const trimmed = value?.trim();

  if (trimmed) {
    params.set(key, trimmed);
  }
}

function appendArray(
  params: URLSearchParams,
  key: string,
  values: readonly string[] | undefined,
): void {
  const normalized = values
    ?.map((value) => value.trim())
    .filter((value) => value.length > 0);

  if (normalized && normalized.length > 0) {
    params.set(key, normalized.join(","));
  }
}

function appendNumber(
  params: URLSearchParams,
  key: string,
  value: number | undefined,
): void {
  if (value !== undefined && Number.isFinite(value)) {
    params.set(key, String(Math.trunc(value)));
  }
}

function appendBoolean(
  params: URLSearchParams,
  key: string,
  value: boolean | undefined,
): void {
  if (value !== undefined) {
    params.set(key, String(value));
  }
}

function normalizeCurrencyCode(value: string | null): MarketCurrencyCode {
  return value === "KCOIN" ? "KCOIN" : "KCOIN";
}

function normalizeListingStatus(value: unknown): MarketListingStatus {
  const normalized = readString(value);

  if (
    normalized === "active" ||
    normalized === "partially_sold" ||
    normalized === "sold" ||
    normalized === "cancelled" ||
    normalized === "expired" ||
    normalized === "suspended"
  ) {
    return normalized;
  }

  return "active";
}

function normalizePriceHealth(value: unknown): MarketPriceHealth {
  const normalized = readString(value);

  if (
    normalized === "too_low" ||
    normalized === "healthy" ||
    normalized === "too_high" ||
    normalized === "unknown"
  ) {
    return normalized;
  }

  return "unknown";
}

function readString(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }

  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function readNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) {
    return Math.trunc(value);
  }

  if (typeof value === "string" && value.trim().length > 0) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? Math.trunc(parsed) : null;
  }

  return null;
}

function readNullableNumber(value: unknown): number | null {
  if (value === null || value === undefined) {
    return null;
  }

  return readNumber(value);
}

function readBoolean(value: unknown): boolean | null {
  if (typeof value === "boolean") {
    return value;
  }

  return null;
}

function readArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function readStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.map(readString).filter(isString);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isString(value: string | null): value is string {
  return value !== null;
}

function isListingCard(
  item: MarketListingCard | null,
): item is MarketListingCard {
  return item !== null;
}

function isSellableItem(
  item: SellableItemGroup | null,
): item is SellableItemGroup {
  return item !== null;
}

function isMyListing(item: MyListing | null): item is MyListing {
  return item !== null;
}

function isDepthLevel(
  level: MarketDepthLevel | null,
): level is MarketDepthLevel {
  return level !== null;
}

function isPurchasedItem(
  item: PurchasedMarketItem | null,
): item is PurchasedMarketItem {
  return item !== null;
}
