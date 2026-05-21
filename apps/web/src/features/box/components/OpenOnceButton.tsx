import { Loader2, Star } from "lucide-react";

import { formatCurrencyAmount } from "@/shared/lib/formatCurrency";

import type { BlindBox } from "../box.types";

type OpenOnceButtonProps = {
  box: BlindBox;
  isPending: boolean;
  isDisabled?: boolean;
  onOpen: () => void;
};

export function OpenOnceButton({
  box,
  isPending,
  isDisabled = false,
  onOpen,
}: OpenOnceButtonProps) {
  const disabled = isPending || isDisabled || !box.isOpenable;

  return (
    <button
      className="box-open-button"
      disabled={disabled}
      aria-busy={isPending}
      aria-label={`开 1 次，${formatCurrencyAmount(box.singleStarPrice)} Stars`}
      onClick={onOpen}
      type="button"
    >
      <span>{isPending ? "创建中" : "开 1 次"}</span>
      <strong>
        {isPending ? (
          <Loader2
            className="box-open-button__spinner"
            aria-hidden="true"
            size={15}
            strokeWidth={2.4}
          />
        ) : (
          <Star aria-hidden="true" size={15} strokeWidth={2.4} />
        )}
        {formatCurrencyAmount(box.singleStarPrice)}
      </strong>
    </button>
  );
}
