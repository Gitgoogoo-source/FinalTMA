import { Minus, Plus } from "lucide-react";

type SellQuantityStepperProps = {
  availableCount: number;
  disabled?: boolean;
  onChange: (quantity: number) => void;
  quantity: number;
};

export function SellQuantityStepper({
  availableCount,
  disabled = false,
  onChange,
  quantity,
}: SellQuantityStepperProps) {
  const maxQuantity = Math.max(Math.trunc(availableCount), 0);
  const safeQuantity = maxQuantity > 0 ? clamp(quantity, 1, maxQuantity) : 0;
  const canDecrease = !disabled && safeQuantity > 1;
  const canIncrease = !disabled && safeQuantity < maxQuantity;

  return (
    <div className="sell-quantity-stepper" aria-label="出售数量">
      <button
        aria-label="减少出售数量"
        disabled={!canDecrease}
        onClick={() => onChange(safeQuantity - 1)}
        type="button"
      >
        <Minus aria-hidden="true" size={15} strokeWidth={2.8} />
      </button>
      <output aria-live="polite">{safeQuantity}</output>
      <button
        aria-label="增加出售数量"
        disabled={!canIncrease}
        onClick={() => onChange(safeQuantity + 1)}
        type="button"
      >
        <Plus aria-hidden="true" size={15} strokeWidth={2.8} />
      </button>
    </div>
  );
}

function clamp(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) {
    return min;
  }

  return Math.min(Math.max(Math.trunc(value), min), max);
}
