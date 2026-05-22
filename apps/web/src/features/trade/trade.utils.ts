import { formatCurrencyAmount } from "@/shared/lib/formatCurrency";

import {
  MARKET_ITEM_TYPE_LABELS,
  MARKET_LISTING_STATUS_LABELS,
  MARKET_PRICE_HEALTH_LABELS,
  MARKET_RARITY_LABELS,
} from "./trade.constants";
import type {
  MarketItemTypeCode,
  MarketListingStatus,
  MarketPriceHealth,
  MarketRarityCode,
  TradeTabId,
} from "./trade.types";

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

export function normalizeTradeTab(value: string | null): TradeTabId {
  if (value === "sell" || value === "manage") {
    return value;
  }

  return "buy";
}

function toNonNegativeInteger(value: number): number {
  if (!Number.isFinite(value) || value <= 0) {
    return 0;
  }

  return Math.trunc(value);
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
