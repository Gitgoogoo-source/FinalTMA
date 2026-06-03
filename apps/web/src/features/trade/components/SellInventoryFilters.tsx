import { useState, type ReactNode } from "react";
import {
  ArrowDownWideNarrow,
  BadgeDollarSign,
  ChevronDown,
  Gem,
  Grid2x2,
  RotateCcw,
} from "lucide-react";

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

type SellInventoryFilterMenu = "price" | "rarity" | "type" | "sort";

type FilterOption<Value extends string = string> = {
  value: Value;
  label: string;
};

const RARITY_MENU_OPTIONS: ReadonlyArray<FilterOption> = [
  { value: "", label: "Rarity" },
  ...RARITY_OPTIONS,
];

const TYPE_MENU_OPTIONS: ReadonlyArray<FilterOption> = [
  { value: "", label: "Type" },
  ...TYPE_OPTIONS,
];

const SORT_MENU_OPTIONS: ReadonlyArray<FilterOption<MarketSellableItemSort>> =
  MARKET_SELLABLE_ITEM_SORT_OPTIONS.map((option) => ({
    value: option.value,
    label: option.label,
  }));

export function SellInventoryFilters({
  filters,
  hasActiveFilters,
  onFilterChange,
  onReset,
}: SellInventoryFiltersProps) {
  const [openMenu, setOpenMenu] = useState<SellInventoryFilterMenu | null>(
    null,
  );
  const priceLabel = getPriceLabel(filters);
  const rarityLabel = getRarityLabel(filters.rarity);
  const typeLabel = getTypeLabel(filters.typeCode);
  const sortLabel = getSortLabel(filters.sort);

  function toggleMenu(menu: SellInventoryFilterMenu) {
    setOpenMenu((current) => (current === menu ? null : menu));
  }

  function handleReset() {
    onReset();
    setOpenMenu(null);
  }

  return (
    <section className="sell-inventory-filters" aria-label="出售页筛选">
      <div className="sell-inventory-filter-item">
        <FilterChip
          active={
            Boolean(filters.minPriceKcoin.trim()) ||
            Boolean(filters.maxPriceKcoin.trim())
          }
          icon={<BadgeDollarSign aria-hidden="true" size={14} />}
          label={priceLabel}
          menuId="price"
          openMenu={openMenu}
          onClick={() => toggleMenu("price")}
        />
        {openMenu === "price" ? (
          <div className="sell-inventory-filter-menu" role="group">
            <label className="sell-inventory-filter-menu__field">
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
            <label className="sell-inventory-filter-menu__field">
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
            <button
              className="sell-inventory-filter-menu__clear"
              disabled={
                !filters.minPriceKcoin.trim() && !filters.maxPriceKcoin.trim()
              }
              onClick={() => {
                onFilterChange("minPriceKcoin", "");
                onFilterChange("maxPriceKcoin", "");
              }}
              type="button"
            >
              清空价格
            </button>
          </div>
        ) : null}
      </div>

      <div className="sell-inventory-filter-item">
        <FilterChip
          active={Boolean(filters.rarity)}
          icon={<Gem aria-hidden="true" size={14} />}
          label={rarityLabel}
          menuId="rarity"
          openMenu={openMenu}
          onClick={() => toggleMenu("rarity")}
        />
        {openMenu === "rarity" ? (
          <OptionsMenu
            currentValue={filters.rarity}
            options={RARITY_MENU_OPTIONS}
            onSelect={(value) => {
              onFilterChange("rarity", value);
              setOpenMenu(null);
            }}
          />
        ) : null}
      </div>

      <div className="sell-inventory-filter-item">
        <FilterChip
          active={Boolean(filters.typeCode)}
          icon={<Grid2x2 aria-hidden="true" size={14} />}
          label={typeLabel}
          menuId="type"
          openMenu={openMenu}
          onClick={() => toggleMenu("type")}
        />
        {openMenu === "type" ? (
          <OptionsMenu
            align="end"
            currentValue={filters.typeCode}
            options={TYPE_MENU_OPTIONS}
            onSelect={(value) => {
              onFilterChange("typeCode", value);
              setOpenMenu(null);
            }}
          />
        ) : null}
      </div>

      <div className="sell-inventory-filter-item">
        <FilterChip
          active={filters.sort !== "recently_obtained"}
          icon={<ArrowDownWideNarrow aria-hidden="true" size={14} />}
          label={sortLabel}
          menuId="sort"
          openMenu={openMenu}
          onClick={() => toggleMenu("sort")}
        />
        {openMenu === "sort" ? (
          <OptionsMenu
            align="end"
            currentValue={filters.sort}
            options={SORT_MENU_OPTIONS}
            onSelect={(value) => {
              onFilterChange("sort", value as MarketSellableItemSort);
              setOpenMenu(null);
            }}
          />
        ) : null}
      </div>

      <div className="sell-inventory-filter-item">
        <button
          aria-label="重置出售筛选"
          className="sell-inventory-filter-chip sell-inventory-filter-chip--reset"
          disabled={!hasActiveFilters}
          onClick={handleReset}
          type="button"
        >
          <RotateCcw aria-hidden="true" size={14} strokeWidth={2.4} />
          <span>all</span>
        </button>
      </div>
    </section>
  );
}

function FilterChip({
  active,
  icon,
  label,
  menuId,
  openMenu,
  onClick,
}: {
  active: boolean;
  icon: ReactNode;
  label: string;
  menuId: SellInventoryFilterMenu;
  openMenu: SellInventoryFilterMenu | null;
  onClick: () => void;
}) {
  const isOpen = openMenu === menuId;

  return (
    <button
      aria-expanded={isOpen}
      aria-haspopup="listbox"
      className={[
        "sell-inventory-filter-chip",
        active ? "sell-inventory-filter-chip--active" : "",
        isOpen ? "sell-inventory-filter-chip--open" : "",
      ]
        .filter(Boolean)
        .join(" ")}
      onClick={onClick}
      type="button"
    >
      {icon}
      <span>{label}</span>
      <ChevronDown aria-hidden="true" size={13} strokeWidth={2.4} />
    </button>
  );
}

function OptionsMenu<Value extends string>({
  align = "start",
  currentValue,
  options,
  onSelect,
}: {
  align?: "start" | "end";
  currentValue: Value | string;
  options: ReadonlyArray<FilterOption<Value>>;
  onSelect: (value: Value) => void;
}) {
  return (
    <div
      className={[
        "sell-inventory-filter-menu",
        align === "end" ? "sell-inventory-filter-menu--end" : "",
      ]
        .filter(Boolean)
        .join(" ")}
      role="listbox"
    >
      {options.map((option) => {
        const selected = currentValue === option.value;

        return (
          <button
            aria-selected={selected}
            className="sell-inventory-filter-menu__option"
            key={option.value || "all"}
            onClick={() => onSelect(option.value)}
            role="option"
            type="button"
          >
            {option.label}
          </button>
        );
      })}
    </div>
  );
}

function getPriceLabel(filters: SellInventoryFiltersState): string {
  const minPrice = filters.minPriceKcoin.trim();
  const maxPrice = filters.maxPriceKcoin.trim();

  if (minPrice && maxPrice) {
    return `${minPrice}-${maxPrice}K`;
  }

  if (minPrice) {
    return `>=${minPrice}K`;
  }

  if (maxPrice) {
    return `<=${maxPrice}K`;
  }

  return "Price";
}

function getRarityLabel(value: string): string {
  return (
    RARITY_OPTIONS.find((option) => option.value === value)?.label ?? "Rarity"
  );
}

function getTypeLabel(value: string): string {
  return TYPE_OPTIONS.find((option) => option.value === value)?.label ?? "Type";
}

function getSortLabel(value: MarketSellableItemSort): string {
  return (
    MARKET_SELLABLE_ITEM_SORT_OPTIONS.find((option) => option.value === value)
      ?.label ?? "Sort"
  );
}
