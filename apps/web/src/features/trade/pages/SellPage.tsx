import { useCallback, useEffect, useMemo, useState } from "react";

import { SellInventoryFilters } from "../components/SellInventoryFilters";
import { SellInventoryGrid } from "../components/SellInventoryGrid";
import { SellQuantityStepper } from "../components/SellQuantityStepper";
import { SellSelectedItemCard } from "../components/SellSelectedItemCard";
import { useSellInventoryFilters } from "../hooks/useSellInventoryFilters";
import { useSellableItems } from "../hooks/useSellableItems";
import type { SellableItemGroup } from "../trade.types";
import { getSellableItemSelectionKey } from "../trade.utils";

export function SellPage() {
  const sellableItemsQuery = useSellableItems({
    limit: 50,
  });
  const {
    filteredItems,
    filters,
    hasActiveFilters,
    resetFilters,
    updateFilter,
  } = useSellInventoryFilters(sellableItemsQuery.items);
  const [selectedItem, setSelectedItem] = useState<SellableItemGroup | null>(
    null,
  );
  const [quantity, setQuantity] = useState(1);
  const selectedItemKey = selectedItem
    ? getSellableItemSelectionKey(selectedItem)
    : null;
  const latestSelectedItem = useMemo(
    () =>
      selectedItemKey
        ? (sellableItemsQuery.items.find(
            (item) => getSellableItemSelectionKey(item) === selectedItemKey,
          ) ?? null)
        : null,
    [sellableItemsQuery.items, selectedItemKey],
  );
  const availableCount = selectedItem?.availableCount ?? 0;
  const selectedItemInstanceIds = useMemo(
    () => getSelectedItemInstanceIds(selectedItem, quantity),
    [quantity, selectedItem],
  );

  useEffect(() => {
    if (!selectedItemKey || sellableItemsQuery.isLoading) {
      return;
    }

    if (!latestSelectedItem) {
      setSelectedItem(null);
      setQuantity(1);
      return;
    }

    if (latestSelectedItem !== selectedItem) {
      setSelectedItem(latestSelectedItem);
    }
  }, [
    latestSelectedItem,
    selectedItem,
    selectedItemKey,
    sellableItemsQuery.isLoading,
  ]);

  useEffect(() => {
    if (!selectedItem) {
      setQuantity(1);
      return;
    }

    setQuantity((current) => clampQuantity(current, selectedItem.availableCount));
  }, [selectedItem]);

  const handleSelectItem = useCallback((item: SellableItemGroup) => {
    setSelectedItem(item);
    setQuantity(1);
  }, []);

  const handleQuantityChange = useCallback(
    (nextQuantity: number) => {
      setQuantity(clampQuantity(nextQuantity, availableCount));
    },
    [availableCount],
  );

  return (
    <section
      aria-labelledby="trade-tab-sell"
      className="trade-panel"
      data-testid="trade-sell-panel"
      id="trade-tab-panel-sell"
      role="tabpanel"
      tabIndex={0}
    >
      <div className="sell-page">
        <SellSelectedItemCard
          item={selectedItem}
          quantity={quantity}
          selectedItemInstanceIds={selectedItemInstanceIds}
        />

        <section className="sell-settings" aria-label="出售设置">
          <div className="sell-settings__heading">
            <span>出售设置</span>
            <strong>{selectedItem ? "选择出售数量" : "未选择藏品"}</strong>
          </div>
          <SellQuantityStepper
            availableCount={availableCount}
            disabled={!selectedItem}
            onChange={handleQuantityChange}
            quantity={quantity}
          />
        </section>

        <SellInventoryFilters
          filters={filters}
          hasActiveFilters={hasActiveFilters}
          onFilterChange={updateFilter}
          onReset={resetFilters}
        />

        <SellInventoryGrid
          isError={sellableItemsQuery.isError}
          isLoading={sellableItemsQuery.isLoading}
          items={filteredItems}
          onRetry={() => {
            void sellableItemsQuery.refetch();
          }}
          onSelect={handleSelectItem}
          selectedItem={selectedItem}
        />
      </div>
    </section>
  );
}

function getSelectedItemInstanceIds(
  item: SellableItemGroup | null,
  quantity: number,
): string[] {
  if (!item) {
    return [];
  }

  const ids =
    item.itemInstanceIds.length > 0
      ? item.itemInstanceIds
      : item.itemInstanceId
        ? [item.itemInstanceId]
        : [];

  return ids.slice(0, clampQuantity(quantity, ids.length));
}

function clampQuantity(value: number, availableCount: number): number {
  const safeMax = Math.max(Math.trunc(availableCount), 0);

  if (safeMax <= 0) {
    return 1;
  }

  if (!Number.isFinite(value)) {
    return 1;
  }

  return Math.min(Math.max(Math.trunc(value), 1), safeMax);
}
