import { Check, Star } from "lucide-react";

import { formatCurrencyAmount } from "@/shared/lib/formatCurrency";

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
        const stock = getStockMeta(box);

        return (
          <button
            className={`box-tier-card${selected ? " box-tier-card--selected" : ""}`}
            key={box.id}
            onClick={() => onSelect(box.id)}
            type="button"
            aria-pressed={selected}
            aria-label={`${box.name}，${formatCurrencyAmount(
              box.singleStarPrice,
            )} Stars，${stock.label}${selected ? "，已选中" : ""}`}
          >
            <BoxTierPreview box={box} />
            <span className="box-tier-card__name">{box.name}</span>
            <span className="box-tier-card__quality">
              {getTierQualityLabel(box.tier)}
            </span>
            <span className="box-tier-card__price">
              <Star aria-hidden="true" size={12} strokeWidth={2.5} />
              {formatCurrencyAmount(box.singleStarPrice)} Stars
            </span>
            <span className="box-tier-card__stock" title={stock.title}>
              {stock.label}
            </span>
            <span
              className={`box-tier-card__state box-tier-card__state--${stock.tone}`}
              title={stock.title}
              aria-hidden="true"
            />
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
  const imageUrl = box.coverImageUrl ?? box.heroImageUrl;
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

function getStockMeta(box: BlindBox): {
  label: string;
  title: string;
  tone: "available" | "low" | "sold" | "muted";
} {
  if (box.stockStatus === "unlimited") {
    return {
      label: "不限量",
      title: "库存不限量",
      tone: "available",
    };
  }

  if (box.stockStatus === "sold_out" || box.remainingStock === 0) {
    return {
      label: "库存售罄",
      title: "库存已售罄",
      tone: "sold",
    };
  }

  if (box.remainingStock === null) {
    return {
      label: box.stockStatus === "low_stock" ? "库存紧张" : "库存可用",
      title: "库存数量同步中",
      tone: box.stockStatus === "low_stock" ? "low" : "muted",
    };
  }

  if (box.stockStatus === "low_stock") {
    return {
      label: `仅剩 ${formatCurrencyAmount(box.remainingStock)}`,
      title: getStockTitle(box),
      tone: "low",
    };
  }

  return {
    label: `剩余 ${formatCurrencyAmount(box.remainingStock)}`,
    title: getStockTitle(box),
    tone: "available",
  };
}

function getStockTitle(box: BlindBox): string {
  if (box.remainingStock === null) {
    return "库存数量同步中";
  }

  if (box.totalStock === null) {
    return `剩余 ${formatCurrencyAmount(box.remainingStock)}`;
  }

  return `剩余 ${formatCurrencyAmount(box.remainingStock)} / ${formatCurrencyAmount(
    box.totalStock,
  )}`;
}
