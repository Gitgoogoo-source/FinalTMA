import { useMemo, useState, type ReactNode } from "react";
import {
  ArrowDownWideNarrow,
  CircleDot,
  Gem,
  Grid2x2,
  RotateCcw,
} from "lucide-react";

import type {
  CollectionInventoryFilters,
  CollectionInventoryGroup,
  CollectionInventorySort,
  CollectionInventoryStatusFilter,
} from "../collection.types";
import { CharacterThumb } from "./CharacterThumb";

type CharacterGridProps = {
  groups: CollectionInventoryGroup[];
  filterGroups: CollectionInventoryGroup[];
  selectedItemId: string | null;
  filters: CollectionInventoryFilters;
  hasActiveFilters: boolean;
  onFilterChange: <Key extends keyof CollectionInventoryFilters>(
    key: Key,
    value: CollectionInventoryFilters[Key],
  ) => void;
  onResetFilters: () => void;
  onSelect: (itemId: string) => void;
};

type CollectionFilterMenu = "rarity" | "type" | "status" | "sort";

type FilterOption<Value extends string = string> = {
  value: Value;
  label: string;
};

const TYPE_LABELS: Readonly<Record<string, string>> = {
  CHARACTER: "角色",
  PET: "宠物",
  EGG: "蛋",
  DECORATION: "装饰",
  PROP: "道具",
  MATERIAL: "材料",
  character: "角色",
  pet: "宠物",
  egg: "蛋",
  decoration: "装饰",
  prop: "道具",
  material: "材料",
};

const STATUS_LABELS: Readonly<Record<CollectionInventoryStatusFilter, string>> =
  {
    "": "状态",
    available: "可用",
    listed: "出售中",
    locked: "锁定",
    minting: "Mint中",
    minted: "已Mint",
  };

const SORT_OPTIONS: ReadonlyArray<FilterOption<CollectionInventorySort>> = [
  { value: "recently_obtained", label: "最新获得" },
  { value: "rarity_high_to_low", label: "稀有度从高到低" },
  { value: "rarity_low_to_high", label: "稀有度从低到高" },
  { value: "level_high_to_low", label: "等级从高到低" },
  { value: "level_low_to_high", label: "等级从低到高" },
  { value: "power_high_to_low", label: "战力从高到低" },
  { value: "power_low_to_high", label: "战力从低到高" },
  { value: "name_a_to_z", label: "名称 A-Z" },
];

export function CharacterGrid({
  groups,
  filterGroups,
  selectedItemId,
  filters,
  hasActiveFilters,
  onFilterChange,
  onResetFilters,
  onSelect,
}: CharacterGridProps) {
  const [openMenu, setOpenMenu] = useState<CollectionFilterMenu | null>(null);
  const rarityOptions = useMemo(
    () => getRarityOptions(filterGroups),
    [filterGroups],
  );
  const typeOptions = useMemo(
    () => getTypeOptions(filterGroups),
    [filterGroups],
  );
  const statusOptions = useMemo(
    () => getStatusOptions(filterGroups),
    [filterGroups],
  );

  function toggleMenu(menu: CollectionFilterMenu) {
    setOpenMenu((current) => (current === menu ? null : menu));
  }

  function handleReset() {
    onResetFilters();
    setOpenMenu(null);
  }

  return (
    <section className="character-grid" aria-label="藏品网格">
      <header className="character-grid__filters" aria-label="藏品筛选">
        <div className="character-grid-filter-item">
          <FilterChip
            active={Boolean(filters.rarity)}
            icon={<Gem aria-hidden="true" size={14} />}
            label={getOptionLabel(rarityOptions, filters.rarity, "稀有度")}
            menuId="rarity"
            openMenu={openMenu}
            onClick={() => toggleMenu("rarity")}
          />
          {openMenu === "rarity" ? (
            <OptionsMenu
              currentValue={filters.rarity}
              options={rarityOptions}
              onSelect={(value) => {
                onFilterChange("rarity", value);
                setOpenMenu(null);
              }}
            />
          ) : null}
        </div>

        <div className="character-grid-filter-item">
          <FilterChip
            active={Boolean(filters.typeCode)}
            icon={<Grid2x2 aria-hidden="true" size={14} />}
            label={getOptionLabel(typeOptions, filters.typeCode, "类型")}
            menuId="type"
            openMenu={openMenu}
            onClick={() => toggleMenu("type")}
          />
          {openMenu === "type" ? (
            <OptionsMenu
              currentValue={filters.typeCode}
              options={typeOptions}
              onSelect={(value) => {
                onFilterChange("typeCode", value);
                setOpenMenu(null);
              }}
            />
          ) : null}
        </div>

        <div className="character-grid-filter-item">
          <FilterChip
            active={Boolean(filters.status)}
            icon={<CircleDot aria-hidden="true" size={14} />}
            label={STATUS_LABELS[filters.status]}
            menuId="status"
            openMenu={openMenu}
            onClick={() => toggleMenu("status")}
          />
          {openMenu === "status" ? (
            <OptionsMenu
              currentValue={filters.status}
              options={statusOptions}
              onSelect={(value) => {
                onFilterChange(
                  "status",
                  value as CollectionInventoryStatusFilter,
                );
                setOpenMenu(null);
              }}
            />
          ) : null}
        </div>

        <div className="character-grid-filter-item">
          <FilterChip
            active={filters.sort !== "recently_obtained"}
            icon={<ArrowDownWideNarrow aria-hidden="true" size={14} />}
            label={getSortLabel(filters.sort)}
            menuId="sort"
            openMenu={openMenu}
            onClick={() => toggleMenu("sort")}
          />
          {openMenu === "sort" ? (
            <OptionsMenu
              align="end"
              currentValue={filters.sort}
              options={SORT_OPTIONS}
              onSelect={(value) => {
                onFilterChange("sort", value as CollectionInventorySort);
                setOpenMenu(null);
              }}
            />
          ) : null}
        </div>

        <div className="character-grid-filter-item">
          <button
            aria-label="重置藏品筛选"
            className="character-grid-filter-chip character-grid-filter-chip--reset"
            disabled={!hasActiveFilters}
            onClick={handleReset}
            type="button"
          >
            <RotateCcw aria-hidden="true" size={14} strokeWidth={2.4} />
            <span>all</span>
          </button>
        </div>
      </header>
      <div className="character-grid__track">
        {groups.length > 0 ? (
          <div className="character-grid__items">
            {groups.map((group) => (
              <CharacterThumb
                item={group.representativeItem}
                isSelected={
                  selectedItemId
                    ? group.itemInstanceIds.includes(selectedItemId)
                    : false
                }
                key={group.key}
                onSelect={onSelect}
                ownedCount={group.ownedCount}
              />
            ))}
          </div>
        ) : (
          <div className="character-grid__empty" role="status">
            没有符合条件的藏品
          </div>
        )}
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
  menuId: CollectionFilterMenu;
  openMenu: CollectionFilterMenu | null;
  onClick: () => void;
}) {
  const isOpen = openMenu === menuId;

  return (
    <button
      aria-expanded={isOpen}
      className={[
        "character-grid-filter-chip",
        active ? "character-grid-filter-chip--active" : "",
        isOpen ? "character-grid-filter-chip--open" : "",
      ]
        .filter(Boolean)
        .join(" ")}
      onClick={onClick}
      type="button"
    >
      {icon}
      <span>{label}</span>
    </button>
  );
}

function OptionsMenu<Value extends string>({
  align,
  currentValue,
  options,
  onSelect,
}: {
  align?: "start" | "end";
  currentValue: string;
  options: ReadonlyArray<FilterOption<Value>>;
  onSelect: (value: Value) => void;
}) {
  return (
    <div
      className={[
        "character-grid-filter-menu",
        align === "end" ? "character-grid-filter-menu--end" : "",
      ]
        .filter(Boolean)
        .join(" ")}
      role="group"
    >
      {options.map((option) => (
        <button
          aria-selected={option.value === currentValue}
          className="character-grid-filter-menu__option"
          key={option.value || "all"}
          onClick={() => onSelect(option.value)}
          type="button"
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}

function getRarityOptions(
  groups: CollectionInventoryGroup[],
): ReadonlyArray<FilterOption> {
  const options = new Map<
    string,
    { label: string; sortOrder: number | null }
  >();

  for (const group of groups) {
    const rarity = group.representativeItem.rarity;

    if (rarity.code) {
      options.set(rarity.code, {
        label: rarity.label || rarity.code,
        sortOrder: rarity.sortOrder,
      });
    }
  }

  return [
    { value: "", label: "稀有度" },
    ...Array.from(options.entries())
      .sort(
        ([, a], [, b]) =>
          getNullableSortValue(a.sortOrder) - getNullableSortValue(b.sortOrder),
      )
      .map(([value, option]) => ({
        value,
        label: option.label,
      })),
  ];
}

function getTypeOptions(
  groups: CollectionInventoryGroup[],
): ReadonlyArray<FilterOption> {
  const options = new Map<string, string>();

  for (const group of groups) {
    const typeCode = group.representativeItem.typeCode;

    if (typeCode) {
      options.set(typeCode, TYPE_LABELS[typeCode] ?? typeCode);
    }
  }

  return [
    { value: "", label: "类型" },
    ...Array.from(options.entries())
      .sort(([, a], [, b]) => a.localeCompare(b, "zh-CN"))
      .map(([value, label]) => ({ value, label })),
  ];
}

function getStatusOptions(
  groups: CollectionInventoryGroup[],
): ReadonlyArray<FilterOption<CollectionInventoryStatusFilter>> {
  const statuses: CollectionInventoryStatusFilter[] = [
    "available",
    "listed",
    "locked",
    "minting",
    "minted",
  ];

  return [
    { value: "", label: STATUS_LABELS[""] },
    ...statuses
      .filter((status) =>
        groups.some((group) => getGroupStatusCount(group, status) > 0),
      )
      .map((status) => ({
        value: status,
        label: STATUS_LABELS[status],
      })),
  ];
}

function getOptionLabel(
  options: ReadonlyArray<FilterOption>,
  value: string,
  fallback: string,
): string {
  if (!value) {
    return fallback;
  }

  return options.find((option) => option.value === value)?.label ?? fallback;
}

function getSortLabel(value: CollectionInventorySort): string {
  return (
    SORT_OPTIONS.find((option) => option.value === value)?.label ?? "最新获得"
  );
}

function getGroupStatusCount(
  group: CollectionInventoryGroup,
  status: CollectionInventoryStatusFilter,
): number {
  if (status === "available") {
    return group.availableCount;
  }
  if (status === "listed") {
    return group.listedCount;
  }
  if (status === "locked") {
    return group.lockedCount;
  }
  if (status === "minting") {
    return group.mintingCount;
  }
  if (status === "minted") {
    return group.mintedCount;
  }

  return group.ownedCount;
}

function getNullableSortValue(value: number | null): number {
  return value ?? Number.MAX_SAFE_INTEGER;
}
