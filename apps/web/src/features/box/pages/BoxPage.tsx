import { RefreshCw } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { getApiErrorMessage } from "@/api/errors";
import { useFeedback } from "@/app/providers/FeedbackProvider";
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
import { useBoxRewards } from "../hooks/useBoxRewards";
import { useBoxes } from "../hooks/useBoxes";
import { useCreateOpenOrder } from "../hooks/useCreateOpenOrder";
import { useDrawResult } from "../hooks/useDrawResult";
import { usePaymentStatus } from "../hooks/usePaymentStatus";
import { usePendingDrawOrder } from "../hooks/usePendingDrawOrder";
import {
  clearPendingStarsPaymentOrder,
  useStarsPayment,
  type PendingStarsPaymentOrder,
  type StarsInvoiceCallbackResult,
} from "../hooks/useStarsPayment";

export function BoxPage() {
  const { pushToast } = useFeedback();
  const [selectedBoxId, setSelectedBoxId] = useState<string | null>(null);
  const [rewardsOpen, setRewardsOpen] = useState(false);
  const [resultOrderId, setResultOrderId] = useState<string | null>(null);
  const [paymentPendingOrder, setPaymentPendingOrder] =
    useState<CreateOpenOrderResponse | null>(null);
  const [paymentOpenNotice, setPaymentOpenNotice] =
    useState<PaymentOpenNotice | null>(null);
  const openRequestLockedRef = useRef(false);
  const boxesQuery = useBoxes();
  const boxes = boxesQuery.boxes;
  const defaultBoxId = useMemo(() => getDefaultBoxId(boxes), [boxes]);

  useEffect(() => {
    if (!defaultBoxId) {
      setSelectedBoxId(null);
      return;
    }

    if (!selectedBoxId || !boxes.some((box) => box.id === selectedBoxId)) {
      setSelectedBoxId(defaultBoxId);
    }
  }, [boxes, defaultBoxId, selectedBoxId]);

  const selectedBox =
    boxes.find((box) => box.id === selectedBoxId) ?? boxes[0] ?? null;
  const rewardsQuery = useBoxRewards(selectedBox?.id);
  const createOrder = useCreateOpenOrder();
  const openStarsInvoice = useStarsPayment();
  const restoredPendingDrawOrder = usePendingDrawOrder();
  const handleDrawCompleted = useCallback(
    (result: DrawResultResponse) => {
      clearPendingStarsPaymentOrder(result.orderId);
      pushToast({
        type: "success",
        title: "开盒完成",
        message: `获得 ${formatCurrencyAmount(result.results.length || result.quantity)} 件藏品，返还 ${formatCurrencyAmount(result.returnedKcoin)} K-coin。`,
      });
    },
    [pushToast],
  );
  const drawResultQuery = useDrawResult(resultOrderId, {
    enabled: Boolean(resultOrderId),
    onCompleted: handleDrawCompleted,
  });
  const pendingStatusOrderId = paymentPendingOrder?.orderId ?? null;
  const pendingStatusQuery = usePaymentStatus(pendingStatusOrderId, {
    enabled: Boolean(pendingStatusOrderId) && resultOrderId === null,
  });

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
    : null;
  const openActionDisabled =
    createOrder.isPending ||
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
          message: selectedBox.disabledReason ?? "请切换其他盲盒。",
        });
        return;
      }

      if (createOrder.isPending || openRequestLockedRef.current) {
        return;
      }

      openRequestLockedRef.current = true;
      createOrder.mutate(
        {
          boxId: selectedBox.id,
          drawCount,
          expectedPriceStars:
            drawCount === 1
              ? selectedBox.singleStarPrice
              : selectedBox.tenDrawPrice,
          expectedPoolVersionId: rewardsQuery.poolVersionId ?? undefined,
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
      openInvoiceForOrder,
      pushToast,
      rewardsQuery.poolVersionId,
      selectedBox,
    ],
  );

  if (boxesQuery.isLoading && boxes.length === 0) {
    return (
      <section className="box-page box-page--state" aria-busy="true">
        <div className="box-page-state">
          <span className="box-page-state__spinner" />
          <strong>盲盒加载中</strong>
        </div>
      </section>
    );
  }

  if (boxesQuery.isError && boxes.length === 0) {
    return (
      <section className="box-page box-page--state">
        <div className="box-page-state">
          <strong>盲盒读取失败</strong>
          <button onClick={() => void boxesQuery.refetch()} type="button">
            <RefreshCw aria-hidden="true" size={15} strokeWidth={2.4} />
            重试
          </button>
        </div>
      </section>
    );
  }

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
      <BoxHero box={selectedBox} />

      <BoxTierSelector
        boxes={boxes}
        selectedBoxId={selectedBox.id}
        onSelect={setSelectedBoxId}
      />

      <section className="box-page__status" aria-label="盲盒状态">
        <BoxStatusBadge
          status={selectedBox.status}
          disabledReason={selectedBox.disabledReason}
        />
        <span>{formatStock(selectedBox)}</span>
      </section>

      <PossibleRewardsRow
        rewards={rewardsQuery.rewards}
        isLoading={rewardsQuery.isLoading}
        onOpen={() => setRewardsOpen(true)}
      />

      <PityProgress box={selectedBox} />

      <section className="box-open-actions" aria-label="开盒操作">
        <OpenOnceButton
          box={selectedBox}
          isPending={pendingDrawCount === 1}
          isDisabled={openActionDisabled}
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
        rewards={rewardsQuery.rewards}
        isLoading={rewardsQuery.isLoading}
        isError={rewardsQuery.isError}
        poolVersion={rewardsQuery.poolVersion}
        pityRule={rewardsQuery.pityRule}
        generatedAt={rewardsQuery.generatedAt}
        errorMessage={getRewardsErrorMessage(rewardsQuery.error)}
        onRetry={() => void rewardsQuery.refetch()}
        onClose={() => setRewardsOpen(false)}
      />

      <PaymentPendingSheet
        open={paymentPendingOrder !== null}
        order={paymentPendingOrder}
        invoiceOpenNotice={paymentOpenNotice}
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
        onRetry={() => void drawResultQuery.refetch()}
        onClose={() => setResultOrderId(null)}
      />
    </section>
  );
}

function getDefaultBoxId(boxes: BlindBox[]): string | null {
  return boxes.find((box) => box.isOpenable)?.id ?? boxes[0]?.id ?? null;
}

function formatStock(box: BlindBox): string {
  if (box.stockStatus === "unlimited") {
    return "不限量";
  }

  if (box.remainingStock === null) {
    return "库存同步中";
  }

  if (box.totalStock === null) {
    return `剩余 ${formatCurrencyAmount(box.remainingStock)}`;
  }

  return `剩余 ${formatCurrencyAmount(box.remainingStock)} / ${formatCurrencyAmount(box.totalStock)}`;
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
