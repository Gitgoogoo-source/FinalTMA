import { Coins, Loader2, X } from "lucide-react";

import { formatCurrencyAmount } from "@/shared/lib/formatCurrency";

import type { KcoinTopupAmount } from "../box.types";

const FIXED_TOPUP_AMOUNTS: KcoinTopupAmount[] = [500, 1000, 5000, 10000];

type KcoinRechargeDialogProps = {
  open: boolean;
  currentBalance: number;
  requiredAmount: number;
  pendingAmount: KcoinTopupAmount | null;
  isPending: boolean;
  onSelect: (amount: KcoinTopupAmount) => void;
  onClose: () => void;
};

export function KcoinRechargeDialog({
  open,
  currentBalance,
  requiredAmount,
  pendingAmount,
  isPending,
  onSelect,
  onClose,
}: KcoinRechargeDialogProps) {
  if (!open) {
    return null;
  }

  const shortfall = Math.max(requiredAmount - currentBalance, 0);
  const topupAmounts =
    shortfall > 0
      ? [Math.ceil(shortfall), ...FIXED_TOPUP_AMOUNTS].filter(
          (amount, index, all) => all.indexOf(amount) === index,
        )
      : FIXED_TOPUP_AMOUNTS;

  return (
    <div
      className="kcoin-recharge-dialog"
      role="dialog"
      aria-modal="true"
      aria-labelledby="kcoin-recharge-title"
    >
      <div className="kcoin-recharge-dialog__backdrop" onClick={onClose} />
      <section className="kcoin-recharge-dialog__panel">
        <header className="kcoin-recharge-dialog__header">
          <div>
            <h2 id="kcoin-recharge-title">K-coin 不足</h2>
            <p>
              还差 {formatCurrencyAmount(shortfall)} K-coin，当前余额{" "}
              {formatCurrencyAmount(currentBalance)}。
            </p>
          </div>
          <button
            className="kcoin-recharge-dialog__close"
            aria-label="关闭充值弹窗"
            disabled={isPending}
            onClick={onClose}
            type="button"
          >
            <X aria-hidden="true" size={18} strokeWidth={2.4} />
          </button>
        </header>

        <div className="kcoin-recharge-dialog__options">
          {topupAmounts.map((amount) => {
            const isLoading = isPending && pendingAmount === amount;
            const isShortfall =
              shortfall > 0 && amount === Math.ceil(shortfall);

            return (
              <button
                className="kcoin-recharge-dialog__option"
                disabled={isPending}
                key={amount}
                onClick={() => onSelect(amount)}
                type="button"
              >
                {isLoading ? (
                  <Loader2
                    className="kcoin-recharge-dialog__spinner"
                    aria-hidden="true"
                    size={16}
                    strokeWidth={2.4}
                  />
                ) : (
                  <Coins aria-hidden="true" size={16} strokeWidth={2.4} />
                )}
                <span>
                  {isShortfall
                    ? `补足 ${formatCurrencyAmount(amount)} K-coin`
                    : `${formatCurrencyAmount(amount)} K-coin`}
                </span>
                <strong>{formatCurrencyAmount(amount)} Stars</strong>
              </button>
            );
          })}
        </div>
      </section>
    </div>
  );
}
