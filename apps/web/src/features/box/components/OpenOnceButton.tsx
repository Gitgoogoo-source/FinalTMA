import { Loader2, Star } from "lucide-react";

import { formatCurrencyAmount } from "@/shared/lib/formatCurrency";

import type { BlindBox } from "../box.types";

type OpenOnceButtonProps = {
  box: BlindBox;
  isPending: boolean;
  onOpen: () => void;
};

export function OpenOnceButton({
  box,
  isPending,
  onOpen,
}: OpenOnceButtonProps) {
  const disabled = isPending || !box.isOpenable;

  return (
    <button
      className="box-open-button"
      disabled={disabled}
      onClick={onOpen}
      type="button"
    >
      <span>{isPending ? "创建中" : "开 1 次"}</span>
      <strong>
        {isPending ? (
          <Loader2 aria-hidden="true" size={15} strokeWidth={2.4} />
        ) : (
          <Star aria-hidden="true" size={15} strokeWidth={2.4} />
        )}
        {formatCurrencyAmount(box.singleStarPrice)}
      </strong>
    </button>
  );
}
