import { useCallback, useState } from "react";

import { getApiErrorMessage } from "@/api/errors";
import { useFeedback } from "@/app/providers/FeedbackProvider";

import { CancelListingDialog } from "../components/CancelListingDialog";
import { ChangePriceDialog } from "../components/ChangePriceDialog";
import { ListingStatsPanel } from "../components/ListingStatsPanel";
import { MyListingFilters } from "../components/MyListingFilters";
import { MyListingsList } from "../components/MyListingsList";
import { useCancelListing } from "../hooks/useCancelListing";
import { useMyListingFilters } from "../hooks/useMyListingFilters";
import { useMyListingStats, useMyListings } from "../hooks/useMyListings";
import { useUpdateListingPrice } from "../hooks/useUpdateListingPrice";
import type { MyListing } from "../trade.types";
import { formatKcoinWithUnit } from "../trade.utils";

export function ManageListingsPage() {
  const { pushToast } = useFeedback();
  const { filters, hasActiveFilters, query, resetFilters, updateFilter } =
    useMyListingFilters();
  const statsQuery = useMyListingStats();
  const listingsQuery = useMyListings(query);
  const updateListingPrice = useUpdateListingPrice();
  const cancelListing = useCancelListing();
  const [priceDialogListing, setPriceDialogListing] =
    useState<MyListing | null>(null);
  const [cancelDialogListing, setCancelDialogListing] =
    useState<MyListing | null>(null);

  const handleChangePrice = useCallback((listing: MyListing) => {
    setPriceDialogListing(listing);
  }, []);

  const handleClosePriceDialog = useCallback(() => {
    if (!updateListingPrice.isPending) {
      setPriceDialogListing(null);
    }
  }, [updateListingPrice.isPending]);

  const handleConfirmChangePrice = useCallback(
    (newUnitPriceKcoin: number) => {
      if (!priceDialogListing || updateListingPrice.isPending) {
        return;
      }

      updateListingPrice.mutate(
        {
          listingId: priceDialogListing.listingId,
          newUnitPriceKcoin,
        },
        {
          onSuccess: (result) => {
            setPriceDialogListing(null);
            pushToast({
              type: "success",
              title: "改价成功",
              message: `新单价 ${formatKcoinWithUnit(
                result.unitPriceKcoin,
              )}，预计到账 ${formatKcoinWithUnit(
                result.expectedNetAmountKcoin,
              )}。`,
            });
          },
          onError: (error) => {
            pushToast({
              type: "error",
              title: "改价失败",
              message: getApiErrorMessage(error),
            });
          },
        },
      );
    },
    [priceDialogListing, pushToast, updateListingPrice],
  );

  const handleCancel = useCallback((listing: MyListing) => {
    setCancelDialogListing(listing);
  }, []);

  const handleCloseCancelDialog = useCallback(() => {
    if (!cancelListing.isPending) {
      setCancelDialogListing(null);
    }
  }, [cancelListing.isPending]);

  const handleConfirmCancel = useCallback(() => {
    if (!cancelDialogListing || cancelListing.isPending) {
      return;
    }

    cancelListing.mutate(
      {
        listingId: cancelDialogListing.listingId,
      },
      {
        onSuccess: (result) => {
          setCancelDialogListing(null);
          pushToast({
            type: "success",
            title: "下架成功",
            message:
              result.releasedItemInstanceIds.length > 0
                ? `已释放 ${result.releasedItemInstanceIds.length} 个未售出藏品，可在出售页重新选择。`
                : "挂单已下架。",
          });
        },
        onError: (error) => {
          pushToast({
            type: "error",
            title: "下架失败",
            message: getApiErrorMessage(error),
          });
        },
      },
    );
  }, [cancelDialogListing, cancelListing, pushToast]);

  return (
    <section
      aria-labelledby="trade-tab-manage"
      className="trade-panel"
      data-testid="trade-manage-panel"
      id="trade-tab-panel-manage"
      role="tabpanel"
      tabIndex={0}
    >
      <div className="manage-listings-page">
        <ListingStatsPanel
          isError={statsQuery.isError}
          isFetching={statsQuery.isFetching}
          isLoading={statsQuery.isLoading}
          onRetry={() => {
            void statsQuery.refetch();
          }}
          stats={statsQuery.stats}
        />
        <MyListingFilters
          filters={filters}
          hasActiveFilters={hasActiveFilters}
          onFilterChange={updateFilter}
          onReset={resetFilters}
        />
        <MyListingsList
          hasActiveFilters={hasActiveFilters}
          isError={listingsQuery.isError}
          isFetching={listingsQuery.isFetching}
          isLoading={listingsQuery.isLoading}
          listings={listingsQuery.listings}
          onCancel={handleCancel}
          onChangePrice={handleChangePrice}
          onRetry={() => {
            void listingsQuery.refetch();
          }}
        />
        <ChangePriceDialog
          isPending={updateListingPrice.isPending}
          listing={priceDialogListing}
          onClose={handleClosePriceDialog}
          onConfirm={handleConfirmChangePrice}
          open={Boolean(priceDialogListing)}
        />
        <CancelListingDialog
          isPending={cancelListing.isPending}
          listing={cancelDialogListing}
          onClose={handleCloseCancelDialog}
          onConfirm={handleConfirmCancel}
          open={Boolean(cancelDialogListing)}
        />
      </div>
    </section>
  );
}
