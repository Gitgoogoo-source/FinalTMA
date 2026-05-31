import { useCallback, useState } from "react";

import { getApiErrorMessage } from "@/api/errors";
import { useFeedback } from "@/app/providers/FeedbackProvider";
import { useMyAssets } from "@/features/assets/hooks/useMyAssets";
import { ActivityBanner } from "@/features/banners/components/ActivityBanner";
import { useBanners } from "@/features/banners/hooks/useBanners";

import { BuyConfirmDialog } from "../components/BuyConfirmDialog";
import { ListingDetailSheet } from "../components/ListingDetailSheet";
import { MarketFilters } from "../components/MarketFilters";
import { MarketListingGrid } from "../components/MarketListingGrid";
import { useBuyListing } from "../hooks/useBuyListing";
import { useMarketFilters } from "../hooks/useMarketFilters";
import { useMarketListings } from "../hooks/useMarketListings";
import type { MarketListingCard, MarketListingDetail } from "../trade.types";
import { formatKcoinWithUnit } from "../trade.utils";

export function BuyPage() {
  const { pushToast } = useFeedback();
  const { assets } = useMyAssets();
  const { filters, hasActiveFilters, query, resetFilters, updateFilter } =
    useMarketFilters();
  const { isError, isLoading, listings, refetch } = useMarketListings(query);
  const bannerQuery = useBanners("market_top");
  const buyListing = useBuyListing();
  const [detailListingId, setDetailListingId] = useState<string | null>(null);
  const [detailPreviewListing, setDetailPreviewListing] =
    useState<MarketListingCard | null>(null);
  const [confirmListing, setConfirmListing] = useState<
    MarketListingCard | MarketListingDetail | null
  >(null);
  const kcoinAvailable = assets.kcoin.available;

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
      className="trade-panel"
      data-testid="trade-buy-panel"
      id="trade-tab-panel-buy"
      role="tabpanel"
      tabIndex={0}
    >
      <ActivityBanner
        banner={bannerQuery.primaryBanner}
        fallbackDescription="用 K-coin 购买出售中的藏品，市场状态以服务端返回为准。"
        fallbackTitle="精选藏品交易"
        label="市场活动"
      />
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
