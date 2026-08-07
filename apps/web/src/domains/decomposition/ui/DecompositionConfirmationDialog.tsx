import { ShieldAlert } from "lucide-react";
import { useState, type ReactNode } from "react";
import type { RouteOutput } from "@pokepets/api-contracts/app";

import {
  Badge,
  AppModal,
  Button,
  CatalogImage,
  InventoryActionDialogHeader,
  QuantityControl,
} from "../../../shared/ui/index.tsx";

type InventoryItem = RouteOutput<"inventory.list">["items"][number];

export function DecompositionConfirmationDialog({
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
      labelledBy="decomposition-confirmation-title"
      onClose={onCancel}
    >
      <div className="modal inventory-action-dialog inventory-quantity-modal">
        <InventoryActionDialogHeader
          titleId="decomposition-confirmation-title"
          title="确认分解该藏品？"
          subtitle="分解结果不可撤销"
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
              <span>
                总数量 {item.total} · 可用 {item.available}
              </span>
            </div>
          </div>
          <QuantityControl
            label="分解数量"
            value={quantity}
            max={item.available}
            onChange={setQuantity}
          />
          <dl className="result-summary">
            <div>
              <dt>单个产出</dt>
              <dd>{item.decompose_fgems} Fgems</dd>
            </div>
            <div>
              <dt>预计获得</dt>
              <dd>{valid ? item.decompose_fgems * quantity : 0} Fgems</dd>
            </div>
          </dl>
          <p className="inventory-quantity-warning">
            <ShieldAlert aria-hidden="true" />
            藏品将永久消失且不可恢复；图鉴点亮不会回退。
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
            确认分解
          </Button>
        </footer>
      </div>
    </AppModal>
  );
}
