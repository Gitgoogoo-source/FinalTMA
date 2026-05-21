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
            <span
              className={`box-tier-card__egg box-tier-card__egg--${getTierTone(box.tier)}`}
            />
            <span className="box-tier-card__name">{box.name}</span>
            <span className="box-tier-card__price">
              {formatCurrencyAmount(box.singleStarPrice)} Stars
            </span>
            <span
              className={`box-tier-card__stock box-tier-card__stock--${stock.tone}`}
              title={stock.title}
            >
              {stock.label}
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
