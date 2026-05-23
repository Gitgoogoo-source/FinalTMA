import { useCallback, useMemo, useState } from "react";

import type { MarketListingSort, MarketListingsQuery } from "../trade.types";

export type MarketFiltersState = {
  minPriceKcoin: string;
  maxPriceKcoin: string;
  rarity: string;
  typeCode: string;
  sort: MarketListingSort;
};

export type MarketFilterKey = keyof MarketFiltersState;

const DEFAULT_FILTERS: MarketFiltersState = {
  minPriceKcoin: "",
  maxPriceKcoin: "",
  rarity: "",
  typeCode: "",
  sort: "recently_listed",
};

export function useMarketFilters() {
  const [filters, setFilters] = useState<MarketFiltersState>(DEFAULT_FILTERS);

  const updateFilter = useCallback(
    <Key extends MarketFilterKey>(
      key: Key,
      value: MarketFiltersState[Key],
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

  const query = useMemo<MarketListingsQuery>(
    () => ({
      rarities: filters.rarity ? [filters.rarity] : undefined,
      typeCodes: filters.typeCode ? [filters.typeCode] : undefined,
      minPriceKcoin: parseKcoinFilter(filters.minPriceKcoin),
      maxPriceKcoin: parseKcoinFilter(filters.maxPriceKcoin),
      sort: filters.sort,
      limit: 24,
    }),
    [filters],
  );

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

  const parsed = Number.parseInt(trimmed, 10);

  if (!Number.isFinite(parsed) || parsed < 0) {
    return undefined;
  }

  return parsed;
}

function areFiltersDefault(filters: MarketFiltersState): boolean {
  return (
    filters.minPriceKcoin === DEFAULT_FILTERS.minPriceKcoin &&
    filters.maxPriceKcoin === DEFAULT_FILTERS.maxPriceKcoin &&
    filters.rarity === DEFAULT_FILTERS.rarity &&
    filters.typeCode === DEFAULT_FILTERS.typeCode &&
    filters.sort === DEFAULT_FILTERS.sort
  );
}
