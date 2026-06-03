import type { CollectionInventoryGroup } from "../collection.types";
import { CharacterThumb } from "./CharacterThumb";

type CharacterGridProps = {
  groups: CollectionInventoryGroup[];
  selectedItemId: string | null;
  onSelect: (itemId: string) => void;
};

export function CharacterGrid({
  groups,
  selectedItemId,
  onSelect,
}: CharacterGridProps) {
  return (
    <section className="character-grid" aria-label="藏品网格">
      <div className="character-grid__track">
        <div className="character-grid__items">
          {groups.map((group) => (
            <CharacterThumb
              item={group.representativeItem}
              isSelected={
                selectedItemId
                  ? group.itemInstanceIds.includes(selectedItemId)
                  : false
              }
              key={group.key}
              onSelect={onSelect}
              ownedCount={group.ownedCount}
            />
          ))}
        </div>
      </div>
    </section>
  );
}
