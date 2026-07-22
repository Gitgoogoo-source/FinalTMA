import { Flame, ShieldAlert } from "lucide-react";
import { useState, type ReactNode } from "react";
import type { RouteOutput } from "@pokepets/api-contracts/app";

import {
  Badge,
  Button,
  CatalogImage,
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
    <div
      className="modal-backdrop"
      role="dialog"
      aria-modal="true"
      aria-labelledby="decomposition-confirmation-title"
    >
      <div className="modal inventory-quantity-modal">
        <header>
          <Flame aria-hidden="true" />
          <div>
            <small>分解结果不可撤销</small>
            <h2 id="decomposition-confirmation-title">确认分解该藏品？</h2>
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
        {!valid ? <p role="alert">请输入 1 到当前可用数量之间的整数</p> : null}
        <div className="button-row">
          <Button className="secondary" onClick={onCancel}>
            取消
          </Button>
          <Button disabled={!valid} onClick={() => onConfirm(quantity)}>
            确认分解
          </Button>
        </div>
      </div>
    </div>
  );
}
