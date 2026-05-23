import { RotateCcw } from "lucide-react";

import {
  MARKET_ITEM_TYPE_LABELS,
  MARKET_RARITY_LABELS,
  MARKET_SELLABLE_ITEM_SORT_OPTIONS,
} from "../trade.constants";
import type {
  MarketItemTypeCode,
  MarketRarityCode,
  MarketSellableItemSort,
} from "../trade.types";
import type {
  SellInventoryFilterKey,
  SellInventoryFiltersState,
} from "../hooks/useSellInventoryFilters";

type SellInventoryFiltersProps = {
  filters: SellInventoryFiltersState;
  hasActiveFilters: boolean;
  onFilterChange: <Key extends SellInventoryFilterKey>(
    key: Key,
    value: SellInventoryFiltersState[Key],
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

export function SellInventoryFilters({
  filters,
  hasActiveFilters,
  onFilterChange,
  onReset,
}: SellInventoryFiltersProps) {
  return (
    <section className="sell-inventory-filters" aria-label="出售页筛选">
      <div className="market-filters__group market-filters__group--range">
        <label className="market-filter">
          <span>最低参考价</span>
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
          <span>最高参考价</span>
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

      <div className="market-filters__group">
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

      <div className="market-filters__group market-filters__group--sort">
        <label className="market-filter">
          <span>排序</span>
          <select
            onChange={(event) =>
              onFilterChange(
                "sort",
                event.currentTarget.value as MarketSellableItemSort,
              )
            }
            value={filters.sort}
          >
            {MARKET_SELLABLE_ITEM_SORT_OPTIONS.map((option) => (
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
          All
        </button>
      </div>
    </section>
  );
}
