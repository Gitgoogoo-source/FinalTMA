import { useState, type ReactNode } from "react";

import { Badge } from "../../../shared/ui/Badge.tsx";
import { AppModal } from "../../../shared/ui/AppModal.tsx";
import { Button } from "../../../shared/ui/Button.tsx";
import { CatalogImage } from "../../../shared/ui/CatalogImage.tsx";
import { InventoryActionDialogHeader } from "../../../shared/ui/InventoryActionDialogHeader.tsx";
import { QuantityControl } from "../../../shared/ui/QuantityControl.tsx";
import type { InventoryItem } from "../types.ts";
import { t, tp } from "../../../platform/i18n/index.ts";

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
          title={t("选择出售数量")}
          subtitle={t("只可出售正常可用数量")}
          showHandle
        />
        <div className="inventory-action-dialog-content">
          <div className="inventory-quantity-item">
            <CatalogImage
              url={item.image_thumbnail_url}
              alt={t(item.name)}
              variant="thumbnail"
              loading="eager"
            />
            <div>
              <Badge>
                {tp("{{0}} · 第 {{1}} 阶", [item.rarity, item.stage])}
              </Badge>
              <strong>{t(item.name)}</strong>
              <span>{tp("当前可用 {{0}}", [item.available])}</span>
            </div>
          </div>
          <QuantityControl
            label={t("出售数量")}
            value={quantity}
            max={item.available}
            onChange={setQuantity}
          />
          <p>
            {t("下一步将按该数量展示单价、手续费和预计到账；确认后提交上架。")}
          </p>
          {!valid ? (
            <p role="alert">{t("请输入 1 到当前可用数量之间的整数")}</p>
          ) : null}
        </div>
        <footer className="button-row inventory-action-dialog-actions">
          <Button className="secondary" onClick={onCancel}>
            {t("取消")}
          </Button>
          <Button disabled={!valid} onClick={() => onConfirm(quantity)}>
            {t("前往出售确认")}
          </Button>
        </footer>
      </div>
    </AppModal>
  );
}
