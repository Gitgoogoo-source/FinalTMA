import { Coins } from "lucide-react";

import { MARKET_MAX_KCOIN_PRICE } from "../trade.constants";
import { formatKcoinWithUnit } from "../trade.utils";

type SellPriceInputProps = {
  disabled?: boolean;
  error: string | null;
  referencePriceKcoin: number | null;
  value: string;
  onChange: (value: string) => void;
};

export function SellPriceInput({
  disabled = false,
  error,
  onChange,
  referencePriceKcoin,
  value,
}: SellPriceInputProps) {
  return (
    <label className="sell-price-input">
      <span>出售单价</span>
      <div className="sell-price-input__field">
        <Coins aria-hidden="true" size={16} strokeWidth={2.5} />
        <input
          aria-invalid={Boolean(error)}
          disabled={disabled}
          inputMode="numeric"
          max={MARKET_MAX_KCOIN_PRICE}
          min={1}
          onChange={(event) => onChange(event.target.value)}
          placeholder={
            referencePriceKcoin === null
              ? "输入 K-coin"
              : formatKcoinWithUnit(referencePriceKcoin)
          }
          step={1}
          type="number"
          value={value}
        />
      </div>
      <strong className={error ? "sell-price-input__hint--error" : undefined}>
        {error ?? "K-coin"}
      </strong>
    </label>
  );
}
