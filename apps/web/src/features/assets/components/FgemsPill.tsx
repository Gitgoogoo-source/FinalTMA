import { Gem } from "lucide-react";

import { formatCurrencyAmount } from "@/shared/lib/formatCurrency";

import type { AssetBalance } from "../assets.types";

type FgemsPillProps = {
  balance: AssetBalance;
  isLoading?: boolean;
  isUnavailable?: boolean;
};

export function FgemsPill({
  balance,
  isLoading = false,
  isUnavailable = false,
}: FgemsPillProps) {
  return (
    <div
      className="asset-pill asset-pill--fgems"
      aria-label="Fgems 余额"
      title={isUnavailable ? "资产加载失败，请刷新" : undefined}
    >
      <Gem aria-hidden="true" size={16} strokeWidth={2.4} />
      <span className="asset-pill__label">Fgems</span>
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
