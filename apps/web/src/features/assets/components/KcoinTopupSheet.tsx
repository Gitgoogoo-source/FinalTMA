import {
  AlertTriangle,
  CheckCircle2,
  Clock,
  Coins,
  Loader2,
  RefreshCw,
  Star,
  X,
} from "lucide-react";

import { formatCurrencyAmount } from "@/shared/lib/formatCurrency";

import type {
  CreateKcoinTopupOrderResponse,
  KcoinTopupAmount,
  KcoinTopupPaymentStatus,
  KcoinTopupStatusResponse,
} from "../assets.types";
import type { KcoinTopupInvoiceCallbackStatus } from "../hooks/useKcoinTopupPayment";

const FIXED_TOPUP_AMOUNTS: KcoinTopupAmount[] = [500, 1000, 5000, 10000];

type KcoinTopupOption = {
  amount: KcoinTopupAmount;
  label: string;
  detail: string;
  recommended: boolean;
};

export type KcoinTopupNotice = {
  status:
    | KcoinTopupInvoiceCallbackStatus
    | "opening"
    | "not_opened"
    | "fulfilled"
    | "expired";
  detail?: string | null;
};

type KcoinTopupSheetProps = {
  open: boolean;
  currentBalance: number;
  requiredAmount: number;
  activeOrder: CreateKcoinTopupOrderResponse | null;
  statusSnapshot: KcoinTopupStatusResponse | null;
  invoiceNotice: KcoinTopupNotice | null;
  pendingAmount: KcoinTopupAmount | null;
  isCreating: boolean;
  isCheckingStatus: boolean;
  onSelectAmount: (amount: KcoinTopupAmount) => void;
  onRetryPayment: () => void;
  onCheckStatus: () => void;
  onClearOrder: () => void;
  onClose: () => void;
};

export function KcoinTopupSheet({
  open,
  currentBalance,
  requiredAmount,
  activeOrder,
  statusSnapshot,
  invoiceNotice,
  pendingAmount,
  isCreating,
  isCheckingStatus,
  onSelectAmount,
  onRetryPayment,
  onCheckStatus,
  onClearOrder,
  onClose,
}: KcoinTopupSheetProps) {
  if (!open) {
    return null;
  }

  const shortfall = Math.max(requiredAmount - currentBalance, 0);
  const topupOptions = createTopupOptions(shortfall);
  const activeStatus =
    statusSnapshot?.paymentOrderStatus ??
    normalizePaymentStatus(activeOrder?.paymentOrderStatus);
  const canSelectAmount = activeOrder === null;
  const canRetryPayment =
    activeOrder !== null &&
    (activeStatus === "created" || activeStatus === "precheckout_checked");
  const canClearOrder =
    activeOrder !== null &&
    (invoiceNotice?.status === "not_opened" ||
      invoiceNotice?.status === "cancelled" ||
      invoiceNotice?.status === "failed" ||
      activeStatus === "expired" ||
      activeStatus === "failed");
  const statusMeta = getTopupStatusMeta({
    activeOrder,
    invoiceNotice,
    statusSnapshot,
  });
  const StatusIcon = getStatusIcon(statusMeta.tone);

  return (
    <div className="kcoin-topup-sheet" role="presentation">
      <button
        className="kcoin-topup-sheet__backdrop"
        aria-label="关闭充值界面"
        onClick={onClose}
        type="button"
      />
      <section
        className="kcoin-topup-sheet__panel"
        role="dialog"
        aria-modal="true"
        aria-labelledby="kcoin-topup-title"
      >
        <header className="kcoin-topup-sheet__header">
          <div>
            <span>1 Star = 1 K-coin</span>
            <h2 id="kcoin-topup-title">充值 K-coin</h2>
            <p>
              {shortfall > 0
                ? `本次开盲盒需要 ${formatCurrencyAmount(requiredAmount)} K-coin，当前余额 ${formatCurrencyAmount(currentBalance)}，还差 ${formatCurrencyAmount(shortfall)}。`
                : "选择充值档位后，会打开 Telegram Stars 支付账单。"}
            </p>
          </div>
          <button aria-label="关闭" onClick={onClose} type="button">
            <X aria-hidden="true" size={18} strokeWidth={2.5} />
          </button>
        </header>

        <div className="kcoin-topup-sheet__options">
          {topupOptions.map((option) => {
            const isPending = isCreating && pendingAmount === option.amount;
            const OptionIcon = option.recommended ? Coins : Star;

            return (
              <button
                className={
                  option.recommended
                    ? "kcoin-topup-sheet__option kcoin-topup-sheet__option--recommended"
                    : "kcoin-topup-sheet__option"
                }
                disabled={!canSelectAmount || isCreating}
                key={`${option.recommended ? "shortage" : "package"}:${option.amount}`}
                onClick={() => onSelectAmount(option.amount)}
                type="button"
              >
                {isPending ? (
                  <Loader2
                    className="kcoin-topup-sheet__spinner"
                    aria-hidden="true"
                    size={17}
                    strokeWidth={2.4}
                  />
                ) : (
                  <OptionIcon aria-hidden="true" size={17} strokeWidth={2.4} />
                )}
                <span>{option.label}</span>
                <strong>{option.detail}</strong>
              </button>
            );
          })}
        </div>

        {activeOrder || invoiceNotice ? (
          <div
            className={`kcoin-topup-sheet__status kcoin-topup-sheet__status--${statusMeta.tone}`}
          >
            <StatusIcon aria-hidden="true" size={24} strokeWidth={2.4} />
            <div>
              <strong>{statusMeta.title}</strong>
              <span>{statusMeta.detail}</span>
            </div>
          </div>
        ) : null}

        {activeOrder ? (
          <div className="kcoin-topup-sheet__actions">
            {canRetryPayment ? (
              <button onClick={onRetryPayment} type="button">
                <RefreshCw aria-hidden="true" size={14} strokeWidth={2.5} />
                重试支付
              </button>
            ) : null}
            <button
              className="kcoin-topup-sheet__secondary-action"
              disabled={isCheckingStatus}
              onClick={onCheckStatus}
              type="button"
            >
              {isCheckingStatus ? (
                <Loader2
                  className="kcoin-topup-sheet__spinner"
                  aria-hidden="true"
                  size={14}
                  strokeWidth={2.5}
                />
              ) : (
                <RefreshCw aria-hidden="true" size={14} strokeWidth={2.5} />
              )}
              刷新到账状态
            </button>
            {canClearOrder ? (
              <button
                className="kcoin-topup-sheet__secondary-action"
                onClick={onClearOrder}
                type="button"
              >
                <Star aria-hidden="true" size={14} strokeWidth={2.5} />
                重新选择
              </button>
            ) : null}
          </div>
        ) : null}
      </section>
    </div>
  );
}

function createTopupOptions(shortfall: number): KcoinTopupOption[] {
  const normalizedShortfall =
    Number.isFinite(shortfall) && shortfall > 0 ? Math.ceil(shortfall) : 0;
  const options: KcoinTopupOption[] = [];

  if (normalizedShortfall > 0) {
    options.push({
      amount: normalizedShortfall,
      label: `补足 ${formatCurrencyAmount(normalizedShortfall)} K-coin`,
      detail: `推荐，支付 ${formatCurrencyAmount(normalizedShortfall)} Stars`,
      recommended: true,
    });
  }

  for (const amount of FIXED_TOPUP_AMOUNTS) {
    if (amount === normalizedShortfall) {
      continue;
    }

    options.push({
      amount,
      label: `${formatCurrencyAmount(amount)} K-coin`,
      detail: `${formatCurrencyAmount(amount)} Stars`,
      recommended: false,
    });
  }

  return options;
}

function getTopupStatusMeta(input: {
  activeOrder: CreateKcoinTopupOrderResponse | null;
  invoiceNotice: KcoinTopupNotice | null;
  statusSnapshot: KcoinTopupStatusResponse | null;
}): {
  title: string;
  detail: string;
  tone: "progress" | "success" | "warning" | "danger" | "neutral";
} {
  const status =
    input.statusSnapshot?.paymentOrderStatus ??
    normalizePaymentStatus(input.activeOrder?.paymentOrderStatus);

  if (status === "fulfilled" || input.invoiceNotice?.status === "fulfilled") {
    return {
      title: "K-coin 已到账",
      detail: `${formatCurrencyAmount(input.statusSnapshot?.kcoinAmount ?? input.activeOrder?.kcoinAmount ?? 0)} K-coin 已由服务端确认到账。`,
      tone: "success",
    };
  }

  if (
    status === "paid" ||
    status === "fulfilling" ||
    input.invoiceNotice?.status === "paid"
  ) {
    return {
      title: "支付已返回，等待到账",
      detail: "正在等待 Telegram webhook 和服务端入账确认，请不要重复支付。",
      tone: "progress",
    };
  }

  if (status === "expired" || input.invoiceNotice?.status === "expired") {
    return {
      title: "充值订单已过期",
      detail: "当前订单未完成支付，请重新选择充值档位。",
      tone: "warning",
    };
  }

  if (status === "failed" || input.invoiceNotice?.status === "failed") {
    return {
      title: "充值未完成",
      detail:
        input.invoiceNotice?.detail ??
        "服务端没有确认本次充值成功，K-coin 不会到账。",
      tone: "danger",
    };
  }

  if (input.invoiceNotice?.status === "not_opened") {
    return {
      title: "支付窗口未打开",
      detail: input.invoiceNotice.detail ?? "请重试支付或重新选择充值档位。",
      tone: "danger",
    };
  }

  if (input.invoiceNotice?.status === "cancelled") {
    return {
      title: "支付窗口已关闭",
      detail: "服务端尚未确认支付成功，可重试支付。",
      tone: "warning",
    };
  }

  if (input.invoiceNotice?.status === "opening") {
    return {
      title: "支付窗口已打开",
      detail: "请在 Telegram Stars 窗口中完成支付。",
      tone: "progress",
    };
  }

  if (input.activeOrder) {
    return {
      title: "等待支付",
      detail: `${formatCurrencyAmount(input.activeOrder.kcoinAmount)} K-coin 对应 ${formatCurrencyAmount(input.activeOrder.xtrAmount)} Stars。`,
      tone: "neutral",
    };
  }

  return {
    title: "选择充值档位",
    detail: "支付成功并由服务端确认后，K-coin 才会到账。",
    tone: "neutral",
  };
}

function getStatusIcon(
  tone: "progress" | "success" | "warning" | "danger" | "neutral",
) {
  switch (tone) {
    case "success":
      return CheckCircle2;
    case "warning":
    case "danger":
      return AlertTriangle;
    case "progress":
      return Clock;
    case "neutral":
      return Coins;
  }
}

function normalizePaymentStatus(
  value: string | null | undefined,
): KcoinTopupPaymentStatus {
  switch (value) {
    case "precheckout_checked":
    case "paid":
    case "fulfilling":
    case "fulfilled":
    case "failed":
    case "refunded":
    case "disputed":
    case "expired":
      return value;
    case "invoice_created":
    case "pending":
    case "pending_payment":
    case "created":
    default:
      return "created";
  }
}
