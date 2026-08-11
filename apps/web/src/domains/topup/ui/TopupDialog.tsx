import { Coins, ExternalLink, Minus, RefreshCw, Sparkles } from "lucide-react";
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";

import {
  ApiFailure,
  apiRequest,
  newIdempotencyKey,
} from "../../../platform/api/client.ts";
import {
  refreshRouteScopes,
  useApiQuery,
} from "../../../platform/query/index.ts";
import { getSession } from "../../../platform/session/store.ts";
import { telegram } from "../../../platform/telegram/index.ts";
import { AppModal } from "../../../shared/ui/AppModal.tsx";
import { Button } from "../../../shared/ui/Button.tsx";
import { useOperationCommands } from "../../../workflows/operation-recovery/context.ts";
import type { TopupRequest } from "../../../workflows/payment-recovery/context.ts";
import "../../../shared/styles/shell-dialogs.css";
import type { PaymentOrder } from "../index.ts";

const FINAL_STATUSES = new Set<PaymentOrder["status"]>([
  "delivered",
  "failed",
  "cancelled",
  "expired",
  "rejected",
  "refunded",
  "payment_identity_conflict",
]);

export function TopupDialog({
  close,
  request,
}: {
  close(): void;
  request: TopupRequest | null;
}): ReactNode {
  const [amount, setAmount] = useState("");
  const [showOptions, setShowOptions] = useState(!request);
  const [activeOrder, setActiveOrder] = useState<PaymentOrder | null>(null);
  const [submitted, setSubmitted] = useState(false);
  const [pollFailed, setPollFailed] = useState(false);
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);
  const closing = useRef(false);
  const status = useApiQuery("topup.bootstrap");
  const { run } = useOperationCommands();
  const recoveryOrder = status.data?.orders.find(
    (order) =>
      order.kind === "kcoin_topup" &&
      (order.status === "processing" ||
        order.status === "paid" ||
        order.status === "payment_identity_conflict"),
  );
  const order = activeOrder ?? recoveryOrder ?? null;
  const locked =
    submitted || order?.status === "processing" || order?.status === "paid";
  const amounts = status.data?.products ?? [];
  const exactGapMatchesFixed = request
    ? amounts.some((value) => value === request.estimatedGap)
    : false;
  const defaultAmount = status.data
    ? request
      ? exactGapMatchesFixed
        ? String(request.estimatedGap)
        : "exact_gap"
      : String(amounts[0])
    : "";
  const selectedAmount = amount || defaultAmount;

  const resetOrder = useCallback(() => {
    setAmount("");
    setActiveOrder(null);
    setSubmitted(false);
    setPollFailed(false);
    setCreateError(null);
  }, []);

  const cancelOrder = useCallback(
    async (orderId: string) => {
      const result = await run(
        "正在取消未付款订单",
        "topup.cancel_order",
        { order_id: orderId },
        { background: true },
      );
      if (closing.current) return result;
      if (result?.status === "processing" || result?.status === "paid") {
        setActiveOrder(result);
        setSubmitted(true);
      } else if (
        result?.status === "delivered" ||
        result?.status === "payment_identity_conflict"
      ) {
        setActiveOrder(result);
        setSubmitted(false);
      } else if (!result) {
        const refreshed = await status.refetch();
        const processing = refreshed.data?.orders.find(
          (candidate) =>
            candidate.id === orderId &&
            (candidate.status === "processing" ||
              candidate.status === "paid" ||
              candidate.status === "payment_identity_conflict"),
        );
        if (processing) {
          setActiveOrder(processing);
          setSubmitted(true);
        }
      }
      return result;
    },
    [run, status],
  );

  const failOrder = useCallback(
    async (orderId: string) => {
      const result = await run(
        "正在确认充值失败结果",
        "topup.fail_order",
        { order_id: orderId },
        { background: true },
      );
      if (closing.current) return result;
      if (result) {
        setActiveOrder(result);
        setSubmitted(
          result.status === "processing" || result.status === "paid",
        );
      } else {
        const refreshed = await status.refetch();
        const processing = refreshed.data?.orders.find(
          (candidate) =>
            candidate.id === orderId &&
            (candidate.status === "processing" ||
              candidate.status === "paid" ||
              candidate.status === "payment_identity_conflict"),
        );
        if (processing) {
          setActiveOrder(processing);
          setSubmitted(true);
        }
      }
      return result;
    },
    [run, status],
  );

  const pollOrder = useCallback(async (orderId: string) => {
    const generation = getSession()?.generation;
    try {
      const response = await apiRequest("topup.order", { order_id: orderId });
      if (!generation || generation !== getSession()?.generation) return null;
      setActiveOrder(response.data);
      setPollFailed(false);
      if (FINAL_STATUSES.has(response.data.status)) {
        setSubmitted(false);
        await refreshRouteScopes("topup.create_order");
      }
      return response.data;
    } catch {
      if (generation && generation === getSession()?.generation)
        setPollFailed(true);
      return null;
    }
  }, []);

  const openInvoice = useCallback(
    (order: PaymentOrder) => {
      if (!order.invoice_url) return;
      telegram()?.openInvoice(order.invoice_url, (invoiceStatus) => {
        if (invoiceStatus === "cancelled") {
          resetOrder();
          void cancelOrder(order.id);
          return;
        }
        if (invoiceStatus === "failed") {
          setSubmitted(false);
          setActiveOrder({ ...order, status: "failed" });
          void failOrder(order.id);
          return;
        }
        setSubmitted(true);
        setActiveOrder({ ...order, status: "processing" });
      });
    },
    [cancelOrder, failOrder, resetOrder],
  );

  const create = async () => {
    const input =
      selectedAmount === "exact_gap" && request
        ? ({ mode: "exact_gap", intent: request.intent } as const)
        : ({
            mode: "fixed",
            amount: Number(selectedAmount) as 50 | 500 | 1000 | 5000 | 10000,
            ...(request ? { intent: request.intent } : {}),
          } as const);
    setCreating(true);
    setCreateError(null);
    try {
      const result = (
        await apiRequest("topup.create_order", input, {
          idempotencyKey: newIdempotencyKey(),
        })
      ).data;
      if (closing.current) {
        void cancelOrder(result.id);
        return;
      }
      setCreating(false);
      setActiveOrder(result);
      openInvoice(result);
    } catch (cause) {
      if (closing.current) return;
      setCreating(false);
      setCreateError(
        cause instanceof ApiFailure
          ? cause.message
          : "暂时无法创建支付订单，请立即重试",
      );
      const refreshed = await status.refetch();
      if (closing.current) return;
      const processing = refreshed.data?.orders.find(
        (candidate) =>
          candidate.kind === "kcoin_topup" &&
          (candidate.status === "processing" ||
            candidate.status === "paid" ||
            candidate.status === "payment_identity_conflict"),
      );
      if (processing) {
        setActiveOrder(processing);
        setSubmitted(true);
        setCreateError(null);
      }
    }
  };

  const closeDialog = () => {
    if (locked) return;
    closing.current = true;
    close();
    if (order?.status === "pending") void cancelOrder(order.id);
  };

  const orderId = order?.id;

  useEffect(() => {
    if (!locked || !orderId) return;
    let stopped = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let attempt = 0;
    const intervals = [0, 1000, 2000, 3000, 5000];
    const poll = async () => {
      const result = await pollOrder(orderId);
      if (stopped || (result && FINAL_STATUSES.has(result.status))) return;
      attempt += 1;
      timer = setTimeout(poll, intervals[Math.min(attempt, 4)]);
    };
    void poll();
    return () => {
      stopped = true;
      if (timer) clearTimeout(timer);
    };
  }, [locked, orderId, pollOrder]);

  useEffect(() => {
    if (!locked) return;
    telegram()?.enableClosingConfirmation();
    return () => telegram()?.disableClosingConfirmation();
  }, [locked]);

  const succeeded =
    order?.status === "delivered" ||
    (order?.status === "refunded" && Boolean(order.delivered_at));
  const identityConflict = order?.status === "payment_identity_conflict";
  const failed =
    order?.status === "failed" ||
    order?.status === "cancelled" ||
    order?.status === "expired" ||
    order?.status === "rejected" ||
    (order?.status === "refunded" && !order.delivered_at);

  if (request && !showOptions && !order) {
    return (
      <AppModal
        className="topup-shortage-backdrop"
        labelledBy="topup-shortage-title"
        onClose={closeDialog}
      >
        <div className="modal topup topup-shortage">
          <span className="topup-shortage-mark" aria-hidden="true">
            <Coins />
          </span>
          <h2 id="topup-shortage-title">K-coin 余额不足</h2>
          <p>
            本次操作还差 {request.estimatedGap}{" "}
            K-coin，请返回重新选择或前往获取。
          </p>
          <div className="button-row">
            <Button className="secondary" onClick={closeDialog}>
              返回
            </Button>
            <Button onClick={() => setShowOptions(true)}>去获取</Button>
          </div>
        </div>
      </AppModal>
    );
  }

  return (
    <AppModal
      className="topup-sheet-backdrop"
      labelledBy="topup-dialog-title"
      onClose={locked ? undefined : closeDialog}
    >
      <div className="modal topup topup-sheet">
        <img
          className="topup-sheet-coins"
          src="/assets/topup/kcoin-cluster.webp"
          alt=""
          aria-hidden="true"
        />
        <Minus className="topup-sheet-handle" aria-hidden="true" />
        <header className="topup-sheet-heading">
          <Sparkles aria-hidden="true" />
          <h2 id="topup-dialog-title">K-coin 充值</h2>
          <Sparkles aria-hidden="true" />
        </header>
        <p className="topup-sheet-description">
          {request
            ? `原操作预计还差 ${request.estimatedGap} K-coin；最新差额与可用档位将重新确认。`
            : "选择充值档位。Stars 金额和 K-coin 到账值以支付结果为准。"}
        </p>
        {locked ? (
          <div className="payment-recovery">
            <strong>支付已提交</strong>
            <small>
              {pollFailed ? "网络异常，正在重新确认" : "正在确认充值结果"}
            </small>
          </div>
        ) : succeeded ? (
          <div className="payment-recovery">
            <strong>K-coin 已到账</strong>
            <small>{order?.kcoin_amount} K-coin</small>
          </div>
        ) : identityConflict ? (
          <div className="payment-recovery">
            <strong>支付身份校验异常</strong>
            <small>本次未到账，请前往支付助手发送 /paysupport</small>
          </div>
        ) : failed ? (
          <div className="payment-recovery">
            <strong>充值失败</strong>
            <small>本次订单未增加 K-coin</small>
          </div>
        ) : status.isLoading ? (
          <p>正在读取充值档位</p>
        ) : status.error ? (
          <Button onClick={() => void status.refetch()}>重新加载</Button>
        ) : (
          <div className="amount-grid">
            {request && !exactGapMatchesFixed && (
              <button
                className={selectedAmount === "exact_gap" ? "selected" : ""}
                onClick={() => {
                  setAmount("exact_gap");
                  setCreateError(null);
                }}
              >
                {request.estimatedGap} K-coin
              </button>
            )}
            {amounts.map((value) => (
              <button
                key={value}
                className={selectedAmount === String(value) ? "selected" : ""}
                onClick={() => {
                  setAmount(String(value));
                  setCreateError(null);
                }}
              >
                {value}
              </button>
            ))}
          </div>
        )}
        {createError && !locked ? (
          <small className="topup-sheet-error">{createError}</small>
        ) : null}
        <div className="button-row">
          <Button className="secondary" disabled={locked} onClick={closeDialog}>
            返回
          </Button>
          {locked && order ? (
            <Button onClick={() => void pollOrder(order.id)}>
              <RefreshCw />
              立即重新查询
            </Button>
          ) : succeeded ? (
            <Button onClick={closeDialog}>完成</Button>
          ) : identityConflict ? (
            <Button onClick={closeDialog}>知道了</Button>
          ) : failed ? (
            <Button onClick={resetOrder}>重新充值</Button>
          ) : order?.status === "pending" && order.invoice_url ? (
            <Button onClick={() => openInvoice(order)}>
              <ExternalLink />
              打开 Stars 支付
            </Button>
          ) : (
            <Button
              disabled={
                creating ||
                (selectedAmount !== "exact_gap" && Number(selectedAmount) <= 0)
              }
              onClick={() => void create()}
            >
              <ExternalLink />
              {creating ? "正在创建充值订单" : "打开 Stars 支付"}
            </Button>
          )}
        </div>
      </div>
    </AppModal>
  );
}
