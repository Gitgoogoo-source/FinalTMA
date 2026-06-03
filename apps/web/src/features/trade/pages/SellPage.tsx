import { useCallback, useEffect, useMemo, useState } from "react";

import { getApiErrorMessage } from "@/api/errors";
import { useFeedback } from "@/app/providers/FeedbackProvider";

import { ConfirmSellButton } from "../components/ConfirmSellButton";
import { SellFeePreview } from "../components/SellFeePreview";
import { SellInventoryFilters } from "../components/SellInventoryFilters";
import { SellInventoryGrid } from "../components/SellInventoryGrid";
import { SellPriceInput } from "../components/SellPriceInput";
import { SellQuantityStepper } from "../components/SellQuantityStepper";
import { SellSelectedItemCard } from "../components/SellSelectedItemCard";
import { MARKET_MAX_KCOIN_PRICE } from "../trade.constants";
import { useCreateListing } from "../hooks/useCreateListing";
import { useMarketSellRules } from "../hooks/useMarketSellRules";
import { useSellInventoryFilters } from "../hooks/useSellInventoryFilters";
import { useSellableItems } from "../hooks/useSellableItems";
import type { SellableItemGroup } from "../trade.types";
import {
  formatKcoinWithUnit,
  getSellableItemReferencePrice,
  getSellableItemSelectionKey,
} from "../trade.utils";

export function SellPage() {
  const { pushToast } = useFeedback();
  const { filters, hasActiveFilters, query, resetFilters, updateFilter } =
    useSellInventoryFilters();
  const sellableItemsQuery = useSellableItems(query);
  const sellRulesQuery = useMarketSellRules();
  const createListing = useCreateListing();
  const [selectedItem, setSelectedItem] = useState<SellableItemGroup | null>(
    null,
  );
  const [quantity, setQuantity] = useState(1);
  const [unitPriceInput, setUnitPriceInput] = useState("");
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
  const referencePrice = selectedItem
    ? getSellableItemReferencePrice(selectedItem)
    : null;
  const feeBps = sellRulesQuery.rules?.feeBps ?? null;
  const unitPriceValidation = useMemo(
    () => validateUnitPriceInput(unitPriceInput),
    [unitPriceInput],
  );
  const unitPriceKcoin = unitPriceValidation.value;
  const confirmDisabled =
    !selectedItem ||
    selectedItemInstanceIds.length === 0 ||
    unitPriceKcoin === null ||
    createListing.isPending;
  const confirmValidationMessage = getConfirmValidationMessage({
    hasItem: Boolean(selectedItem),
    hasSelectedIds: selectedItemInstanceIds.length > 0,
    priceError: unitPriceValidation.error,
    unitPriceKcoin,
  });

  useEffect(() => {
    if (!selectedItemKey || sellableItemsQuery.isLoading) {
      return;
    }

    if (!latestSelectedItem) {
      setSelectedItem(null);
      setQuantity(1);
      setUnitPriceInput("");
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

    setQuantity((current) =>
      clampQuantity(current, selectedItem.availableCount),
    );
  }, [selectedItem]);

  const handleSelectItem = useCallback((item: SellableItemGroup) => {
    setSelectedItem(item);
    setQuantity(1);
    setUnitPriceInput("");
  }, []);

  const handleQuantityChange = useCallback(
    (nextQuantity: number) => {
      setQuantity(clampQuantity(nextQuantity, availableCount));
    },
    [availableCount],
  );

  const handleConfirmSell = useCallback(() => {
    if (
      !selectedItem ||
      selectedItemInstanceIds.length === 0 ||
      unitPriceKcoin === null ||
      createListing.isPending
    ) {
      return;
    }

    createListing.mutate(
      {
        itemInstanceIds: selectedItemInstanceIds,
        unitPriceKcoin,
      },
      {
        onSuccess: (result) => {
          setSelectedItem(null);
          setQuantity(1);
          setUnitPriceInput("");
          pushToast({
            type: "success",
            title: "上架成功",
            message: `预计到手 ${formatKcoinWithUnit(
              result.expectedNetAmountKcoin,
            )}，市场和库存正在刷新。`,
          });
        },
        onError: (error) => {
          pushToast({
            type: "error",
            title: "上架失败",
            message: getApiErrorMessage(error),
          });
        },
      },
    );
  }, [
    createListing,
    pushToast,
    selectedItem,
    selectedItemInstanceIds,
    unitPriceKcoin,
  ]);

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

        <SellInventoryFilters
          filters={filters}
          hasActiveFilters={hasActiveFilters}
          onFilterChange={updateFilter}
          onReset={resetFilters}
        />

        <SellInventoryGrid
          isError={sellableItemsQuery.isError}
          isLoading={sellableItemsQuery.isLoading}
          isLoadingMore={sellableItemsQuery.isFetchingNextPage}
          items={sellableItemsQuery.items}
          hasMore={sellableItemsQuery.hasNextPage}
          onLoadMore={() => {
            void sellableItemsQuery.fetchNextPage();
          }}
          onRetry={() => {
            void sellableItemsQuery.refetch();
          }}
          onSelect={handleSelectItem}
          selectedItem={selectedItem}
        />

        <SellFeePreview
          feeBps={feeBps}
          isFeeRulesError={sellRulesQuery.isError}
          isFeeRulesLoading={sellRulesQuery.isLoading}
          item={selectedItem}
          quantity={quantity}
          unitPriceKcoin={unitPriceKcoin}
        />

        <section className="sell-settings" aria-label="出售设置">
          <div className="sell-settings__heading">
            <span>出售设置</span>
            <strong>{selectedItem ? "数量和价格" : "未选择藏品"}</strong>
          </div>
          <SellQuantityStepper
            availableCount={availableCount}
            disabled={!selectedItem}
            onChange={handleQuantityChange}
            quantity={quantity}
          />
          <SellPriceInput
            disabled={!selectedItem || createListing.isPending}
            error={unitPriceValidation.error}
            onChange={setUnitPriceInput}
            referencePriceKcoin={referencePrice}
            value={unitPriceInput}
          />
          <ConfirmSellButton
            disabled={confirmDisabled}
            feeBps={feeBps}
            isPending={createListing.isPending}
            item={selectedItem}
            onConfirm={handleConfirmSell}
            quantity={quantity}
            unitPriceKcoin={unitPriceKcoin}
            validationMessage={confirmValidationMessage}
          />
        </section>
      </div>
    </section>
  );
}

function validateUnitPriceInput(input: string): {
  value: number | null;
  error: string | null;
} {
  const trimmed = input.trim();

  if (!trimmed) {
    return {
      value: null,
      error: null,
    };
  }

  if (!/^\d+$/.test(trimmed)) {
    return {
      value: null,
      error: "价格必须是正整数",
    };
  }

  const value = Number(trimmed);

  if (!Number.isSafeInteger(value) || value <= 0) {
    return {
      value: null,
      error: "价格必须大于 0",
    };
  }

  if (value > MARKET_MAX_KCOIN_PRICE) {
    return {
      value: null,
      error: `价格不能超过 ${formatKcoinWithUnit(MARKET_MAX_KCOIN_PRICE)}`,
    };
  }

  return {
    value,
    error: null,
  };
}

function getConfirmValidationMessage(input: {
  hasItem: boolean;
  hasSelectedIds: boolean;
  priceError: string | null;
  unitPriceKcoin: number | null;
}): string | null {
  if (!input.hasItem) {
    return "请选择要出售的藏品";
  }

  if (!input.hasSelectedIds) {
    return "没有可出售的具体藏品";
  }

  if (input.priceError) {
    return input.priceError;
  }

  if (input.unitPriceKcoin === null) {
    return "请输入出售单价";
  }

  return null;
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
