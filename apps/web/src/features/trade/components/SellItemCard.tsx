import { Check, Coins } from "lucide-react";

import type { SellableItemGroup } from "../trade.types";
import {
  formatKcoinWithUnit,
  getItemTypeLabel,
  getSellableItemReferencePrice,
} from "../trade.utils";

type SellItemCardProps = {
  item: SellableItemGroup;
  isSelected: boolean;
  onSelect: (item: SellableItemGroup) => void;
};

export function SellItemCard({
  item,
  isSelected,
  onSelect,
}: SellItemCardProps) {
  const referencePrice = getSellableItemReferencePrice(item);
  const imageContent = item.imageUrl ? (
    <img src={item.imageUrl} alt={item.itemName} />
  ) : (
    <span aria-hidden="true">{item.itemName.slice(0, 1)}</span>
  );

  return (
    <article
      className={`sell-item-card sell-item-card--${getRarityTone(
        item.rarityCode,
      )}${isSelected ? " sell-item-card--selected" : ""}`}
    >
      <button
        aria-pressed={isSelected}
        className="sell-item-card__button"
        onClick={() => onSelect(item)}
        type="button"
      >
        <div className="sell-item-card__image">
          {imageContent}
          {isSelected ? (
            <span className="sell-item-card__check" aria-hidden="true">
              <Check size={13} strokeWidth={3} />
            </span>
          ) : null}
        </div>

        <div className="sell-item-card__body">
          <div className="sell-item-card__title">
            <h3>{item.itemName}</h3>
            <span>{item.rarityLabel}</span>
          </div>

          <dl className="sell-item-card__meta">
            <div>
              <dt>可售</dt>
              <dd>{item.availableCount}</dd>
            </div>
            <div>
              <dt>类型</dt>
              <dd>{getItemTypeLabel(item.typeCode)}</dd>
            </div>
            <div>
              <dt>战力</dt>
              <dd>{item.power}</dd>
            </div>
          </dl>

          <strong className="sell-item-card__price">
            <Coins aria-hidden="true" size={14} strokeWidth={2.5} />
            {referencePrice === null
              ? "暂无参考"
              : formatKcoinWithUnit(referencePrice)}
          </strong>
        </div>
      </button>
    </article>
  );
}

function getRarityTone(rarityCode: string): string {
  if (
    rarityCode === "common" ||
    rarityCode === "rare" ||
    rarityCode === "epic" ||
    rarityCode === "legendary" ||
    rarityCode === "mythic"
  ) {
    return rarityCode;
  }

  return "common";
}
