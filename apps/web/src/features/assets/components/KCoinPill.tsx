import { Coins } from "lucide-react";

import { formatCurrencyAmount } from "@/shared/lib/formatCurrency";

import type { AssetBalance } from "../assets.types";

type KCoinPillProps = {
  balance: AssetBalance;
  isLoading?: boolean;
  isUnavailable?: boolean;
};

export function KCoinPill({
  balance,
  isLoading = false,
  isUnavailable = false,
}: KCoinPillProps) {
  return (
    <div
      className="asset-pill asset-pill--kcoin"
      aria-label="K-coin 余额"
      title={isUnavailable ? "资产加载失败，请刷新" : undefined}
    >
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
    </div>
  );
}
