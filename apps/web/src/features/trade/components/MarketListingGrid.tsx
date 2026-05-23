import { RefreshCw, ShoppingBag } from "lucide-react";

import type { MarketListingCard as MarketListingCardType } from "../trade.types";

import { ListingCard } from "./ListingCard";

type MarketListingGridProps = {
  listings: MarketListingCardType[];
  isLoading: boolean;
  isError: boolean;
  onRetry: () => void;
};

export function MarketListingGrid({
  isError,
  isLoading,
  listings,
  onRetry,
}: MarketListingGridProps) {
  const visibleListings = listings.filter(isVisibleBuyListing);

  if (isLoading) {
    return (
      <div className="market-listing-state" role="status">
        <span className="market-listing-state__spinner" aria-hidden="true" />
        <strong>读取市场挂单</strong>
      </div>
    );
  }

  if (isError) {
    return (
      <div className="market-listing-state market-listing-state--error">
        <ShoppingBag aria-hidden="true" size={30} strokeWidth={2.1} />
        <strong>市场列表读取失败</strong>
        <button onClick={onRetry} type="button">
          <RefreshCw aria-hidden="true" size={14} strokeWidth={2.5} />
          重试
        </button>
      </div>
    );
  }

  if (visibleListings.length === 0) {
    return (
      <div className="market-listing-state">
        <ShoppingBag aria-hidden="true" size={30} strokeWidth={2.1} />
        <strong>暂无挂单</strong>
        <span>当前市场没有符合条件的可购买藏品。</span>
      </div>
    );
  }

  return (
    <div className="market-listing-grid" aria-label="市场挂单列表">
      {visibleListings.map((listing) => (
        <ListingCard key={listing.listingId} listing={listing} />
      ))}
    </div>
  );
}

function isVisibleBuyListing(listing: MarketListingCardType): boolean {
  return (
    listing.remainingCount > 0 &&
    (listing.status === "active" || listing.status === "partially_sold")
  );
}
