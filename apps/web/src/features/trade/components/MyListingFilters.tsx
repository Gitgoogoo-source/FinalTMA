import { RotateCcw } from "lucide-react";

import {
  MARKET_ITEM_TYPE_LABELS,
  MARKET_RARITY_LABELS,
} from "../trade.constants";
import type {
  MarketItemTypeCode,
  MarketMyListingSort,
  MarketRarityCode,
} from "../trade.types";
import type {
  MyListingFilterKey,
  MyListingFiltersState,
} from "../hooks/useMyListingFilters";

type MyListingFiltersProps = {
  filters: MyListingFiltersState;
  hasActiveFilters: boolean;
  onFilterChange: <Key extends MyListingFilterKey>(
    key: Key,
    value: MyListingFiltersState[Key],
  ) => void;
  onReset: () => void;
};

const RARITY_OPTIONS: ReadonlyArray<{
  value: MarketRarityCode;
  label: string;
}> = [
  { value: "common", label: MARKET_RARITY_LABELS.common },
  { value: "rare", label: MARKET_RARITY_LABELS.rare },
  { value: "epic", label: MARKET_RARITY_LABELS.epic },
  { value: "legendary", label: MARKET_RARITY_LABELS.legendary },
  { value: "mythic", label: MARKET_RARITY_LABELS.mythic },
];

const TYPE_OPTIONS: ReadonlyArray<{
  value: MarketItemTypeCode;
  label: string;
}> = [
  { value: "character", label: MARKET_ITEM_TYPE_LABELS.character },
  { value: "pet", label: MARKET_ITEM_TYPE_LABELS.pet },
  { value: "egg", label: MARKET_ITEM_TYPE_LABELS.egg },
  { value: "decoration", label: MARKET_ITEM_TYPE_LABELS.decoration },
  { value: "prop", label: MARKET_ITEM_TYPE_LABELS.prop },
  { value: "material", label: MARKET_ITEM_TYPE_LABELS.material },
];

const SORT_OPTIONS: ReadonlyArray<{
  value: MarketMyListingSort;
  label: string;
}> = [
  { value: "recently_listed", label: "最近上架" },
  { value: "price_high_to_low", label: "价格最高" },
  { value: "price_low_to_high", label: "价格最低" },
];

export function MyListingFilters({
  filters,
  hasActiveFilters,
  onFilterChange,
  onReset,
}: MyListingFiltersProps) {
  return (
    <section className="my-listing-filters" aria-label="我的挂单筛选">
      <div className="my-listing-filters__group my-listing-filters__group--range">
        <label className="market-filter">
          <span>最低价</span>
          <input
            inputMode="numeric"
            min={0}
            onChange={(event) =>
              onFilterChange("minPriceKcoin", event.currentTarget.value)
            }
            pattern="[0-9]*"
            placeholder="0"
            type="number"
            value={filters.minPriceKcoin}
          />
        </label>
        <label className="market-filter">
          <span>最高价</span>
          <input
            inputMode="numeric"
            min={0}
            onChange={(event) =>
              onFilterChange("maxPriceKcoin", event.currentTarget.value)
            }
            pattern="[0-9]*"
            placeholder="不限"
            type="number"
            value={filters.maxPriceKcoin}
          />
        </label>
      </div>

      <div className="my-listing-filters__group">
        <label className="market-filter">
          <span>稀有度</span>
          <select
            onChange={(event) =>
              onFilterChange("rarity", event.currentTarget.value)
            }
            value={filters.rarity}
          >
            <option value="">全部</option>
            {RARITY_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </label>

        <label className="market-filter">
          <span>类型</span>
          <select
            onChange={(event) =>
              onFilterChange("typeCode", event.currentTarget.value)
            }
            value={filters.typeCode}
          >
            <option value="">全部</option>
            {TYPE_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </label>
      </div>

      <div className="my-listing-filters__group my-listing-filters__group--sort">
        <label className="market-filter">
          <span>排序</span>
          <select
            onChange={(event) =>
              onFilterChange(
                "sort",
                event.currentTarget.value as MarketMyListingSort,
              )
            }
            value={filters.sort}
          >
            {SORT_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </label>

        <button
          className="market-filters__reset"
          disabled={!hasActiveFilters}
          onClick={onReset}
          type="button"
        >
          <RotateCcw aria-hidden="true" size={15} strokeWidth={2.4} />
          重置
        </button>
      </div>
    </section>
  );
}
