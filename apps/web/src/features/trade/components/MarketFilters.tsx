import {
  ArrowDownUp,
  ChevronDown,
  Diamond,
  Grid2X2,
  RotateCcw,
  Tags,
} from "lucide-react";

import {
  MARKET_ITEM_TYPE_LABELS,
  MARKET_LISTING_SORT_OPTIONS,
  MARKET_RARITY_LABELS,
} from "../trade.constants";
import type {
  MarketItemTypeCode,
  MarketListingSort,
  MarketRarityCode,
} from "../trade.types";
import type {
  MarketFilterKey,
  MarketFiltersState,
} from "../hooks/useMarketFilters";

type MarketFiltersProps = {
  filters: MarketFiltersState;
  hasActiveFilters: boolean;
  onFilterChange: <Key extends MarketFilterKey>(
    key: Key,
    value: MarketFiltersState[Key],
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

export function MarketFilters({
  filters,
  hasActiveFilters,
  onFilterChange,
  onReset,
}: MarketFiltersProps) {
  return (
    <section className="market-filters" aria-label="购买页筛选">
      <div className="market-filters__row">
        <div className="market-filter market-filter--price">
          <Tags aria-hidden="true" size={17} strokeWidth={2.3} />
          <div className="market-filter__price-fields">
            <input
              aria-label="最低价"
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
            <span aria-hidden="true">-</span>
            <input
              aria-label="最高价"
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
          </div>
        </div>

        <label className="market-filter market-filter--select">
          <Diamond aria-hidden="true" size={17} strokeWidth={2.3} />
          <span>稀有</span>
          <select
            aria-label="稀有度"
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
          <ChevronDown
            aria-hidden="true"
            className="market-filter__chevron"
            size={15}
            strokeWidth={2.6}
          />
        </label>

        <label className="market-filter market-filter--select">
          <Grid2X2 aria-hidden="true" size={17} strokeWidth={2.3} />
          <span>类型</span>
          <select
            aria-label="类型"
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
          <ChevronDown
            aria-hidden="true"
            className="market-filter__chevron"
            size={15}
            strokeWidth={2.6}
          />
        </label>

        <label className="market-filter market-filter--select market-filter--sort">
          <ArrowDownUp aria-hidden="true" size={17} strokeWidth={2.3} />
          <span>排序</span>
          <select
            aria-label="排序"
            onChange={(event) =>
              onFilterChange(
                "sort",
                event.currentTarget.value as MarketListingSort,
              )
            }
            value={filters.sort}
          >
            {MARKET_LISTING_SORT_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
          <ChevronDown
            aria-hidden="true"
            className="market-filter__chevron"
            size={15}
            strokeWidth={2.6}
          />
        </label>

        {hasActiveFilters ? (
          <button
            className="market-filters__reset"
            onClick={onReset}
            type="button"
          >
            <RotateCcw aria-hidden="true" size={15} strokeWidth={2.4} />
            重置
          </button>
        ) : null}
      </div>
    </section>
  );
}
