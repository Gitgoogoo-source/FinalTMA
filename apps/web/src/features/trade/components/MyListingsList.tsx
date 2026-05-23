import { RefreshCw, Store } from "lucide-react";

import type { MyListing } from "../trade.types";

import { MyListingRow } from "./MyListingRow";

type MyListingsListProps = {
  hasActiveFilters: boolean;
  isError: boolean;
  isFetching: boolean;
  isLoading: boolean;
  listings: MyListing[];
  onCancel: (listing: MyListing) => void;
  onChangePrice: (listing: MyListing) => void;
  onRetry: () => void;
};

export function MyListingsList({
  hasActiveFilters,
  isError,
  isFetching,
  isLoading,
  listings,
  onCancel,
  onChangePrice,
  onRetry,
}: MyListingsListProps) {
  if (isLoading) {
    return (
      <div className="market-listing-state" role="status">
        <span className="market-listing-state__spinner" aria-hidden="true" />
        <strong>读取我的挂单</strong>
      </div>
    );
  }

  if (isError) {
    return (
      <div className="market-listing-state market-listing-state--error">
        <Store aria-hidden="true" size={30} strokeWidth={2.1} />
        <strong>我的挂单读取失败</strong>
        <button onClick={onRetry} type="button">
          <RefreshCw aria-hidden="true" size={14} strokeWidth={2.5} />
          重试
        </button>
      </div>
    );
  }

  if (listings.length === 0) {
    return (
      <div className="market-listing-state">
        <Store aria-hidden="true" size={30} strokeWidth={2.1} />
        <strong>{hasActiveFilters ? "没有符合条件的挂单" : "暂无挂单"}</strong>
        <span>
          {hasActiveFilters
            ? "当前筛选条件下没有自己的挂单。"
            : "上架成功后，这里会显示你的出售中和历史挂单。"}
        </span>
      </div>
    );
  }

  return (
    <section
      aria-busy={isFetching}
      aria-label="我的挂单列表"
      className="my-listings-list"
      data-testid="my-listings-list"
    >
      <div className="my-listings-list__header">
        <div>
          <span>我的挂单</span>
          <strong>{listings.length.toLocaleString("zh-CN")} 个结果</strong>
        </div>
        <span>{isFetching ? "同步中" : "已更新"}</span>
      </div>

      <div className="my-listings-list__items">
        {listings.map((listing) => (
          <MyListingRow
            key={listing.listingId}
            listing={listing}
            onCancel={onCancel}
            onChangePrice={onChangePrice}
          />
        ))}
      </div>
    </section>
  );
}
