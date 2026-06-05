import { useCallback, useState } from "react";
import { Store } from "lucide-react";

import { getApiErrorMessage } from "@/api/errors";
import { useFeedback } from "@/app/providers/FeedbackProvider";
import { useMyAssets } from "@/features/assets/hooks/useMyAssets";
import { VipSubscriptionBanner } from "@/features/vip/components/VipSubscriptionBanner";
import { useCreateVipOrder } from "@/features/vip/hooks/useCreateVipOrder";
import {
  useVipStarsPayment,
  type VipStarsInvoiceCallbackResult,
} from "@/features/vip/hooks/useVipStarsPayment";
import { useVipStatus } from "@/features/vip/hooks/useVipStatus";

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
  const { assets } = useMyAssets();
  const { filters, hasActiveFilters, query, resetFilters, updateFilter } =
    useMarketFilters();
  const { isError, isLoading, listings, refetch } = useMarketListings(query);
  const buyListing = useBuyListing();
  const vipStatusQuery = useVipStatus();
  const createVipOrder = useCreateVipOrder();
  const openVipStarsInvoice = useVipStarsPayment();
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

  const handleVipInvoiceStatus = useCallback(
    (result: VipStarsInvoiceCallbackResult) => {
      if (result.status === "paid") {
        void vipStatusQuery.refetch();
        pushToast({
          type: "info",
          title: "支付已返回",
          message: "正在等待 Telegram webhook 和服务端开通月卡。",
        });
        return;
      }

      if (result.status === "cancelled" || result.status === "failed") {
        pushToast({
          type: result.status === "failed" ? "error" : "info",
          title: result.status === "failed" ? "支付未完成" : "支付窗口已关闭",
          message: "服务端尚未确认支付成功，可重新点击月卡入口购买。",
        });
      }
    },
    [pushToast, vipStatusQuery],
  );

  const handleSubscribeVip = useCallback(async () => {
    if (createVipOrder.isPending) {
      return;
    }

    try {
      const status = vipStatusQuery.data?.plan
        ? vipStatusQuery.data
        : (await vipStatusQuery.refetch()).data;
      const plan = status?.plan ?? null;

      if (!plan) {
        pushToast({
          type: "error",
          title: "暂时不能购买月卡",
          message: "服务端还没有返回可购买的月卡套餐，请稍后再试。",
        });
        return;
      }

      const order = await createVipOrder.mutateAsync({
        planId: plan.id,
      });
      const openAttempt = openVipStarsInvoice(order, handleVipInvoiceStatus);

      if (!openAttempt.ok) {
        pushToast({
          type: "error",
          title: "支付未打开，可重试支付",
          message: openAttempt.message,
        });
        return;
      }

      pushToast({
        type: "info",
        title: "月卡订单已创建",
        message: `请在 Telegram 支付窗口完成 ${order.xtrAmount} Stars 支付。`,
      });
    } catch (error) {
      pushToast({
        type: "error",
        title: "月卡订单创建失败",
        message: getApiErrorMessage(error),
      });
    }
  }, [
    createVipOrder,
    handleVipInvoiceStatus,
    openVipStarsInvoice,
    pushToast,
    vipStatusQuery,
  ]);

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
