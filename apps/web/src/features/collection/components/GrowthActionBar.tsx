import { Info } from "lucide-react";

import type { CollectionInventoryItem } from "../collection.types";

import { ItemStatusBadge } from "./ItemStatusBadge";

type GrowthActionBarProps = {
  item: CollectionInventoryItem;
  onOpenDetail: () => void;
};

export function GrowthActionBar({ item, onOpenDetail }: GrowthActionBarProps) {
  const isListed = item.status === "listed";

  return (
    <section className="growth-action-bar" aria-label="藏品成长入口">
      <ItemStatusBadge status={item.status} isListed={isListed} />
      <button
        className="growth-action-bar__detail"
        onClick={onOpenDetail}
        type="button"
      >
        <Info aria-hidden="true" size={15} strokeWidth={2.5} />
        详情
      </button>
    </section>
  );
}
