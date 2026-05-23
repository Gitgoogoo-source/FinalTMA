import { RefreshCw, ShoppingBag } from "lucide-react";

import type { SellableItemGroup } from "../trade.types";
import { getSellableItemSelectionKey } from "../trade.utils";

import { SellItemCard } from "./SellItemCard";

type SellInventoryGridProps = {
  items: SellableItemGroup[];
  hasMore?: boolean;
  isLoading: boolean;
  isLoadingMore?: boolean;
  isError: boolean;
  selectedItem: SellableItemGroup | null;
  onLoadMore: () => void;
  onRetry: () => void;
  onSelect: (item: SellableItemGroup) => void;
};

export function SellInventoryGrid({
  isError,
  isLoading,
  isLoadingMore = false,
  items,
  hasMore = false,
  onLoadMore,
  onRetry,
  onSelect,
  selectedItem,
}: SellInventoryGridProps) {
  const selectedKey = selectedItem
    ? getSellableItemSelectionKey(selectedItem)
    : null;

  if (isLoading) {
    return (
      <div className="market-listing-state" role="status">
        <span className="market-listing-state__spinner" aria-hidden="true" />
        <strong>读取可出售库存</strong>
      </div>
    );
  }

  if (isError) {
    return (
      <div className="market-listing-state market-listing-state--error">
        <ShoppingBag aria-hidden="true" size={30} strokeWidth={2.1} />
        <strong>可出售库存读取失败</strong>
        <button onClick={onRetry} type="button">
          <RefreshCw aria-hidden="true" size={14} strokeWidth={2.5} />
          重试
        </button>
      </div>
    );
  }

  if (items.length === 0) {
    return (
      <div className="market-listing-state">
        <ShoppingBag aria-hidden="true" size={30} strokeWidth={2.1} />
        <strong>暂无可出售藏品</strong>
        <span>当前没有符合条件的可出售库存。</span>
      </div>
    );
  }

  return (
    <>
      <div className="sell-inventory-grid" aria-label="可出售藏品列表">
        {items.map((item) => {
          const itemKey = getSellableItemSelectionKey(item);

          return (
            <SellItemCard
              key={itemKey}
              isSelected={itemKey === selectedKey}
              item={item}
              onSelect={onSelect}
            />
          );
        })}
      </div>
      {hasMore ? (
        <div className="sell-inventory-grid__footer">
          <button disabled={isLoadingMore} onClick={onLoadMore} type="button">
            {isLoadingMore ? (
              <span
                className="market-listing-state__spinner"
                aria-hidden="true"
              />
            ) : null}
            {isLoadingMore ? "加载中" : "加载更多"}
          </button>
        </div>
      ) : null}
    </>
  );
}
