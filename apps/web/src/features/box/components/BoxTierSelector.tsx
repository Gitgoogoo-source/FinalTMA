import { Check } from "lucide-react";

import { formatCurrencyAmount } from "@/shared/lib/formatCurrency";

import type { BlindBox } from "../box.types";
import { BoxStatusBadge } from "./BoxStatusBadge";

type BoxTierSelectorProps = {
  boxes: BlindBox[];
  selectedBoxId: string | null;
  onSelect: (boxId: string) => void;
};

export function BoxTierSelector({
  boxes,
  selectedBoxId,
  onSelect,
}: BoxTierSelectorProps) {
  return (
    <section className="box-tier-selector" aria-label="选择盲盒档次">
      {boxes.map((box) => {
        const selected = box.id === selectedBoxId;

        return (
          <button
            className={`box-tier-card${selected ? " box-tier-card--selected" : ""}`}
            key={box.id}
            onClick={() => onSelect(box.id)}
            type="button"
            aria-pressed={selected}
          >
            <span
              className={`box-tier-card__egg box-tier-card__egg--${getTierTone(box.tier)}`}
            />
            <span className="box-tier-card__name">{box.name}</span>
            <span className="box-tier-card__price">
              {formatCurrencyAmount(box.singleStarPrice)} Stars
            </span>
            <BoxStatusBadge status={box.status} />
            <span className="box-tier-card__check" aria-hidden="true">
              {selected ? <Check size={13} strokeWidth={3} /> : null}
            </span>
          </button>
        );
      })}
    </section>
  );
}

function getTierTone(tier: string): "normal" | "rare" | "legendary" | "event" {
  if (tier === "rare") {
    return "rare";
  }

  if (tier === "legendary") {
    return "legendary";
  }

  if (tier === "event") {
    return "event";
  }

  return "normal";
}
