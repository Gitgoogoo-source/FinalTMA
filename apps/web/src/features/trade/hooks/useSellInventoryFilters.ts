import { useCallback, useMemo, useState } from "react";

import type {
  MarketSellableItemSort,
  SellableItemGroup,
} from "../trade.types";
import { getSellableItemReferencePrice } from "../trade.utils";

export type SellInventoryFiltersState = {
  minPriceKcoin: string;
  maxPriceKcoin: string;
  rarity: string;
  typeCode: string;
  sort: MarketSellableItemSort;
};

export type SellInventoryFilterKey = keyof SellInventoryFiltersState;

const DEFAULT_FILTERS: SellInventoryFiltersState = {
  minPriceKcoin: "",
  maxPriceKcoin: "",
  rarity: "",
  typeCode: "",
  sort: "recently_obtained",
};

export function useSellInventoryFilters(items: SellableItemGroup[]) {
  const [filters, setFilters] =
    useState<SellInventoryFiltersState>(DEFAULT_FILTERS);

  const updateFilter = useCallback(
    <Key extends SellInventoryFilterKey>(
      key: Key,
      value: SellInventoryFiltersState[Key],
    ) => {
      setFilters((current) => ({
        ...current,
        [key]: value,
      }));
    },
    [],
  );

  const resetFilters = useCallback(() => {
    setFilters(DEFAULT_FILTERS);
  }, []);

  const filteredItems = useMemo(
    () => filterSellableItems(items, filters),
    [filters, items],
  );

  return {
    filters,
    filteredItems,
    hasActiveFilters: !areFiltersDefault(filters),
    resetFilters,
    updateFilter,
  };
}

function filterSellableItems(
  items: SellableItemGroup[],
  filters: SellInventoryFiltersState,
): SellableItemGroup[] {
  const minPrice = parseKcoinFilter(filters.minPriceKcoin);
  const maxPrice = parseKcoinFilter(filters.maxPriceKcoin);

  return [...items]
    .filter((item) => {
      if (filters.rarity && item.rarityCode !== filters.rarity) {
        return false;
      }

      if (filters.typeCode && item.typeCode !== filters.typeCode) {
        return false;
      }

      return matchesLocalPriceFilter(item, minPrice, maxPrice);
    })
    .sort((left, right) => compareSellableItems(left, right, filters.sort));
}

// Price filtering is intentionally local: it only filters the currently loaded
// sellable item list. If database-wide price filtering is needed later, add
// min/max price support to the API/RPC path instead (option B).
function matchesLocalPriceFilter(
  item: SellableItemGroup,
  minPrice: number | undefined,
  maxPrice: number | undefined,
): boolean {
  if (minPrice === undefined && maxPrice === undefined) {
    return true;
  }

  const referencePrice = getSellableItemReferencePrice(item);

  if (referencePrice === null) {
    return false;
  }

  if (minPrice !== undefined && referencePrice < minPrice) {
    return false;
  }

  if (maxPrice !== undefined && referencePrice > maxPrice) {
    return false;
  }

  return true;
}

function compareSellableItems(
  left: SellableItemGroup,
  right: SellableItemGroup,
  sort: MarketSellableItemSort,
): number {
  if (sort === "rarity_high_to_low") {
    return compareNumber(
      getRarityRank(right.rarityCode),
      getRarityRank(left.rarityCode),
    );
  }

  if (sort === "rarity_low_to_high") {
    return compareNumber(
      getRarityRank(left.rarityCode),
      getRarityRank(right.rarityCode),
    );
  }

  if (sort === "level_high_to_low") {
    return compareNumber(right.level, left.level);
  }

  if (sort === "level_low_to_high") {
    return compareNumber(left.level, right.level);
  }

  if (sort === "power_high_to_low") {
    return compareNumber(right.power, left.power);
  }

  if (sort === "power_low_to_high") {
    return compareNumber(left.power, right.power);
  }

  if (sort === "name_a_to_z") {
    return left.itemName.localeCompare(right.itemName);
  }

  return compareTimeDesc(left.acquiredAt, right.acquiredAt);
}

function parseKcoinFilter(value: string): number | undefined {
  const trimmed = value.trim();

  if (!trimmed) {
    return undefined;
  }

  const parsed = Number.parseInt(trimmed, 10);

  if (!Number.isFinite(parsed) || parsed < 0) {
    return undefined;
  }

  return parsed;
}

function areFiltersDefault(filters: SellInventoryFiltersState): boolean {
  return (
    filters.minPriceKcoin === DEFAULT_FILTERS.minPriceKcoin &&
    filters.maxPriceKcoin === DEFAULT_FILTERS.maxPriceKcoin &&
    filters.rarity === DEFAULT_FILTERS.rarity &&
    filters.typeCode === DEFAULT_FILTERS.typeCode &&
    filters.sort === DEFAULT_FILTERS.sort
  );
}

function compareNumber(left: number, right: number): number {
  return left === right ? 0 : left > right ? 1 : -1;
}

function compareTimeDesc(left: string | null, right: string | null): number {
  const leftTime = left ? Date.parse(left) : 0;
  const rightTime = right ? Date.parse(right) : 0;

  return compareNumber(rightTime, leftTime);
}

function getRarityRank(rarityCode: string): number {
  if (rarityCode === "mythic") return 5;
  if (rarityCode === "legendary") return 4;
  if (rarityCode === "epic") return 3;
  if (rarityCode === "rare") return 2;
  if (rarityCode === "common") return 1;

  return 0;
}
