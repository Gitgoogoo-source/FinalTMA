import { ShoppingBag } from "lucide-react";
import { useState, type ReactNode } from "react";

import {
  Badge,
  Button,
  CatalogImage,
  QuantityControl,
} from "../../../shared/ui/index.tsx";
import type { InventoryItem } from "../types.ts";

export function SellQuantityDialog({
  item,
  onCancel,
  onConfirm,
}: {
  item: InventoryItem;
  onCancel(): void;
  onConfirm(quantity: number): void;
}): ReactNode {
  const [quantity, setQuantity] = useState(1);
  const valid =
    Number.isInteger(quantity) && quantity >= 1 && quantity <= item.available;
  return (
    <div
      className="modal-backdrop"
      role="dialog"
      aria-modal="true"
      aria-labelledby="sell-quantity-title"
    >
      <div className="modal inventory-quantity-modal">
        <header>
          <ShoppingBag aria-hidden="true" />
          <div>
            <small>只可出售正常可用数量</small>
            <h2 id="sell-quantity-title">选择出售数量</h2>
          </div>
        </header>
        <div className="inventory-quantity-item">
          <CatalogImage
            path={item.image_thumbnail_path}
            alt={item.name}
            variant="thumbnail"
            loading="eager"
          />
          <div>
            <Badge>
              {item.rarity} · 第 {item.stage} 阶
            </Badge>
            <strong>{item.name}</strong>
            <span>当前可用 {item.available}</span>
          </div>
        </div>
        <QuantityControl
          label="出售数量"
          value={quantity}
          max={item.available}
          onChange={setQuantity}
        />
        <p>
          下一步将按该数量展示官方单价、手续费和预计到账；最终上架仍由后端整批原子裁决。
        </p>
        {!valid ? <p role="alert">请输入 1 到当前可用数量之间的整数</p> : null}
        <div className="button-row">
          <Button className="secondary" onClick={onCancel}>
            取消
          </Button>
          <Button disabled={!valid} onClick={() => onConfirm(quantity)}>
            前往出售确认
          </Button>
        </div>
      </div>
    </div>
  );
}
