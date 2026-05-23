import { BadgeDollarSign, Coins } from "lucide-react";

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
  const imageContent = item.imageUrl ? (
    <img src={item.imageUrl} alt={item.itemName} />
  ) : (
    <span aria-hidden="true">{item.itemName.slice(0, 1)}</span>
  );

  return (
    <section className="sell-selected-card" aria-label="当前出售对象">
      <div className="sell-selected-card__hero">
        {imageContent}
        <strong>{item.rarityLabel}</strong>
      </div>

      <div className="sell-selected-card__content">
        <div className="sell-selected-card__title">
          <span>当前选择</span>
          <h2>{item.itemName}</h2>
        </div>

        <dl className="sell-selected-card__summary">
          <div>
            <dt>持有</dt>
            <dd>{item.ownedCount}</dd>
          </div>
          <div>
            <dt>可出售</dt>
            <dd>{item.availableCount}</dd>
          </div>
          <div>
            <dt>已选</dt>
            <dd>{quantity}</dd>
          </div>
          <div>
            <dt>类型</dt>
            <dd>{getItemTypeLabel(item.typeCode)}</dd>
          </div>
          <div>
            <dt>等级</dt>
            <dd>{item.level}</dd>
          </div>
          <div>
            <dt>战力</dt>
            <dd>{item.power}</dd>
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
