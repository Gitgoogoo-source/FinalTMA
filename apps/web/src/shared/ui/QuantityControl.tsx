import type { ReactNode } from "react";

import { Button } from "./Button.tsx";
import { t, tp } from "../../platform/i18n/index.ts";

export function QuantityControl({
  label,
  value,
  min = 1,
  max,
  step = 1,
  disabled = false,
  onChange,
}: {
  label: string;
  value: number;
  min?: number;
  max: number;
  step?: number;
  disabled?: boolean;
  onChange(value: number): void;
}): ReactNode {
  return (
    <div className="inventory-quantity-control">
      <span>{label}</span>
      <div>
        <Button
          aria-label={tp("减少{{0}}", [label])}
          disabled={disabled || value <= min}
          onClick={() => onChange(Math.max(min, value - step))}
        >
          −
        </Button>
        <input
          aria-label={label}
          type="number"
          inputMode="numeric"
          min={min}
          max={max}
          step={step}
          value={value}
          disabled={disabled}
          onChange={(event) => onChange(Number(event.target.value))}
        />
        <Button
          aria-label={tp("增加{{0}}", [label])}
          disabled={disabled || value >= max}
          onClick={() => onChange(Math.min(max, value + step))}
        >
          ＋
        </Button>
      </div>
      <Button
        className="secondary inventory-quantity-all"
        disabled={disabled || value === max}
        onClick={() => onChange(max)}
      >
        {t("全部")}
      </Button>
    </div>
  );
}
