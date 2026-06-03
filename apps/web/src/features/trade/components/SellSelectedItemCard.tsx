import { BadgeDollarSign, Coins, PackageCheck, Sparkles } from "lucide-react";

import type { SellableItemGroup } from "../trade.types";
import {
  formatKcoinWithUnit,
  getItemTypeLabel,
  getSellableItemReferencePrice,
} from "../trade.utils";

type SellSelectedItemCardProps = {
  item: SellableItemGroup | null;
  quantity: number;
  selectedItemInstanceIds: string[];
};

export function SellSelectedItemCard({
  item,
  quantity,
  selectedItemInstanceIds,
}: SellSelectedItemCardProps) {
  if (!item) {
    return (
      <section className="sell-selected-card sell-selected-card--empty">
        <BadgeDollarSign aria-hidden="true" size={34} strokeWidth={2.1} />
        <strong>选择要出售的藏品</strong>
        <span>选中库存后会显示详情和可出售数量。</span>
      </section>
    );
  }

  const referencePrice = getSellableItemReferencePrice(item);
  const typeLabel = getItemTypeLabel(item.typeCode);
  const serialLabel = item.serialNo === null ? "#--" : `#${item.serialNo}`;
  const imageContent = item.imageUrl ? (
    <img src={item.imageUrl} alt={item.itemName} />
  ) : (
    <span aria-hidden="true">{item.itemName.slice(0, 1)}</span>
  );

  return (
    <section
      className={`sell-selected-card sell-selected-card--${getRarityTone(
        item.rarityCode,
      )}`}
      aria-label="当前出售对象"
    >
      <div className="sell-selected-card__hero">
        {imageContent}
      </div>

      <div className="sell-selected-card__content">
        <div className="sell-selected-card__title">
          <span className="sell-selected-card__eyebrow">当前选择</span>
          <div className="sell-selected-card__badges">
            <span>{item.rarityLabel}</span>
            <span>{serialLabel}</span>
          </div>
          <h2>{item.itemName}</h2>
          <p>{typeLabel}</p>
        </div>

        <div className="sell-selected-card__owned">
          你拥有 <strong>{item.ownedCount}</strong> 份，可出售{" "}
          <strong>{item.availableCount}</strong> 份
        </div>

        <dl className="sell-selected-card__summary">
          <div>
            <Sparkles aria-hidden="true" size={18} strokeWidth={2.4} />
            <span>
              <dt>稀有度</dt>
              <dd>{item.rarityLabel}</dd>
            </span>
          </div>
          <div>
            <PackageCheck aria-hidden="true" size={18} strokeWidth={2.4} />
            <span>
              <dt>已选</dt>
              <dd>{quantity} 件</dd>
            </span>
          </div>
        </dl>

        <div className="sell-selected-card__reference">
          <Coins aria-hidden="true" size={15} strokeWidth={2.5} />
          <span>
            {referencePrice === null
              ? "暂无参考价"
              : formatKcoinWithUnit(referencePrice)}
          </span>
        </div>

        <p className="sell-selected-card__ids">
          已选 {selectedItemInstanceIds.length} 件具体藏品
        </p>
      </div>
    </section>
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
