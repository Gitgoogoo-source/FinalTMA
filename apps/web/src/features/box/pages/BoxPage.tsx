import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Gem, Gift, Loader2 } from "lucide-react";

import { getApiErrorMessage, isApiClientError } from "@/api/errors";
import { useFeedback } from "@/app/providers/FeedbackProvider";
import { useKcoinTopupSheet } from "@/features/assets/components/KcoinTopupProvider";
import { useMyAssets } from "@/features/assets/hooks/useMyAssets";
import { ActivityBanner } from "@/features/banners/components/ActivityBanner";
import { useBanners } from "@/features/banners/hooks/useBanners";
import { useClaimVipDailyBenefit } from "@/features/vip/hooks/useClaimVipDailyBenefit";
import { useClaimVipFreeBox } from "@/features/vip/hooks/useClaimVipFreeBox";
import { useVipStatus } from "@/features/vip/hooks/useVipStatus";
import { formatCurrencyAmount } from "@/shared/lib/formatCurrency";

import { BoxHero } from "../components/BoxHero";
import { BoxStatusBadge } from "../components/BoxStatusBadge";
import { BoxTierSelector } from "../components/BoxTierSelector";
import { DrawResultModal } from "../components/DrawResultModal";
import { OpenOnceButton } from "../components/OpenOnceButton";
import { OpenTenButton } from "../components/OpenTenButton";
import {
  PaymentPendingSheet,
  type PaymentOpenNotice,
} from "../components/PaymentPendingSheet";
import { PityProgress } from "../components/PityProgress";
import { PossibleRewardsRow } from "../components/PossibleRewardsRow";
import { PossibleRewardsSheet } from "../components/PossibleRewardsSheet";
import {
  getPaymentStatusMeta,
  isPaymentTerminalStatus,
  isPaymentRetryAllowed,
  normalizePaymentStatus,
} from "../box.status";
import type {
  BlindBox,
  CreateOpenOrderResponse,
  DrawResultResponse,
} from "../box.types";
import { useCreateOpenOrder } from "../hooks/useCreateOpenOrder";
import { useCachedBoxPity } from "../hooks/useCachedBoxPity";
import { useDrawResult } from "../hooks/useDrawResult";
import { useOpenVipDailyBox } from "../hooks/useOpenVipDailyBox";
import { usePaymentStatus } from "../hooks/usePaymentStatus";
import { usePendingDrawOrder } from "../hooks/usePendingDrawOrder";
import { usePaymentSupportConfig } from "../hooks/usePaymentSupportConfig";
import { getStaticBoxRewards } from "../staticRewards";
import { createStaticBoxes } from "../staticBoxes";
import {
  clearPendingStarsPaymentOrder,
  useStarsPayment,
  type PendingStarsPaymentOrder,
  type StarsInvoiceCallbackResult,
} from "../hooks/useStarsPayment";

export function BoxPage() {
  const { pushToast } = useFeedback();
  const [selectedBoxSlug, setSelectedBoxSlug] = useState<string | null>(null);
  const [rewardsOpen, setRewardsOpen] = useState(false);
  const [resultOrderId, setResultOrderId] = useState<string | null>(null);
  const [paymentPendingOrder, setPaymentPendingOrder] =
    useState<CreateOpenOrderResponse | null>(null);
  const [paymentOpenNotice, setPaymentOpenNotice] =
    useState<PaymentOpenNotice | null>(null);
  const [vipFreeModeSelected, setVipFreeModeSelected] = useState(false);
  const openRequestLockedRef = useRef(false);
  const { openKcoinTopupSheet } = useKcoinTopupSheet();
  const {
    error: pitySyncError,
    hasUsableCache: hasUsablePityCache,
    refresh: refreshPityCache,
    snapshot: pitySnapshot,
  } = useCachedBoxPity();
  const bannerQuery = useBanners("box_top");
  const vipStatusQuery = useVipStatus();
  const claimVipDaily = useClaimVipDailyBenefit();
  const claimVipFreeBox = useClaimVipFreeBox();
  const openVipDaily = useOpenVipDailyBox();
  const paymentSupportQuery = usePaymentSupportConfig({
    enabled: paymentPendingOrder !== null || resultOrderId !== null,
  });
  const boxes = useMemo(() => createStaticBoxes(pitySnapshot), [pitySnapshot]);
  const defaultBoxSlug = useMemo(() => getDefaultBoxSlug(boxes), [boxes]);

  useEffect(() => {
    if (!defaultBoxSlug) {
      setSelectedBoxSlug(null);
      return;
    }

    if (
      !selectedBoxSlug ||
      !boxes.some((box) => box.slug === selectedBoxSlug)
    ) {
      setSelectedBoxSlug(defaultBoxSlug);
    }
  }, [boxes, defaultBoxSlug, selectedBoxSlug]);

  const selectedBox =
    boxes.find((box) => box.slug === selectedBoxSlug) ?? boxes[0] ?? null;
  const staticRewards = useMemo(
    () => getStaticBoxRewards(selectedBox),
    [selectedBox],
  );
  const assetsQuery = useMyAssets();
  const kcoinAvailable = useMemo(
    () => readAssetAmount(assetsQuery.assets.kcoin.available),
    [assetsQuery.assets.kcoin.available],
  );
  const createOrder = useCreateOpenOrder();
  const openStarsInvoice = useStarsPayment();
  const restoredPendingDrawOrder = usePendingDrawOrder();
  const handleDrawCompleted = useCallback(
    (result: DrawResultResponse) => {
      clearPendingStarsPaymentOrder(result.orderId);
      void refreshPityCache();
      pushToast({
        type: "success",
        title: "开盒完成",
        message: `获得 ${formatCurrencyAmount(result.results.length || result.quantity)} 件藏品。`,
      });
    },
    [pushToast, refreshPityCache],
  );
  const drawResultQuery = useDrawResult(resultOrderId, {
    enabled: Boolean(resultOrderId),
    onCompleted: handleDrawCompleted,
  });
  const pendingStatusOrderId = paymentPendingOrder?.orderId ?? null;
  const pendingStatusQuery = usePaymentStatus(pendingStatusOrderId, {
    enabled: Boolean(pendingStatusOrderId) && resultOrderId === null,
  });
  const handleOpenRewards = useCallback(() => {
    setRewardsOpen(true);
  }, []);

  useEffect(() => {
    if (!restoredPendingDrawOrder || paymentPendingOrder || resultOrderId) {
      return;
    }

    setPaymentPendingOrder(
      createRestoredPendingOrder(restoredPendingDrawOrder),
    );
    setPaymentOpenNotice({
      status: "pending",
      detail: "已恢复上次未完成订单，正在向服务端确认支付状态。",
    });
  }, [paymentPendingOrder, restoredPendingDrawOrder, resultOrderId]);

  useEffect(() => {
    const result = pendingStatusQuery.result;

    if (!result || !paymentPendingOrder) {
      return;
    }

    if (result.orderId !== paymentPendingOrder.orderId) {
      return;
    }

    if (result.status === "completed") {
      clearPendingStarsPaymentOrder(result.orderId);
      setPaymentPendingOrder(null);
      setPaymentOpenNotice(null);
      setResultOrderId(result.orderId);
      return;
    }

    const nextPaymentStatus =
      result.paymentOrderStatus ??
      result.paymentStatus ??
      result.orderStatus ??
      getOrderPaymentStatus(paymentPendingOrder);
    const nextOrderStatus =
      result.orderStatus ?? paymentPendingOrder.orderStatus;
    const nextDrawCount =
      normalizeRestoredDrawCount(result.quantity) ??
      paymentPendingOrder.drawCount;
    const nextXtrAmount =
      result.paidStars > 0 ? result.paidStars : paymentPendingOrder.xtrAmount;
    const nextPaidAt = result.paidAt ?? paymentPendingOrder.paidAt ?? null;
    const nextFulfilledAt =
      result.completedAt ?? paymentPendingOrder.fulfilledAt ?? null;
    const nextInvoicePayload =
      result.invoicePayload ?? paymentPendingOrder.invoicePayload;

    if (
      nextPaymentStatus === getOrderPaymentStatus(paymentPendingOrder) &&
      nextOrderStatus === paymentPendingOrder.orderStatus &&
      nextDrawCount === paymentPendingOrder.drawCount &&
      nextXtrAmount === paymentPendingOrder.xtrAmount &&
      nextPaidAt === paymentPendingOrder.paidAt &&
      nextFulfilledAt === paymentPendingOrder.fulfilledAt &&
      nextInvoicePayload === paymentPendingOrder.invoicePayload
    ) {
      return;
    }

    if (isPaymentTerminalStatus(nextPaymentStatus ?? nextOrderStatus)) {
      clearPendingStarsPaymentOrder(result.orderId);
    }

    setPaymentPendingOrder({
      ...paymentPendingOrder,
      drawCount: nextDrawCount,
      fulfilledAt: nextFulfilledAt,
      invoicePayload: nextInvoicePayload,
      orderStatus: nextOrderStatus,
      paidAt: nextPaidAt,
      paymentOrderStatus: nextPaymentStatus,
      paymentStatus: nextPaymentStatus,
      resultReady: false,
      xtrAmount: nextXtrAmount,
    });
    if (!isPaymentRetryAllowed(nextPaymentStatus ?? nextOrderStatus)) {
      setPaymentOpenNotice(null);
    }
  }, [paymentPendingOrder, pendingStatusQuery.result]);
  const pendingDrawCount = createOrder.isPending
    ? (createOrder.variables?.drawCount ?? null)
    : openVipDaily.isPending
      ? 1
      : null;
  const isVip = vipStatusQuery.data?.isVip === true;
  const vipToday = vipStatusQuery.data?.today ?? null;
  const vipDailyFgemsAmount =
    vipToday?.fgemsAmount ?? vipStatusQuery.data?.plan?.dailyFgems ?? 0;
  const vipPlanFreeBoxCount = vipStatusQuery.data?.plan?.dailyFreeBoxCount ?? 0;
  const vipCanClaimFgems =
    isVip &&
    (vipToday?.canClaimFgems ?? vipToday?.canClaim) === true &&
    vipDailyFgemsAmount > 0;
  const vipFgemsClaimed =
    (vipToday?.fgemsClaimed ?? vipToday?.claimed) === true;
  const vipCanClaimFreeBox =
    isVip && vipToday?.canClaimFreeBox === true && vipPlanFreeBoxCount > 0;
  const vipFreeBoxClaimed = vipToday?.freeBoxClaimed === true;
  const vipHasFreeBoxAvailable =
    isVip && (vipToday?.freeBoxAvailable === true || vipFreeModeSelected);
  const shouldShowVipWelfareEntry = isVip;
  const selectedBoxUsesVipFreeOpen =
    selectedBox?.slug === "premium_egg" && vipHasFreeBoxAvailable;
  const vipFgemsActionDisabled =
    claimVipDaily.isPending ||
    claimVipFreeBox.isPending ||
    openVipDaily.isPending ||
    vipStatusQuery.isLoading ||
    !vipCanClaimFgems;
  const vipFreeBoxActionDisabled =
    claimVipDaily.isPending ||
    claimVipFreeBox.isPending ||
    openVipDaily.isPending ||
    vipStatusQuery.isLoading ||
    (!vipCanClaimFreeBox && !vipHasFreeBoxAvailable);
  const vipFgemsButtonText = getVipFgemsButtonText({
    fgemsAmount: vipDailyFgemsAmount,
    isLoading: vipStatusQuery.isLoading,
    isPending: claimVipDaily.isPending,
    canClaim: vipCanClaimFgems,
    claimed: vipFgemsClaimed,
  });
  const vipFreeBoxButtonText = getVipFreeBoxButtonText({
    isLoading: vipStatusQuery.isLoading,
    isPending: claimVipFreeBox.isPending,
    canClaim: vipCanClaimFreeBox,
    hasFreeBox: vipHasFreeBoxAvailable,
    claimed: vipFreeBoxClaimed,
  });
  const vipFreeBoxButtonDetail = getVipFreeBoxButtonDetail({
    freeBoxCount: vipPlanFreeBoxCount,
    canClaim: vipCanClaimFreeBox,
    hasFreeBox: vipHasFreeBoxAvailable,
  });

  useEffect(() => {
    if (
      vipStatusQuery.data &&
      vipStatusQuery.data.isVip === true &&
      vipToday?.freeBoxAvailable !== true
    ) {
      setVipFreeModeSelected(false);
    }
  }, [vipStatusQuery.data, vipToday?.freeBoxAvailable]);

  const handleVipFgemsClick = useCallback(() => {
    if (!isVip) {
      return;
    }

    if (
      claimVipDaily.isPending ||
      claimVipFreeBox.isPending ||
      openVipDaily.isPending
    ) {
      return;
    }

    if (!vipCanClaimFgems) {
      pushToast({
        type: "info",
        title: "今日 FGEMS 已领取",
        message: "明天可以继续领取月卡每日 FGEMS。",
      });
      return;
    }

    claimVipDaily.mutate(undefined, {
      onSuccess: (claim) => {
        pushToast({
          type: "success",
          title: "FGEMS 已领取",
          message: `已到账 ${formatCurrencyAmount(claim.fgemsAmount)} FGEMS。`,
        });
      },
      onError: (error) => {
        pushToast({
          type: "error",
          title: "领取 FGEMS 失败",
          message: getApiErrorMessage(error),
        });
      },
    });
  }, [
    claimVipDaily,
    claimVipFreeBox.isPending,
    isVip,
    openVipDaily.isPending,
    pushToast,
    vipCanClaimFgems,
  ]);

  const handleVipFreeBoxClick = useCallback(() => {
    if (!isVip) {
      return;
    }

    if (
      claimVipDaily.isPending ||
      claimVipFreeBox.isPending ||
      openVipDaily.isPending
    ) {
      return;
    }

    if (vipHasFreeBoxAvailable) {
      setSelectedBoxSlug("premium_egg");
      setVipFreeModeSelected(true);
      pushToast({
        type: "info",
        title: "已选择稀有蛋",
        message: "开 1 次将使用今日月卡免费盲盒。",
      });
      return;
    }

    if (!vipCanClaimFreeBox) {
      pushToast({
        type: "info",
        title: "今日免费盲盒不可领取",
        message: "明天可以继续领取一次月卡免费盲盒。",
      });
      return;
    }

    claimVipFreeBox.mutate(undefined, {
      onSuccess: (claim) => {
        if (claim.freeBoxAvailable) {
          setSelectedBoxSlug("premium_egg");
        }

        setVipFreeModeSelected(claim.freeBoxAvailable);
        pushToast({
          type: "success",
          title: "免费盲盒已领取",
          message: claim.freeBoxAvailable
            ? "已选择稀有蛋，开 1 次价格已切换为免费。"
            : "今日免费盲盒已领取。",
        });
      },
      onError: (error) => {
        pushToast({
          type: "error",
          title: "领取免费盲盒失败",
          message: getApiErrorMessage(error),
        });
      },
    });
  }, [
    claimVipDaily.isPending,
    claimVipFreeBox,
    isVip,
    openVipDaily.isPending,
    pushToast,
    vipCanClaimFreeBox,
    vipHasFreeBoxAvailable,
  ]);

  const handleVipFreeOpenSuccess = useCallback(
    (order: CreateOpenOrderResponse) => {
      setSelectedBoxSlug("premium_egg");
      setVipFreeModeSelected(false);
      setPaymentPendingOrder(null);
      setPaymentOpenNotice(null);
      setResultOrderId(order.orderId);
      clearPendingStarsPaymentOrder(order.orderId);
      pushToast({
        type: "success",
        title: "免费盲盒已开启",
        message: "已消耗今日月卡免费次数，开盒结果正在展示。",
      });
    },
    [pushToast],
  );

  const openActionDisabled =
    createOrder.isPending ||
    openVipDaily.isPending ||
    claimVipDaily.isPending ||
    claimVipFreeBox.isPending ||
    isPaymentOpenActionLocked(paymentPendingOrder) ||
    !selectedBox?.isOpenable;
  const handleInvoiceStatus = useCallback(
    (result: StarsInvoiceCallbackResult) => {
      setPaymentOpenNotice(getPaymentOpenNoticeFromInvoiceStatus(result));

      if (result.status === "paid") {
        pushToast({
          type: "info",
          title: "支付已返回",
          message: "正在等待 Telegram webhook 和服务端发货确认。",
        });
        return;
      }

      if (result.status === "cancelled" || result.status === "failed") {
        pushToast({
          type: result.status === "failed" ? "error" : "info",
          title: result.status === "failed" ? "支付未完成" : "支付窗口已关闭",
          message: "服务端尚未确认支付成功，可重试支付或刷新状态。",
        });
      }
    },
    [pushToast],
  );

  const openInvoiceForOrder = useCallback(
    (order: CreateOpenOrderResponse) => {
      if (order.resultReady || order.devPaymentProcessed) {
        setPaymentOpenNotice(null);
        return;
      }

      const paymentStatus = getOrderPaymentStatus(order);

      if (!isPaymentRetryAllowed(paymentStatus)) {
        setPaymentOpenNotice(null);
        pushToast({
          type: "info",
          title: "订单已进入服务端处理",
          message: "支付或发货状态已由服务端接管，请刷新发货状态。",
        });
        return;
      }

      setPaymentOpenNotice({
        status: "opening",
      });

      const openAttempt = openStarsInvoice(order, handleInvoiceStatus);

      if (!openAttempt.ok) {
        setPaymentOpenNotice({
          status: "not_opened",
          detail: openAttempt.message,
        });
        pushToast({
          type: "error",
          title: "支付未打开，可重试支付",
          message: openAttempt.message,
        });
      }
    },
    [handleInvoiceStatus, openStarsInvoice, pushToast],
  );

  const handleOpen = useCallback(
    (drawCount: 1 | 10) => {
      if (!selectedBox) {
        return;
      }

      if (!selectedBox.isOpenable) {
        pushToast({
          type: "error",
          title: "当前盲盒不可开启",
          message:
            selectedBox.disabledReason ?? "当前盲盒暂时不可开启，请稍后再试。",
        });
        return;
      }

      if (drawCount === 1 && selectedBoxUsesVipFreeOpen) {
        if (openVipDaily.isPending || openRequestLockedRef.current) {
          return;
        }

        openRequestLockedRef.current = true;
        openVipDaily.mutate(undefined, {
          onSuccess: handleVipFreeOpenSuccess,
          onError: (error) => {
            setVipFreeModeSelected(false);
            pushToast({
              type: "error",
              title: "免费盲盒开启失败",
              message: getApiErrorMessage(error),
            });
          },
          onSettled: () => {
            openRequestLockedRef.current = false;
          },
        });
        return;
      }

      if (createOrder.isPending || openRequestLockedRef.current) {
        return;
      }

      const requiredKcoin = getOpenRequiredKcoin(selectedBox, drawCount);

      if (kcoinAvailable < requiredKcoin) {
        openKcoinTopupSheet({
          requiredAmount: requiredKcoin,
        });
        return;
      }

      openRequestLockedRef.current = true;
      createOrder.mutate(
        {
          boxSlug: selectedBox.slug,
          drawCount,
        },
        {
          onSuccess: (order) => {
            if (order.resultReady && order.orderId) {
              clearPendingStarsPaymentOrder(order.orderId);
              setPaymentPendingOrder(null);
              setPaymentOpenNotice(null);
              setResultOrderId(order.orderId);
            } else {
              const paymentStatusMeta = getPaymentStatusMeta(
                getOrderPaymentStatus(order),
              );

              setResultOrderId(null);
              setPaymentPendingOrder(order);
              openInvoiceForOrder(order);

              pushToast({
                type: paymentStatusMeta.toastType,
                title: paymentStatusMeta.title,
                message: `${paymentStatusMeta.detail} 金额 ${formatCurrencyAmount(order.xtrAmount)} Stars。`,
              });
              return;
            }

            pushToast({
              type: "success",
              title: "开盒成功",
              message: `已消耗 ${formatCurrencyAmount(order.totalPriceKcoin || requiredKcoin)} K-coin，开盒结果正在展示。`,
            });
          },
          onError: (error) => {
            if (isInsufficientBalanceError(error)) {
              openKcoinTopupSheet({
                requiredAmount: requiredKcoin,
              });
              return;
            }

            pushToast({
              type: "error",
              title: "开盒请求失败",
              message: getApiErrorMessage(error),
            });
          },
          onSettled: () => {
            openRequestLockedRef.current = false;
          },
        },
      );
    },
    [
      createOrder,
      handleVipFreeOpenSuccess,
      kcoinAvailable,
      openKcoinTopupSheet,
      openInvoiceForOrder,
      openVipDaily,
      pushToast,
      selectedBox,
      selectedBoxUsesVipFreeOpen,
    ],
  );

  if (!selectedBox) {
    return (
      <section className="box-page box-page--state">
        <div className="box-page-state">
          <strong>暂无可展示盲盒</strong>
        </div>
      </section>
    );
  }

  return (
    <section className="box-page" data-testid="box-page">
      <ActivityBanner banner={bannerQuery.primaryBanner} label="开盒活动" />

      <BoxHero box={selectedBox} />

      {shouldShowVipWelfareEntry ? (
        <section className="box-welfare-entry" aria-label="月卡每日福利">
          <button
            className="box-welfare-entry__button"
            disabled={vipFgemsActionDisabled}
            onClick={handleVipFgemsClick}
            type="button"
          >
            {claimVipDaily.isPending ? (
              <Loader2
                className="box-welfare-entry__spinner"
                aria-hidden="true"
                size={18}
                strokeWidth={2.4}
              />
            ) : (
              <Gem aria-hidden="true" size={18} strokeWidth={2.4} />
            )}
            <span>{vipFgemsButtonText}</span>
            <strong>每日 FGEMS</strong>
          </button>
          <button
            className="box-welfare-entry__button"
            disabled={vipFreeBoxActionDisabled}
            onClick={handleVipFreeBoxClick}
            type="button"
          >
            {claimVipFreeBox.isPending ? (
              <Loader2
                className="box-welfare-entry__spinner"
                aria-hidden="true"
                size={18}
                strokeWidth={2.4}
              />
            ) : (
              <Gift aria-hidden="true" size={18} strokeWidth={2.4} />
            )}
            <span>{vipFreeBoxButtonText}</span>
            <strong>{vipFreeBoxButtonDetail}</strong>
          </button>
        </section>
      ) : null}

      <BoxTierSelector
        boxes={boxes}
        selectedBoxSlug={selectedBox.slug}
        onSelect={setSelectedBoxSlug}
      />

      {shouldShowBoxStatus(selectedBox) ? (
        <section className="box-page__status" aria-label="盲盒状态">
          <BoxStatusBadge
            status={selectedBox.status}
            disabledReason={selectedBox.disabledReason}
          />
        </section>
      ) : null}

      <PossibleRewardsRow
        rewards={staticRewards.items}
        isLoading={false}
        onOpen={handleOpenRewards}
      />

      <PityProgress box={selectedBox} />

      {pitySyncError && !hasUsablePityCache ? (
        <section className="box-page__status" aria-label="保底同步状态">
          <span className="box-status-badge box-status-badge--warning">
            保底同步失败 · 请稍后重试
          </span>
        </section>
      ) : null}

      <section className="box-open-actions" aria-label="开盒操作">
        <OpenOnceButton
          box={selectedBox}
          isPending={pendingDrawCount === 1}
          isDisabled={openActionDisabled}
          isFree={selectedBoxUsesVipFreeOpen}
          onOpen={() => handleOpen(1)}
        />
        <OpenTenButton
          box={selectedBox}
          isPending={pendingDrawCount === 10}
          isDisabled={openActionDisabled}
          onOpen={() => handleOpen(10)}
        />
      </section>

      <PossibleRewardsSheet
        open={rewardsOpen}
        box={selectedBox}
        rewards={staticRewards.items}
        isLoading={false}
        isError={false}
        poolVersion={staticRewards.poolVersion}
        pityRule={staticRewards.pityRule}
        generatedAt={staticRewards.generatedAt}
        errorMessage={null}
        onRetry={() => undefined}
        onClose={() => setRewardsOpen(false)}
      />

      <PaymentPendingSheet
        open={paymentPendingOrder !== null}
        order={paymentPendingOrder}
        invoiceOpenNotice={paymentOpenNotice}
        paymentSupport={paymentSupportQuery.config}
        onCheckResult={() => {
          if (paymentPendingOrder?.orderId) {
            const currentPaymentStatus =
              getOrderPaymentStatus(paymentPendingOrder);

            if (isFulfilledPaymentStatus(currentPaymentStatus)) {
              setResultOrderId(paymentPendingOrder.orderId);
              setPaymentPendingOrder(null);
              setPaymentOpenNotice(null);
              return;
            }

            if (!isPaymentRetryAllowed(currentPaymentStatus)) {
              setResultOrderId(paymentPendingOrder.orderId);
              setPaymentPendingOrder(null);
              setPaymentOpenNotice(null);
              return;
            }

            void pendingStatusQuery.refetch();
          }
        }}
        onRetryPayment={() => {
          if (
            paymentPendingOrder &&
            isPaymentRetryAllowed(getOrderPaymentStatus(paymentPendingOrder))
          ) {
            openInvoiceForOrder(paymentPendingOrder);
          }
        }}
        onClose={() => {
          setPaymentPendingOrder(null);
          setPaymentOpenNotice(null);
        }}
      />

      <DrawResultModal
        open={resultOrderId !== null}
        result={drawResultQuery.result}
        isLoading={drawResultQuery.isLoading}
        isError={drawResultQuery.isError}
        errorMessage={getRewardsErrorMessage(drawResultQuery.error)}
        paymentSupport={paymentSupportQuery.config}
        onRetry={() => void drawResultQuery.refetch()}
        onClose={() => setResultOrderId(null)}
      />
    </section>
  );
}

function getDefaultBoxSlug(boxes: BlindBox[]): string | null {
  return boxes.find((box) => box.isOpenable)?.slug ?? boxes[0]?.slug ?? null;
}

function shouldShowBoxStatus(box: BlindBox): boolean {
  return box.status !== "active" || !box.isOpenable;
}

function getVipFgemsButtonText(input: {
  fgemsAmount: number;
  isLoading: boolean;
  isPending: boolean;
  canClaim: boolean;
  claimed: boolean;
}): string {
  if (input.isPending) {
    return "领取中";
  }

  if (input.isLoading) {
    return "FGEMS";
  }

  if (input.canClaim) {
    return `领取 ${formatCurrencyAmount(input.fgemsAmount)} FGEMS`;
  }

  if (input.claimed && input.fgemsAmount > 0) {
    return `已领 ${formatCurrencyAmount(input.fgemsAmount)} FGEMS`;
  }

  return "今日已领取";
}

function getVipFreeBoxButtonText(input: {
  isLoading: boolean;
  isPending: boolean;
  canClaim: boolean;
  hasFreeBox: boolean;
  claimed: boolean;
}): string {
  if (input.isPending) {
    return "领取中";
  }

  if (input.isLoading) {
    return "免费盲盒";
  }

  if (input.hasFreeBox) {
    return "使用免费盲盒";
  }

  if (input.canClaim) {
    return "领取免费盲盒";
  }

  return input.claimed ? "今日已用" : "今日不可领";
}

function getVipFreeBoxButtonDetail(input: {
  freeBoxCount: number;
  canClaim: boolean;
  hasFreeBox: boolean;
}): string {
  if (input.canClaim) {
    return input.freeBoxCount > 0
      ? `可领 ${input.freeBoxCount} 次`
      : "今日可领";
  }

  if (input.hasFreeBox) {
    return "开 1 次免费";
  }

  return "明天再领";
}

function getRewardsErrorMessage(error: unknown): string | null {
  if (!(error instanceof Error)) {
    return null;
  }

  const message = error.message.trim();
  return message.length > 0 ? message : null;
}

function getPaymentOpenNoticeFromInvoiceStatus(
  result: StarsInvoiceCallbackResult,
): PaymentOpenNotice {
  switch (result.status) {
    case "paid":
      return {
        status: "paid",
      };
    case "cancelled":
      return {
        status: "cancelled",
      };
    case "failed":
      return {
        status: "failed",
      };
    case "pending":
      return {
        status: "pending",
      };
    case "unknown":
      return {
        status: "pending",
        detail: result.rawStatus
          ? `Telegram 返回状态 ${result.rawStatus}，请刷新后以服务端状态为准。`
          : "Telegram 未返回明确支付状态，请刷新后以服务端状态为准。",
      };
  }
}

function isFulfilledPaymentStatus(status: string | null | undefined): boolean {
  return normalizePaymentStatus(status) === "fulfilled";
}

function getOpenRequiredKcoin(box: BlindBox, drawCount: 1 | 10): number {
  return drawCount === 10 ? box.tenDrawPrice : box.singleStarPrice;
}

function readAssetAmount(value: string | number | null | undefined): number {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }

  if (typeof value === "string" && value.trim().length > 0) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : 0;
  }

  return 0;
}

function isInsufficientBalanceError(error: unknown): boolean {
  return (
    isApiClientError(error) &&
    (error.code === "INSUFFICIENT_BALANCE" ||
      error.code === "INSUFFICIENT_KCOIN" ||
      error.code === "KCOIN_NOT_ENOUGH")
  );
}

function getOrderPaymentStatus(order: CreateOpenOrderResponse): string {
  return order.paymentOrderStatus || order.paymentStatus || order.orderStatus;
}

function isPaymentOpenActionLocked(
  order: CreateOpenOrderResponse | null,
): boolean {
  if (!order) {
    return false;
  }

  return !isPaymentTerminalStatus(getOrderPaymentStatus(order));
}

function createRestoredPendingOrder(
  order: PendingStarsPaymentOrder,
): CreateOpenOrderResponse {
  return {
    devPaymentProcessed: false,
    drawCount: 1,
    expiresAt: order.expiresAt,
    idempotent: false,
    invoiceLink: null,
    invoiceOpenMode: null,
    invoicePayload: null,
    orderId: order.orderId,
    orderStatus: "created",
    paymentOrderStatus: "created",
    paymentStatus: "created",
    resultReady: false,
    starOrderId: null,
    paidKcoin: 0,
    totalPriceKcoin: 0,
    xtrAmount: 0,
  };
}

function normalizeRestoredDrawCount(value: number): 1 | 10 | null {
  if (value === 1 || value === 10) {
    return value;
  }

  return null;
}
