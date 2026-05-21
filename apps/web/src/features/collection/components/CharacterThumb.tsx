import { Check } from "lucide-react";

import type { CollectionInventoryItem } from "../collection.types";

type CharacterThumbProps = {
  item: CollectionInventoryItem;
  isSelected: boolean;
  onSelect: (itemId: string) => void;
};

export function CharacterThumb({
  item,
  isSelected,
  onSelect,
}: CharacterThumbProps) {
  const imageUrl = item.thumbnailUrl ?? item.avatarUrl ?? item.imageUrl;

  return (
    <button
      className={`character-thumb character-thumb--${item.rarity.code}${
        isSelected ? " character-thumb--selected" : ""
      }`}
      onClick={() => onSelect(item.itemInstanceId)}
      type="button"
      aria-pressed={isSelected}
      aria-label={`${item.name}，${item.rarity.label}，等级 ${item.level}，战力 ${item.power}${
        isSelected ? "，已选中" : ""
      }`}
    >
      <span className="character-thumb__image">
        {imageUrl ? (
          <img src={imageUrl} alt={item.name} />
        ) : (
          item.name.slice(0, 1)
        )}
      </span>
      <span className="character-thumb__copy">
        <strong>{item.name}</strong>
        <span>
          Lv.{item.level}
          {" · "}
          {item.rarity.label}
        </span>
      </span>
      <span className="character-thumb__power">{item.power}</span>
      <span className="character-thumb__check" aria-hidden="true">
        {isSelected ? <Check size={13} strokeWidth={3} /> : null}
      </span>
    </button>
  );
}
