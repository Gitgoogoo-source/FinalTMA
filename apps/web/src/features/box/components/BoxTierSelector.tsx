import { Check } from "lucide-react";

import { getBoxCoverImageUrl } from "../box.images";
import type { BlindBox } from "../box.types";

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
            aria-label={`${box.name}，${getTierQualityLabel(box.tier)}${selected ? "，已选中" : ""}`}
          >
            <BoxTierPreview box={box} />
            <span className="box-tier-card__name">{box.name}</span>
            <span className="box-tier-card__check" aria-hidden="true">
              {selected ? <Check size={13} strokeWidth={3} /> : null}
            </span>
          </button>
        );
      })}
    </section>
  );
}

function BoxTierPreview({ box }: { box: BlindBox }) {
  const imageUrl = getBoxCoverImageUrl(box);
  const tierTone = getTierTone(box.tier);

  if (imageUrl) {
    return (
      <span className="box-tier-card__preview" aria-hidden="true">
        <img src={imageUrl} alt="" />
      </span>
    );
  }

  return (
    <span className="box-tier-card__preview" aria-hidden="true">
      <span className={`box-tier-card__egg box-tier-card__egg--${tierTone}`}>
        <span />
      </span>
    </span>
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

function getTierQualityLabel(tier: string): string {
  if (tier === "rare") {
    return "稀有品质";
  }

  if (tier === "legendary") {
    return "传说品质";
  }

  if (tier === "event") {
    return "活动限定";
  }

  return "基础品质";
}
