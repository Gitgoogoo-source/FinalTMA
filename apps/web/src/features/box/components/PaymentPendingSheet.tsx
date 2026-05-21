import { Clock, Star, X } from "lucide-react";

import { formatCurrencyAmount } from "@/shared/lib/formatCurrency";

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
            <span>支付等待</span>
            <h2 id="payment-pending-title">Telegram Stars 确认中</h2>
          </div>
          <button aria-label="关闭" onClick={onClose} type="button">
            <X aria-hidden="true" size={18} strokeWidth={2.5} />
          </button>
        </header>
        <div className="payment-pending-sheet__body">
          <Clock aria-hidden="true" size={28} strokeWidth={2.4} />
          <strong>订单已创建</strong>
          <span>等待 Telegram 支付成功回调到达后，服务端会发放奖励。</span>
          <p>
            <Star aria-hidden="true" size={14} strokeWidth={2.5} />
            {formatCurrencyAmount(order.xtrAmount)} Stars · {order.drawCount} 次
          </p>
          <button onClick={onCheckResult} type="button">
            查看结果状态
          </button>
        </div>
      </section>
    </div>
  );
}
