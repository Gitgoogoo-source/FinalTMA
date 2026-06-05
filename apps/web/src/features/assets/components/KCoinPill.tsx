import { Coins } from "lucide-react";

import { formatCurrencyAmount } from "@/shared/lib/formatCurrency";

import type { AssetBalance } from "../assets.types";

type KCoinPillProps = {
  balance: AssetBalance;
  isLoading?: boolean;
  isUnavailable?: boolean;
  onClick?: () => void;
};

export function KCoinPill({
  balance,
  isLoading = false,
  isUnavailable = false,
  onClick,
}: KCoinPillProps) {
  const content = (
    <>
      <span className="asset-pill__icon" aria-hidden="true">
        <Coins size={16} strokeWidth={2.4} />
      </span>
      <span className="asset-pill__label">K-coin</span>
      <strong className="asset-pill__value">
        {isLoading
          ? "..."
          : isUnavailable
            ? "--"
            : formatCurrencyAmount(balance.available)}
      </strong>
    </>
  );

  if (onClick) {
    return (
      <button
        className="asset-pill asset-pill--kcoin asset-pill--button"
        aria-label="K-coin 余额，点击充值"
        title={isUnavailable ? "资产加载失败，请刷新" : "充值 K-coin"}
        onClick={onClick}
        type="button"
      >
        {content}
      </button>
    );
  }

  return (
    <div
      className="asset-pill asset-pill--kcoin"
      aria-label="K-coin 余额"
      title={isUnavailable ? "资产加载失败，请刷新" : undefined}
    >
      {content}
    </div>
  );
}
