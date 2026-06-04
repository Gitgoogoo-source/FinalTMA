import { useCallback, useState } from "react";
import {
  Coins,
  Eye,
  PackageCheck,
  ShoppingBag,
  Sparkles,
  Store,
} from "lucide-react";

import { getApiErrorMessage } from "@/api/errors";
import { useFeedback } from "@/app/providers/FeedbackProvider";
import { useMyAssets } from "@/features/assets/hooks/useMyAssets";
import { ActivityBanner } from "@/features/banners/components/ActivityBanner";

import { BuyConfirmDialog } from "../components/BuyConfirmDialog";
import { ListingDetailSheet } from "../components/ListingDetailSheet";
import { MarketFilters } from "../components/MarketFilters";
import {
  isVisibleBuyListing,
  MarketListingGrid,
} from "../components/MarketListingGrid";
import { useBuyListing } from "../hooks/useBuyListing";
import { useMarketFilters } from "../hooks/useMarketFilters";
import { useMarketListings } from "../hooks/useMarketListings";
import type { MarketListingCard, MarketListingDetail } from "../trade.types";
import {
  formatKcoinWithUnit,
  getItemTypeLabel,
  getListingStatusLabel,
  getMarketBuyDisabledReason,
  getMarketRarityTone,
} from "../trade.utils";

export function BuyPage() {
  const { pushToast } = useFeedback();
  const { assets } = useMyAssets();
  const { filters, hasActiveFilters, query, resetFilters, updateFilter } =
    useMarketFilters();
  const { isError, isLoading, listings, refetch } = useMarketListings(query);
  const buyListing = useBuyListing();
  const [detailListingId, setDetailListingId] = useState<string | null>(null);
  const [detailPreviewListing, setDetailPreviewListing] =
    useState<MarketListingCard | null>(null);
  const [confirmListing, setConfirmListing] = useState<
    MarketListingCard | MarketListingDetail | null
  >(null);
  const kcoinAvailable = assets.kcoin.available;
  const visibleListings = listings.filter(isVisibleBuyListing);
  const featuredListing = visibleListings[0] ?? null;

  const handleOpenDetail = useCallback((listing: MarketListingCard) => {
    setDetailPreviewListing(listing);
    setDetailListingId(listing.listingId);
  }, []);

  const handleCloseDetail = useCallback(() => {
    setDetailListingId(null);
    setDetailPreviewListing(null);
  }, []);

  const handleOpenConfirm = useCallback(
    (listing: MarketListingCard | MarketListingDetail) => {
      setConfirmListing(listing);
    },
    [],
  );

  const handleCloseConfirm = useCallback(() => {
    if (!buyListing.isPending) {
      setConfirmListing(null);
    }
  }, [buyListing.isPending]);

  const handleConfirmBuy = useCallback(() => {
    if (!confirmListing || buyListing.isPending) {
      return;
    }

    buyListing.mutate(
      {
        listingId: confirmListing.listingId,
        quantity: 1,
        expectedUnitPriceKcoin: confirmListing.unitPriceKcoin,
      },
      {
        onSuccess: (result) => {
          setConfirmListing(null);
          pushToast({
            type: "success",
            title: "购买成功",
            message: `支付 ${formatKcoinWithUnit(result.totalPriceKcoin)}，资产和库存正在刷新。`,
          });
        },
        onError: (error) => {
          pushToast({
            type: "error",
            title: "购买失败",
            message: getApiErrorMessage(error),
          });
        },
      },
    );
  }, [buyListing, confirmListing, pushToast]);

  return (
    <section
      aria-labelledby="trade-tab-buy"
      className="trade-panel trade-panel--buy"
      data-testid="trade-buy-panel"
      id="trade-tab-panel-buy"
      role="tabpanel"
      tabIndex={0}
    >
      <div className="buy-market">
        {featuredListing ? (
          <FeaturedMarketListing
            balanceAvailable={kcoinAvailable}
            listing={featuredListing}
            onBuy={handleOpenConfirm}
            onOpenDetail={handleOpenDetail}
          />
        ) : (
          <ActivityBanner
            fallbackDescription="用 K-coin 购买出售中的藏品，市场状态以服务端返回为准。"
            fallbackTitle="精选藏品交易"
            label="市场活动"
          />
        )}
        <MarketActivityStrip listings={visibleListings} />
      </div>
      <MarketFilters
        filters={filters}
        hasActiveFilters={hasActiveFilters}
        onFilterChange={updateFilter}
        onReset={resetFilters}
      />
      <MarketListingGrid
        balanceAvailable={kcoinAvailable}
        isError={isError}
        isLoading={isLoading}
        listings={listings}
        onBuy={handleOpenConfirm}
        onOpenDetail={handleOpenDetail}
        onRetry={() => {
          void refetch();
        }}
      />
      <ListingDetailSheet
        balanceAvailable={kcoinAvailable}
        isBuying={buyListing.isPending}
        listingId={detailListingId}
        onBuy={handleOpenConfirm}
        onClose={handleCloseDetail}
        onRetryListings={() => {
          void refetch();
        }}
        open={Boolean(detailListingId)}
        previewListing={detailPreviewListing}
      />
      <BuyConfirmDialog
        balanceAvailable={kcoinAvailable}
        isPending={buyListing.isPending}
        listing={confirmListing}
        onClose={handleCloseConfirm}
        onConfirm={handleConfirmBuy}
        open={Boolean(confirmListing)}
      />
    </section>
  );
}

type FeaturedMarketListingProps = {
  listing: MarketListingCard;
  balanceAvailable: string;
  onBuy: (listing: MarketListingCard) => void;
  onOpenDetail: (listing: MarketListingCard) => void;
};

function FeaturedMarketListing({
  balanceAvailable,
  listing,
  onBuy,
  onOpenDetail,
}: FeaturedMarketListingProps) {
  const disabledReason = getMarketBuyDisabledReason(listing, balanceAvailable);
  const disabled = Boolean(disabledReason);

  const handleBuy = () => {
    if (!disabled) {
      onBuy(listing);
    }
  };

  return (
    <article
      className={`market-featured-listing market-featured-listing--${getMarketRarityTone(
        listing.rarityCode,
      )}`}
    >
      <div className="market-featured-listing__content">
        <span className="market-featured-listing__eyebrow">
          <Sparkles aria-hidden="true" size={15} strokeWidth={2.4} />
          精选挂单
        </span>
        <h2>{listing.itemName}</h2>
        <div className="market-featured-listing__badges">
          <span>{listing.rarityLabel}</span>
          <span>{formatSerialNo(listing.serialNo)}</span>
        </div>
        <dl className="market-featured-listing__metrics">
          <FeaturedMetric
            icon="coins"
            label="挂单价"
            value={formatKcoinWithUnit(listing.unitPriceKcoin)}
          />
          <FeaturedMetric
            icon="stock"
            label="剩余"
            value={`${listing.remainingCount} 件`}
          />
          <FeaturedMetric
            label="类型"
            value={getItemTypeLabel(listing.typeCode)}
          />
          <FeaturedMetric
            label="状态"
            value={getListingStatusLabel(listing.status)}
          />
        </dl>
        <div className="market-featured-listing__actions">
          <button onClick={() => onOpenDetail(listing)} type="button">
            <Eye aria-hidden="true" size={16} strokeWidth={2.4} />
            详情
          </button>
          <button
            disabled={disabled}
            onClick={handleBuy}
            title={disabledReason ?? undefined}
            type="button"
          >
            <ShoppingBag aria-hidden="true" size={16} strokeWidth={2.5} />
            {getFeaturedBuyLabel(listing, disabledReason)}
          </button>
        </div>
      </div>
      <button
        aria-label={`查看 ${listing.itemName} 详情`}
        className="market-featured-listing__media"
        onClick={() => onOpenDetail(listing)}
        type="button"
      >
        {listing.imageUrl ? (
          <img src={listing.imageUrl} alt="" />
        ) : (
          <span aria-hidden="true">{listing.itemName.slice(0, 1)}</span>
        )}
      </button>
    </article>
  );
}

function FeaturedMetric({
  icon,
  label,
  value,
}: {
  icon?: "coins" | "stock";
  label: string;
  value: string;
}) {
  return (
    <div>
      <dt>
        {icon === "coins" ? (
          <Coins aria-hidden="true" size={13} strokeWidth={2.4} />
        ) : null}
        {icon === "stock" ? (
          <PackageCheck aria-hidden="true" size={13} strokeWidth={2.4} />
        ) : null}
        {label}
      </dt>
      <dd>{value}</dd>
    </div>
  );
}

function MarketActivityStrip({ listings }: { listings: MarketListingCard[] }) {
  const listing = listings[0];

  if (!listing) {
    return null;
  }

  return (
    <aside className="market-activity-strip" aria-label="市场动态">
      <div className="market-activity-strip__avatar">
        {listing.imageUrl ? (
          <img src={listing.imageUrl} alt="" />
        ) : (
          <Store aria-hidden="true" size={17} strokeWidth={2.4} />
        )}
      </div>
      <p>
        <strong>{listing.sellerDisplayName ?? "市场玩家"}</strong>
        上架 {listing.itemName} {formatSerialNo(listing.serialNo)}，价格{" "}
        {formatKcoinWithUnit(listing.unitPriceKcoin)}
      </p>
      <span>{listings.length} 个可买</span>
      <i aria-hidden="true" />
    </aside>
  );
}

function formatSerialNo(serialNo: number | null): string {
  return serialNo ? `#${serialNo}` : "暂无编号";
}

function getFeaturedBuyLabel(
  listing: MarketListingCard,
  disabledReason: string | null,
): string {
  if (listing.isOwnListing) {
    return "自己的挂单";
  }

  if (disabledReason === "K-coin 余额不足") {
    return "余额不足";
  }

  return "购买";
}
