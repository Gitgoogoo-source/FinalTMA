import { Check } from "lucide-react";

import type { SellableItemGroup } from "../trade.types";
import {
  formatKcoinWithUnit,
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
        aria-label={`${item.itemName}，${item.rarityLabel}，可出售 ${
          item.availableCount
        } 件，参考价 ${
          referencePrice === null
            ? "暂无参考"
            : formatKcoinWithUnit(referencePrice)
        }`}
        aria-pressed={isSelected}
        className="sell-item-card__button"
        onClick={() => onSelect(item)}
        type="button"
      >
        <div className="sell-item-card__image">
          {imageContent}
          {item.availableCount > 1 ? (
            <span className="sell-item-card__count">x{item.availableCount}</span>
          ) : null}
          <span
            className="sell-item-card__rarity-dot"
            aria-hidden="true"
          />
          {isSelected ? (
            <span className="sell-item-card__check" aria-hidden="true">
              <Check size={13} strokeWidth={3} />
            </span>
          ) : null}
        </div>

        <div className="sell-item-card__body">
          <strong>{item.itemName}</strong>
          <span>{item.rarityLabel}</span>
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
