import { Loader2, Star } from "lucide-react";

import { formatCurrencyAmount } from "@/shared/lib/formatCurrency";

import type { BlindBox } from "../box.types";

type OpenTenButtonProps = {
  box: BlindBox;
  isPending: boolean;
  isDisabled?: boolean;
  onOpen: () => void;
};

export function OpenTenButton({
  box,
  isPending,
  isDisabled = false,
  onOpen,
}: OpenTenButtonProps) {
  const disabled = isPending || isDisabled || !box.isOpenable;

  return (
    <button
      className="box-open-button box-open-button--primary"
      disabled={disabled}
      aria-busy={isPending}
      aria-label={`开 10 次，${formatCurrencyAmount(box.tenDrawPrice)} Stars，9 折`}
      onClick={onOpen}
      type="button"
    >
      <span>{isPending ? "创建中" : "开 10 次"}</span>
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
        {formatCurrencyAmount(box.tenDrawPrice)}
      </strong>
      <em>9折</em>
    </button>
  );
}
