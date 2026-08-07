import { useState, type ReactNode } from "react";

import {
  Badge,
  AppModal,
  Button,
  CatalogImage,
  InventoryActionDialogHeader,
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
    <AppModal
      className="inventory-action-dialog-backdrop"
      labelledBy="sell-quantity-title"
      onClose={onCancel}
    >
      <div className="modal inventory-action-dialog inventory-quantity-modal">
        <InventoryActionDialogHeader
          titleId="sell-quantity-title"
          title="选择出售数量"
          subtitle="只可出售正常可用数量"
          showHandle
        />
        <div className="inventory-action-dialog-content">
          <div className="inventory-quantity-item">
            <CatalogImage
              url={item.image_thumbnail_url}
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
          {!valid ? (
            <p role="alert">请输入 1 到当前可用数量之间的整数</p>
          ) : null}
        </div>
        <footer className="button-row inventory-action-dialog-actions">
          <Button className="secondary" onClick={onCancel}>
            取消
          </Button>
          <Button disabled={!valid} onClick={() => onConfirm(quantity)}>
            前往出售确认
          </Button>
        </footer>
      </div>
    </AppModal>
  );
}
