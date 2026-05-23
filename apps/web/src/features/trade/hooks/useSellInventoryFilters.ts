import { useCallback, useMemo, useState } from "react";

import type {
  MarketSellableItemsQuery,
  MarketSellableItemSort,
} from "../trade.types";

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

export function useSellInventoryFilters() {
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

  const query = useMemo(() => buildSellableItemsQuery(filters), [filters]);

  return {
    filters,
    hasActiveFilters: !areFiltersDefault(filters),
    query,
    resetFilters,
    updateFilter,
  };
}

function parseKcoinFilter(value: string): number | undefined {
  const trimmed = value.trim();

  if (!trimmed) {
    return undefined;
  }

  const parsed = Number(trimmed);

  if (!Number.isFinite(parsed) || !Number.isInteger(parsed) || parsed < 0) {
    return undefined;
  }

  return parsed;
}

function buildSellableItemsQuery(
  filters: SellInventoryFiltersState,
): MarketSellableItemsQuery {
  const query: MarketSellableItemsQuery = {
    limit: 50,
    sort: filters.sort,
  };
  const minPrice = parseKcoinFilter(filters.minPriceKcoin);
  const maxPrice = parseKcoinFilter(filters.maxPriceKcoin);

  if (filters.rarity) {
    query.rarities = [filters.rarity];
  }

  if (filters.typeCode) {
    query.typeCodes = [filters.typeCode];
  }

  if (minPrice !== undefined) {
    query.minPriceKcoin = minPrice;
  }

  if (maxPrice !== undefined) {
    query.maxPriceKcoin = maxPrice;
  }

  return query;
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
