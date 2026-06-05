import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Gift, Loader2 } from "lucide-react";

import { getApiErrorMessage } from "@/api/errors";
import { useFeedback } from "@/app/providers/FeedbackProvider";
import { ActivityBanner } from "@/features/banners/components/ActivityBanner";
import { useBanners } from "@/features/banners/hooks/useBanners";
import { useClaimVipDailyBenefit } from "@/features/vip/hooks/useClaimVipDailyBenefit";
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
  const {
    error: pitySyncError,
    hasUsableCache: hasUsablePityCache,
    refresh: refreshPityCache,
    snapshot: pitySnapshot,
  } = useCachedBoxPity();
  const bannerQuery = useBanners("box_top");
  const vipStatusQuery = useVipStatus();
  const claimVipDaily = useClaimVipDailyBenefit();
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
        message: `获得 ${formatCurrencyAmount(result.results.length || result.quantity)} 件藏品，返还 ${formatCurrencyAmount(result.returnedKcoin)} K-coin。`,
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
  const vipToday = vipStatusQuery.data?.today ?? null;
  const vipPlanFreeBoxCount = vipStatusQuery.data?.plan?.dailyFreeBoxCount ?? 0;
  const vipCanClaimDaily =
    vipStatusQuery.data?.isVip === true &&
    vipToday?.canClaim === true &&
    vipPlanFreeBoxCount > 0;
  const vipHasFreeBoxAvailable =
    vipStatusQuery.data?.isVip === true &&
    (vipToday?.freeBoxAvailable === true || vipFreeModeSelected);
  const selectedBoxUsesVipFreeOpen =
    selectedBox?.slug === "premium_egg" &&
    (vipHasFreeBoxAvailable || vipCanClaimDaily);
  const vipWelfareActionDisabled =
    claimVipDaily.isPending ||
    openVipDaily.isPending ||
    vipStatusQuery.isLoading ||
    vipStatusQuery.data?.isVip !== true ||
    (!vipCanClaimDaily && !vipHasFreeBoxAvailable);
  const vipWelfareButtonText = getVipWelfareButtonText({
    isLoading: vipStatusQuery.isLoading,
    isVip: vipStatusQuery.data?.isVip === true,
    isPending: claimVipDaily.isPending,
    canClaim: vipCanClaimDaily,
    hasFreeBox: vipHasFreeBoxAvailable,
  });
  const vipWelfareButtonDetail = getVipWelfareButtonDetail({
    isVip: vipStatusQuery.data?.isVip === true,
    canClaim: vipCanClaimDaily,
    hasFreeBox: vipHasFreeBoxAvailable,
  });

  useEffect(() => {
    if (
      vipStatusQuery.data &&
      vipStatusQuery.data.isVip === true &&
      vipToday?.freeBoxAvailable !== true &&
      !vipCanClaimDaily
    ) {
      setVipFreeModeSelected(false);
    }
  }, [vipCanClaimDaily, vipStatusQuery.data, vipToday?.freeBoxAvailable]);

  const handleVipWelfareClick = useCallback(() => {
    if (vipStatusQuery.data?.isVip !== true) {
      return;
    }

    if (claimVipDaily.isPending || openVipDaily.isPending) {
      return;
    }

    if (vipHasFreeBoxAvailable) {
      setSelectedBoxSlug("premium_egg");
      setVipFreeModeSelected(true);
      pushToast({
        type: "info",
        title: "已选择稀有蛋",
        message: "开 1 次将优先使用今日月卡福利次数。",
      });
      return;
    }

    if (!vipCanClaimDaily) {
      pushToast({
        type: "info",
        title: "今日福利蛋已用完",
        message: "明天可以继续领取一次免费稀有蛋机会。",
      });
      return;
    }

    claimVipDaily.mutate(undefined, {
      onSuccess: (claim) => {
        setSelectedBoxSlug("premium_egg");
        setVipFreeModeSelected(claim.freeBoxAvailable);
        pushToast({
          type: "success",
          title: "福利蛋已领取",
          message: claim.freeBoxAvailable
            ? "已自动选择稀有蛋，开 1 次价格已切换为免费。"
            : "今日福利已领取，但没有可用免费开盒次数。",
        });
      },
      onError: (error) => {
        pushToast({
          type: "error",
          title: "领取福利蛋失败",
          message: getApiErrorMessage(error),
        });
      },
    });
  }, [
    claimVipDaily,
    openVipDaily.isPending,
    pushToast,
    vipCanClaimDaily,
    vipHasFreeBoxAvailable,
    vipStatusQuery.data?.isVip,
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
        title: "福利蛋已开启",
        message: "已消耗今日月卡免费次数，开盒结果正在展示。",
      });
    },
    [pushToast],
  );

  const openActionDisabled =
    createOrder.isPending ||
    openVipDaily.isPending ||
    claimVipDaily.isPending ||
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
              title: "福利蛋开启失败",
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

      openRequestLockedRef.current = true;
      createOrder.mutate(
        {
          boxSlug: selectedBox.slug,
          drawCount,
        },
        {
          onSuccess: (order) => {
            const paymentStatusMeta = getPaymentStatusMeta(
              getOrderPaymentStatus(order),
            );

            if (order.resultReady && order.orderId) {
              clearPendingStarsPaymentOrder(order.orderId);
              setPaymentPendingOrder(null);
              setPaymentOpenNotice(null);
              setResultOrderId(order.orderId);
            } else {
              setResultOrderId(null);
              setPaymentPendingOrder(order);
              openInvoiceForOrder(order);
            }

            pushToast({
              type: order.resultReady ? "success" : paymentStatusMeta.toastType,
              title: order.resultReady
                ? "开盒结果已生成"
                : paymentStatusMeta.title,
              message: order.devPaymentProcessed
                ? "开发支付模式已由后端处理，资产和保底正在刷新。"
                : `${paymentStatusMeta.detail} 金额 ${formatCurrencyAmount(order.xtrAmount)} Stars。`,
            });
          },
          onError: (error) => {
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

      <section className="box-welfare-entry" aria-label="月卡福利蛋">
        <button
          className="box-welfare-entry__button"
          disabled={vipWelfareActionDisabled}
          onClick={handleVipWelfareClick}
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
            <Gift aria-hidden="true" size={18} strokeWidth={2.4} />
          )}
          <span>{vipWelfareButtonText}</span>
          <strong>{vipWelfareButtonDetail}</strong>
        </button>
      </section>

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

function getVipWelfareButtonText(input: {
  isLoading: boolean;
  isVip: boolean;
  isPending: boolean;
  canClaim: boolean;
  hasFreeBox: boolean;
}): string {
  if (input.isPending) {
    return "领取中";
  }

  if (input.isLoading) {
    return "福利蛋";
  }

  if (!input.isVip) {
    return "月卡福利";
  }

  if (input.canClaim) {
    return "领取福利蛋";
  }

  if (input.hasFreeBox) {
    return "使用福利蛋";
  }

  return "今日已用";
}

function getVipWelfareButtonDetail(input: {
  isVip: boolean;
  canClaim: boolean;
  hasFreeBox: boolean;
}): string {
  if (!input.isVip) {
    return "需月卡";
  }

  if (input.canClaim) {
    return "免费稀有蛋";
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
    xtrAmount: 0,
  };
}

function normalizeRestoredDrawCount(value: number): 1 | 10 | null {
  if (value === 1 || value === 10) {
    return value;
  }

  return null;
}
