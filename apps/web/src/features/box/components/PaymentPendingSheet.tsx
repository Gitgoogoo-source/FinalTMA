import {
  AlertTriangle,
  CheckCircle2,
  Clock,
  RefreshCw,
  Star,
  X,
} from "lucide-react";

import { formatCurrencyAmount } from "@/shared/lib/formatCurrency";

import {
  getPaymentStatusMeta,
  isPaymentRetryAllowed,
  type PaymentStatusTone,
} from "../box.status";
import type { CreateOpenOrderResponse } from "../box.types";

type PaymentPendingSheetProps = {
  open: boolean;
  order: CreateOpenOrderResponse | null;
  invoiceOpenNotice?: PaymentOpenNotice | null;
  onCheckResult: () => void;
  onRetryPayment?: () => void;
  onClose: () => void;
};

export type PaymentOpenNotice = {
  status:
    | "opening"
    | "not_opened"
    | "cancelled"
    | "failed"
    | "pending"
    | "paid";
  detail?: string | null;
};

export function PaymentPendingSheet({
  open,
  order,
  invoiceOpenNotice = null,
  onCheckResult,
  onRetryPayment,
  onClose,
}: PaymentPendingSheetProps) {
  if (!open || !order) {
    return null;
  }

  const statusMeta = getPaymentStatusMeta(
    order.paymentStatus || order.orderStatus,
  );
  const canRetryCurrentOrder = isPaymentRetryAllowed(
    order.paymentStatus || order.orderStatus,
  );
  const invoiceNoticeMeta = getInvoiceNoticeMeta(invoiceOpenNotice);
  const showRetryPayment =
    Boolean(invoiceNoticeMeta?.canRetry) &&
    canRetryCurrentOrder &&
    Boolean(onRetryPayment);
  const StatusIcon = getStatusIcon(statusMeta.tone);

  return (
    <div className="payment-pending-sheet" role="presentation">
      <button
        className="payment-pending-sheet__backdrop"
        aria-label="关闭支付等待"
        onClick={onClose}
        type="button"
      />
      <section
        className="payment-pending-sheet__panel"
        role="dialog"
        aria-modal="true"
        aria-labelledby="payment-pending-title"
      >
        <header className="payment-pending-sheet__header">
          <div>
            <span>{statusMeta.label}</span>
            <h2 id="payment-pending-title">{statusMeta.title}</h2>
          </div>
          <button aria-label="关闭" onClick={onClose} type="button">
            <X aria-hidden="true" size={18} strokeWidth={2.5} />
          </button>
        </header>
        <div
          className={`payment-pending-sheet__body payment-pending-sheet__body--${statusMeta.tone}`}
        >
          <StatusIcon aria-hidden="true" size={28} strokeWidth={2.4} />
          <strong>{statusMeta.label}</strong>
          <span>{statusMeta.detail}</span>
          <p>
            <Star aria-hidden="true" size={14} strokeWidth={2.5} />
            {formatCurrencyAmount(order.xtrAmount)} Stars · {order.drawCount} 次
          </p>
          {invoiceNoticeMeta ? (
            <div
              className={`payment-pending-sheet__notice payment-pending-sheet__notice--${invoiceNoticeMeta.tone}`}
            >
              <strong>{invoiceNoticeMeta.title}</strong>
              <span>{invoiceNoticeMeta.detail}</span>
            </div>
          ) : null}
          <div className="payment-pending-sheet__actions">
            {showRetryPayment ? (
              <button onClick={onRetryPayment} type="button">
                <RefreshCw aria-hidden="true" size={14} strokeWidth={2.5} />
                重试支付
              </button>
            ) : null}
            <button
              className={
                showRetryPayment
                  ? "payment-pending-sheet__secondary-action"
                  : undefined
              }
              onClick={onCheckResult}
              type="button"
            >
              {statusMeta.actionLabel}
            </button>
          </div>
        </div>
      </section>
    </div>
  );
}

function getInvoiceNoticeMeta(notice: PaymentOpenNotice | null): {
  title: string;
  detail: string;
  tone: PaymentStatusTone;
  canRetry: boolean;
} | null {
  if (!notice) {
    return null;
  }

  switch (notice.status) {
    case "opening":
      return {
        title: "正在打开 Stars 支付窗口",
        detail: "请在 Telegram 窗口中完成支付，关闭窗口不代表支付成功。",
        tone: "pending",
        canRetry: false,
      };
    case "not_opened":
      return {
        title: "支付未打开，可重试支付",
        detail:
          notice.detail ??
          "Telegram Stars 支付窗口没有打开，订单未支付也不会发货。",
        tone: "danger",
        canRetry: true,
      };
    case "cancelled":
      return {
        title: "支付已取消，可重试支付",
        detail:
          notice.detail ?? "Telegram 支付窗口已关闭，服务端尚未确认支付成功。",
        tone: "warning",
        canRetry: true,
      };
    case "failed":
      return {
        title: "支付未完成，可重试支付",
        detail:
          notice.detail ??
          "Telegram 返回支付失败，当前订单不会被前端当作支付成功。",
        tone: "danger",
        canRetry: true,
      };
    case "pending":
      return {
        title: "支付状态待确认",
        detail:
          notice.detail ??
          "Telegram 返回 pending，需等待服务端 webhook 确认后才能发货。",
        tone: "pending",
        canRetry: false,
      };
    case "paid":
      return {
        title: "支付已返回，等待服务端确认",
        detail:
          notice.detail ??
          "前端不会直接发货，需等待 Telegram webhook 和数据库事务确认。",
        tone: "progress",
        canRetry: false,
      };
  }
}

function getStatusIcon(tone: PaymentStatusTone) {
  switch (tone) {
    case "success":
      return CheckCircle2;
    case "danger":
    case "warning":
      return AlertTriangle;
    case "progress":
      return RefreshCw;
    case "neutral":
    case "pending":
      return Clock;
  }
}
