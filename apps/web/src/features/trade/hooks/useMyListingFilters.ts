import { useCallback, useMemo, useState } from "react";

import type {
  MarketMyListingsQuery,
  MarketMyListingSort,
} from "../trade.types";

export type MyListingFiltersState = {
  minPriceKcoin: string;
  maxPriceKcoin: string;
  rarity: string;
  typeCode: string;
  sort: MarketMyListingSort;
};

export type MyListingFilterKey = keyof MyListingFiltersState;

const DEFAULT_FILTERS: MyListingFiltersState = {
  minPriceKcoin: "",
  maxPriceKcoin: "",
  rarity: "",
  typeCode: "",
  sort: "recently_listed",
};

export function useMyListingFilters() {
  const [filters, setFilters] =
    useState<MyListingFiltersState>(DEFAULT_FILTERS);

  const updateFilter = useCallback(
    <Key extends MyListingFilterKey>(
      key: Key,
      value: MyListingFiltersState[Key],
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

  const query = useMemo(() => buildMyListingsQuery(filters), [filters]);

  return {
    filters,
    hasActiveFilters: !areFiltersDefault(filters),
    query,
    resetFilters,
    updateFilter,
  };
}

function buildMyListingsQuery(
  filters: MyListingFiltersState,
): MarketMyListingsQuery {
  const query: MarketMyListingsQuery = {
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

function areFiltersDefault(filters: MyListingFiltersState): boolean {
  return (
    filters.minPriceKcoin === DEFAULT_FILTERS.minPriceKcoin &&
    filters.maxPriceKcoin === DEFAULT_FILTERS.maxPriceKcoin &&
    filters.rarity === DEFAULT_FILTERS.rarity &&
    filters.typeCode === DEFAULT_FILTERS.typeCode &&
    filters.sort === DEFAULT_FILTERS.sort
  );
}
