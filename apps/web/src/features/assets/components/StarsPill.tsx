import { Star } from "lucide-react";

import { formatCurrencyAmount } from "@/shared/lib/formatCurrency";

import type { AssetBalance } from "../assets.types";

type StarsPillProps = {
  balance: AssetBalance;
  isLoading?: boolean;
};

export function StarsPill({ balance, isLoading = false }: StarsPillProps) {
  return (
    <div className="asset-pill asset-pill--stars" aria-label="Stars 展示值">
      <Star aria-hidden="true" size={16} strokeWidth={2.4} />
      <span className="asset-pill__label">Stars</span>
      <strong className="asset-pill__value">
        {isLoading ? "..." : formatCurrencyAmount(balance.available)}
      </strong>
    </div>
  );
}
