import { useCallback, useEffect, useState } from "react";
import { Store } from "lucide-react";

import { getApiErrorMessage, isApiClientError } from "@/api/errors";
import { useFeedback } from "@/app/providers/FeedbackProvider";
import { useKcoinTopupSheet } from "@/features/assets/components/KcoinTopupProvider";
import { useMyAssets } from "@/features/assets/hooks/useMyAssets";
import { VipSubscriptionBanner } from "@/features/vip/components/VipSubscriptionBanner";
import { useCreateVipOrder } from "@/features/vip/hooks/useCreateVipOrder";
import { useVipStatus } from "@/features/vip/hooks/useVipStatus";
import { formatCurrencyAmount } from "@/shared/lib/formatCurrency";

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
import { formatKcoinWithUnit } from "../trade.utils";

export function BuyPage() {
  const { pushToast } = useFeedback();
  const { assets, refreshAssets } = useMyAssets();
  const { openKcoinTopupSheet } = useKcoinTopupSheet();
  const { filters, hasActiveFilters, query, resetFilters, updateFilter } =
    useMarketFilters();
  const { isError, isLoading, listings, refetch } = useMarketListings(query);
  const buyListing = useBuyListing();
  const vipStatusQuery = useVipStatus();
  const createVipOrder = useCreateVipOrder();
  const [resumeVipSubscribe, setResumeVipSubscribe] = useState(false);
  const [detailListingId, setDetailListingId] = useState<string | null>(null);
  const [detailPreviewListing, setDetailPreviewListing] =
    useState<MarketListingCard | null>(null);
  const [confirmListing, setConfirmListing] = useState<
    MarketListingCard | MarketListingDetail | null
  >(null);
  const kcoinAvailable = assets.kcoin.available;
  const visibleListings = listings.filter(isVisibleBuyListing);

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

  const handleSubscribeVip = useCallback(async () => {
    if (createVipOrder.isPending) {
      return;
    }

    try {
      const status = vipStatusQuery.data?.plan
        ? vipStatusQuery.data
        : (await vipStatusQuery.refetch()).data;
      const plan = status?.plan ?? null;
      const isVipActive = status?.isVip ?? false;

      if (!plan) {
        pushToast({
          type: "error",
          title: "暂时不能购买月卡",
          message: "服务端还没有返回可购买的月卡套餐，请稍后再试。",
        });
        return;
      }

      const requiredKcoin = plan.priceKcoin;
      const currentKcoin = readKcoinAmount(kcoinAvailable);

      if (requiredKcoin <= 0) {
        pushToast({
          type: "error",
          title: "暂时不能购买月卡",
          message: "月卡价格配置无效，请稍后再试。",
        });
        return;
      }

      if (currentKcoin < requiredKcoin) {
        openKcoinTopupSheet({
          requiredAmount: requiredKcoin,
          currentBalance: currentKcoin,
          intent: "VIP_MONTHLY",
          onFulfilled: () => setResumeVipSubscribe(true),
        });
        return;
      }

      const order = await createVipOrder.mutateAsync({
        planId: plan.id,
      });

      await Promise.all([refreshAssets(), vipStatusQuery.refetch()]);
      pushToast({
        type: "success",
        title: isVipActive ? "月卡已续费" : "月卡已开通",
        message: `已消耗 ${formatCurrencyAmount(order.kcoinAmount || requiredKcoin)} K-coin。`,
      });
    } catch (error) {
      if (isInsufficientKcoinError(error)) {
        const shortageDetails = readInsufficientKcoinTopupDetails(error);
        const fallbackRequired = vipStatusQuery.data?.plan?.priceKcoin ?? 0;

        openKcoinTopupSheet({
          requiredAmount:
            shortageDetails?.requiredAmount || fallbackRequired || 0,
          currentBalance: shortageDetails?.currentBalance ?? null,
          intent: "VIP_MONTHLY",
          onFulfilled: () => setResumeVipSubscribe(true),
        });
        return;
      }

      pushToast({
        type: "error",
        title: "月卡订单创建失败",
        message: getApiErrorMessage(error),
      });
    }
  }, [
    createVipOrder,
    kcoinAvailable,
    openKcoinTopupSheet,
    pushToast,
    refreshAssets,
    vipStatusQuery,
  ]);

  useEffect(() => {
    if (!resumeVipSubscribe) {
      return;
    }

    setResumeVipSubscribe(false);
    void handleSubscribeVip();
  }, [handleSubscribeVip, resumeVipSubscribe]);

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
        <VipSubscriptionBanner
          currentPeriodEnd={vipStatusQuery.data?.currentPeriodEnd ?? null}
          isLoading={vipStatusQuery.isLoading}
          isPending={createVipOrder.isPending}
          isVip={vipStatusQuery.data?.isVip ?? false}
          onSubscribe={handleSubscribeVip}
          plan={vipStatusQuery.data?.plan ?? null}
        />
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

function readKcoinAmount(value: string | number | null | undefined): number {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }

  if (typeof value === "string" && value.trim().length > 0) {
    const parsed = Number(value);

    return Number.isFinite(parsed) ? parsed : 0;
  }

  return 0;
}

function isInsufficientKcoinError(error: unknown): boolean {
  return (
    isApiClientError(error) &&
    (error.code === "INSUFFICIENT_KCOIN" ||
      error.code === "INSUFFICIENT_BALANCE")
  );
}

function readInsufficientKcoinTopupDetails(error: unknown): {
  requiredAmount: number;
  currentBalance: number;
} | null {
  if (!isApiClientError(error) || !isRecord(error.details)) {
    return null;
  }

  const requiredAmount = readDetailAmount(error.details.required);
  const currentBalance = readDetailAmount(error.details.balance);

  if (requiredAmount === null || currentBalance === null) {
    return null;
  }

  return {
    requiredAmount,
    currentBalance,
  };
}

function readDetailAmount(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }

  if (typeof value === "string" && value.trim().length > 0) {
    const parsed = Number(value);

    return Number.isFinite(parsed) ? parsed : null;
  }

  return null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
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
