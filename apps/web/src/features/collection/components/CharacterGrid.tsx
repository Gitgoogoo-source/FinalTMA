import type { CollectionInventoryGroup } from "../collection.types";
import { CharacterThumb } from "./CharacterThumb";

type CharacterGridProps = {
  groups: CollectionInventoryGroup[];
  selectedItemId: string | null;
  totalCount?: number;
  onSelect: (itemId: string) => void;
};

export function CharacterGrid({
  groups,
  selectedItemId,
  totalCount,
  onSelect,
}: CharacterGridProps) {
  const displayTotal = totalCount ?? groups.reduce(
    (sum, group) => sum + group.ownedCount,
    0,
  );

  return (
    <section className="character-grid" aria-label="藏品网格">
      <header className="character-grid__summary">
        <strong>{displayTotal.toLocaleString("en-US")}</strong>
        <span>件藏品</span>
        <em>{groups.length.toLocaleString("en-US")} 组</em>
      </header>
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
