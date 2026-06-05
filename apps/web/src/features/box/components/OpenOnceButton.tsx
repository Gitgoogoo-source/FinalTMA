import { Coins, Gift, Loader2 } from "lucide-react";

import { formatCurrencyAmount } from "@/shared/lib/formatCurrency";

import type { BlindBox } from "../box.types";

type OpenOnceButtonProps = {
  box: BlindBox;
  isPending: boolean;
  isDisabled?: boolean;
  isFree?: boolean;
  onOpen: () => void;
};

export function OpenOnceButton({
  box,
  isPending,
  isDisabled = false,
  isFree = false,
  onOpen,
}: OpenOnceButtonProps) {
  const disabled = isPending || isDisabled || !box.isOpenable;
  const priceLabel = isFree
    ? "免费"
    : formatCurrencyAmount(box.singleStarPrice);

  return (
    <button
      className={`box-open-button${isFree ? " box-open-button--free" : ""}`}
      disabled={disabled}
      aria-busy={isPending}
      aria-label={`开 1 次，${isFree ? "免费" : `${priceLabel} K-coin`}`}
      onClick={onOpen}
      type="button"
    >
      <span>{isPending ? (isFree ? "开启中" : "创建中") : "开 1 次"}</span>
      <strong>
        {isPending ? (
          <Loader2
            className="box-open-button__spinner"
            aria-hidden="true"
            size={15}
            strokeWidth={2.4}
          />
        ) : isFree ? (
          <Gift aria-hidden="true" size={15} strokeWidth={2.4} />
        ) : (
          <Coins aria-hidden="true" size={15} strokeWidth={2.4} />
        )}
        {priceLabel}
      </strong>
    </button>
  );
}
