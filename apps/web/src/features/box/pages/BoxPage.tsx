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
import { PaymentPendingSheet } from "../components/PaymentPendingSheet";
import { PityProgress } from "../components/PityProgress";
import { PossibleRewardsRow } from "../components/PossibleRewardsRow";
import { PossibleRewardsSheet } from "../components/PossibleRewardsSheet";
import type { BlindBox, CreateOpenOrderResponse } from "../box.types";
import { useBoxRewards } from "../hooks/useBoxRewards";
import { useBoxes } from "../hooks/useBoxes";
import { useCreateOpenOrder } from "../hooks/useCreateOpenOrder";
import { useDrawResult } from "../hooks/useDrawResult";

export function BoxPage() {
  const { pushToast } = useFeedback();
  const [selectedBoxId, setSelectedBoxId] = useState<string | null>(null);
  const [rewardsOpen, setRewardsOpen] = useState(false);
  const [resultOrderId, setResultOrderId] = useState<string | null>(null);
  const [paymentPendingOrder, setPaymentPendingOrder] =
    useState<CreateOpenOrderResponse | null>(null);
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
  const drawResultQuery = useDrawResult(resultOrderId, Boolean(resultOrderId));
  const pendingDrawCount = createOrder.isPending
    ? (createOrder.variables?.drawCount ?? null)
    : null;
  const openActionDisabled = createOrder.isPending || !selectedBox?.isOpenable;

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
            if (order.resultReady && order.orderId) {
              setPaymentPendingOrder(null);
              setResultOrderId(order.orderId);
            } else {
              setResultOrderId(null);
              setPaymentPendingOrder(order);
            }

            pushToast({
              type: order.resultReady ? "success" : "info",
              title: order.resultReady ? "开盒结果已生成" : "支付订单已创建",
              message: order.devPaymentProcessed
                ? "开发支付模式已由后端处理，资产和保底正在刷新。"
                : `等待 Telegram Stars 支付确认，金额 ${formatCurrencyAmount(order.xtrAmount)} Stars。`,
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
    [createOrder, pushToast, rewardsQuery.poolVersionId, selectedBox],
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
        onCheckResult={() => {
          if (paymentPendingOrder?.orderId) {
            setResultOrderId(paymentPendingOrder.orderId);
            setPaymentPendingOrder(null);
          }
        }}
        onClose={() => setPaymentPendingOrder(null)}
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
