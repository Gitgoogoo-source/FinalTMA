import type { CollectionInventoryItem } from "../collection.types";
import { CharacterThumb } from "./CharacterThumb";

type CharacterGridProps = {
  items: CollectionInventoryItem[];
  selectedItemId: string | null;
  onSelect: (itemId: string) => void;
};

export function CharacterGrid({
  items,
  selectedItemId,
  onSelect,
}: CharacterGridProps) {
  return (
    <section className="character-grid" aria-label="藏品网格">
      <div className="character-grid__track">
        <div className="character-grid__items">
          {items.map((item) => (
            <CharacterThumb
              item={item}
              isSelected={item.itemInstanceId === selectedItemId}
              key={item.itemInstanceId}
              onSelect={onSelect}
            />
          ))}
        </div>
      </div>
    </section>
  );
}
