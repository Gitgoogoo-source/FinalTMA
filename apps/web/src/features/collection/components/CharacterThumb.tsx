import { useState } from "react";

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
  const [failedImageUrl, setFailedImageUrl] = useState<string | null>(null);
  const visibleImageUrl =
    imageUrl && imageUrl !== failedImageUrl ? imageUrl : null;
  const serialLabel = item.serialNo ? `#${item.serialNo}` : item.rarity.label;

  return (
    <button
      className={`character-thumb character-thumb--${item.rarity.code}${
        isSelected ? " character-thumb--selected" : ""
      }`}
      onClick={() => onSelect(item.itemInstanceId)}
      type="button"
      aria-pressed={isSelected}
      aria-label={`${item.name}，${item.rarity.label}，等级 ${item.level}，战力 ${item.power}${
        item.form?.displayName ? `，形态 ${item.form.displayName}` : ""
      }${isSelected ? "，已选中" : ""}`}
    >
      <span className="character-thumb__image" aria-hidden="true">
        <span className="character-thumb__shine" />
        <span className="character-thumb__serial">{serialLabel}</span>
        <span className="character-thumb__rarity-dot" />
        {visibleImageUrl ? (
          <img
            src={visibleImageUrl}
            alt=""
            draggable="false"
            onError={() => setFailedImageUrl(visibleImageUrl)}
          />
        ) : (
          item.name.slice(0, 1)
        )}
      </span>
    </button>
  );
}
