import {
  AlertTriangle,
  CheckCircle2,
  Clock,
  RefreshCw,
  Star,
  X,
} from "lucide-react";

import { formatCurrencyAmount } from "@/shared/lib/formatCurrency";

import { getPaymentStatusMeta, type PaymentStatusTone } from "../box.status";
import type { CreateOpenOrderResponse } from "../box.types";

type PaymentPendingSheetProps = {
  open: boolean;
  order: CreateOpenOrderResponse | null;
  onCheckResult: () => void;
  onClose: () => void;
};

export function PaymentPendingSheet({
  open,
  order,
  onCheckResult,
  onClose,
}: PaymentPendingSheetProps) {
  if (!open || !order) {
    return null;
  }

  const statusMeta = getPaymentStatusMeta(
    order.paymentStatus || order.orderStatus,
  );
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
          <button onClick={onCheckResult} type="button">
            {statusMeta.actionLabel}
          </button>
        </div>
      </section>
    </div>
  );
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
