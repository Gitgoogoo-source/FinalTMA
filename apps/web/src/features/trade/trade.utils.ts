import {
  formatCurrencyAmount,
  normalizeCurrencyAmount,
} from "@/shared/lib/formatCurrency";

import {
  MARKET_ITEM_TYPE_LABELS,
  MARKET_LISTING_STATUS_LABELS,
  MARKET_PRICE_HEALTH_LABELS,
  MARKET_RARITY_LABELS,
} from "./trade.constants";
import type {
  MarketItemTypeCode,
  MarketListingCard,
  MarketListingStatus,
  MarketPriceHealth,
  MarketRarityCode,
  SellableItemGroup,
  TradeTabId,
} from "./trade.types";

type MarketBuyState = Pick<
  MarketListingCard,
  | "canBuy"
  | "isOwnListing"
  | "notBuyableReason"
  | "remainingCount"
  | "unitPriceKcoin"
> & {
  disabledReason?: string | null;
};

export function formatKcoinAmount(value: unknown): string {
  return formatCurrencyAmount(value);
}

export function formatKcoinWithUnit(value: unknown): string {
  return `${formatKcoinAmount(value)} K-coin`;
}

export function calculateMarketFeePreview(
  unitPriceKcoin: number,
  itemCount: number,
  feeBps: number,
): {
  grossAmountKcoin: number;
  feeAmountKcoin: number;
  netAmountKcoin: number;
} {
  const safeUnitPrice = toNonNegativeInteger(unitPriceKcoin);
  const safeItemCount = toNonNegativeInteger(itemCount);
  const safeFeeBps = Math.min(toNonNegativeInteger(feeBps), 10_000);
  const grossAmountKcoin = safeUnitPrice * safeItemCount;
  const feeAmountKcoin = Math.floor((grossAmountKcoin * safeFeeBps) / 10_000);

  return {
    grossAmountKcoin,
    feeAmountKcoin,
    netAmountKcoin: Math.max(grossAmountKcoin - feeAmountKcoin, 0),
  };
}

export function getRarityLabel(rarityCode: string | null | undefined): string {
  if (isMarketRarityCode(rarityCode)) {
    return MARKET_RARITY_LABELS[rarityCode];
  }

  return rarityCode ?? "未知";
}

export function getItemTypeLabel(typeCode: string | null | undefined): string {
  if (isMarketItemTypeCode(typeCode)) {
    return MARKET_ITEM_TYPE_LABELS[typeCode];
  }

  return typeCode ?? "未知";
}

export function getPriceHealthLabel(priceHealth: MarketPriceHealth): string {
  return MARKET_PRICE_HEALTH_LABELS[priceHealth];
}

export function getListingStatusLabel(status: MarketListingStatus): string {
  return MARKET_LISTING_STATUS_LABELS[status];
}

export function getMarketBuyDisabledReason(
  listing: MarketBuyState,
  balanceAvailable?: string | null,
): string | null {
  if (listing.isOwnListing) {
    return "自己的挂单不能购买";
  }

  if (listing.remainingCount <= 0) {
    return "商品已售罄";
  }

  if (!listing.canBuy) {
    return mapMarketDisabledReason(
      listing.disabledReason ?? listing.notBuyableReason,
    );
  }

  if (
    balanceAvailable !== undefined &&
    !hasEnoughKcoin(balanceAvailable, listing.unitPriceKcoin)
  ) {
    return "K-coin 余额不足";
  }

  return null;
}

export function hasEnoughKcoin(
  balanceAvailable: string | null | undefined,
  priceKcoin: number,
): boolean {
  return (
    toCurrencyBigInt(balanceAvailable) >=
    BigInt(Math.max(Math.trunc(priceKcoin), 0))
  );
}

export function normalizeTradeTab(value: string | null): TradeTabId {
  if (value === "sell" || value === "manage") {
    return value;
  }

  return "buy";
}

export function getSellableItemSelectionKey(
  item: Pick<SellableItemGroup, "formId" | "itemInstanceId" | "templateId">,
): string {
  return [
    item.templateId,
    item.formId ?? "default-form",
    item.itemInstanceId ?? "group",
  ].join(":");
}

export function getSellableItemReferencePrice(
  item: Pick<
    SellableItemGroup,
    "maxPriceKcoin" | "minPriceKcoin" | "suggestedPriceKcoin"
  >,
): number | null {
  return (
    item.suggestedPriceKcoin ?? item.minPriceKcoin ?? item.maxPriceKcoin
  );
}

function toNonNegativeInteger(value: number): number {
  if (!Number.isFinite(value) || value <= 0) {
    return 0;
  }

  return Math.trunc(value);
}

function toCurrencyBigInt(value: string | null | undefined): bigint {
  const normalized = normalizeCurrencyAmount(value);

  try {
    return BigInt(normalized);
  } catch {
    return 0n;
  }
}

function mapMarketDisabledReason(reason: string | null | undefined): string {
  if (reason === "own_listing") {
    return "自己的挂单不能购买";
  }

  if (reason === "listing_sold_out") {
    return "商品已售罄";
  }

  if (reason === "listing_not_buyable") {
    return "当前挂单不可购买";
  }

  return "当前挂单不可购买";
}

function isMarketRarityCode(
  value: string | null | undefined,
): value is MarketRarityCode {
  return (
    value === "common" ||
    value === "rare" ||
    value === "epic" ||
    value === "legendary" ||
    value === "mythic"
  );
}

function isMarketItemTypeCode(
  value: string | null | undefined,
): value is MarketItemTypeCode {
  return (
    value === "character" ||
    value === "pet" ||
    value === "egg" ||
    value === "decoration" ||
    value === "prop" ||
    value === "material"
  );
}
