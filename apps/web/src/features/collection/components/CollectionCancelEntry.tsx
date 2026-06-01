import { AlertTriangle, Loader2, Trash2, X } from "lucide-react";

import { formatKcoinWithUnit } from "@/features/trade/trade.utils";

import type { CollectionInventoryItem } from "../collection.types";

type CollectionCancelEntryProps = {
  isPending: boolean;
  item: CollectionInventoryItem | null;
  open: boolean;
  unitPriceKcoin?: number | null;
  onClose: () => void;
  onConfirm: () => void;
};

export function CollectionCancelEntry({
  isPending,
  item,
  onClose,
  onConfirm,
  open,
  unitPriceKcoin = null,
}: CollectionCancelEntryProps) {
  if (!open || !item) {
    return null;
  }

  const imageUrl = item.imageUrl ?? item.thumbnailUrl ?? item.avatarUrl;

  function handleClose() {
    if (!isPending) {
      onClose();
    }
  }

  return (
    <div
      className="cancel-listing-dialog change-price-dialog"
      role="presentation"
    >
      <button
        aria-label="关闭下架确认"
        className="cancel-listing-dialog__backdrop change-price-dialog__backdrop"
        onClick={handleClose}
        type="button"
      />
      <section
        aria-labelledby="collection-cancel-entry-title"
        aria-modal="true"
        className="cancel-listing-dialog__panel change-price-dialog__panel"
        role="dialog"
      >
        <header className="cancel-listing-dialog__header change-price-dialog__header">
          <div>
            <span>下架藏品</span>
            <h2 id="collection-cancel-entry-title">{item.name}</h2>
          </div>
          <button aria-label="关闭" onClick={handleClose} type="button">
            <X aria-hidden="true" size={18} strokeWidth={2.5} />
          </button>
        </header>

        <div className="cancel-listing-dialog__body change-price-dialog__body">
          <div className="cancel-listing-dialog__item change-price-dialog__item">
            <div className="cancel-listing-dialog__image change-price-dialog__image">
              {imageUrl ? (
                <img src={imageUrl} alt={item.name} />
              ) : (
                <span aria-hidden="true">{item.name.slice(0, 1)}</span>
              )}
            </div>
            <div>
              <strong>{item.name}</strong>
              <span>
                {item.rarity.label} ·{" "}
                {item.serialNo ? `#${formatNumber(item.serialNo)}` : "未编号"}
              </span>
            </div>
          </div>

          <dl className="cancel-listing-dialog__summary change-price-dialog__summary">
            <div>
              <dt>当前状态</dt>
              <dd>挂售中</dd>
            </div>
            <div>
              <dt>挂单单价</dt>
              <dd>
                {unitPriceKcoin === null
                  ? "读取中"
                  : formatKcoinWithUnit(unitPriceKcoin)}
              </dd>
            </div>
            <div>
              <dt>释放数量</dt>
              <dd>未售出藏品</dd>
            </div>
            <div>
              <dt>到账状态</dt>
              <dd>未成交部分不会到账</dd>
            </div>
          </dl>

          <p className="cancel-listing-dialog__notice change-price-dialog__notice">
            <AlertTriangle aria-hidden="true" size={15} strokeWidth={2.5} />
            确认下架后，服务端会释放该挂单未售出的库存锁。
          </p>
        </div>

        <footer className="cancel-listing-dialog__actions change-price-dialog__actions">
          <button
            className="cancel-listing-dialog__secondary change-price-dialog__secondary"
            disabled={isPending}
            onClick={handleClose}
            type="button"
          >
            暂不下架
          </button>
          <button
            className="cancel-listing-dialog__primary change-price-dialog__primary"
            disabled={isPending}
            onClick={onConfirm}
            type="button"
          >
            {isPending ? (
              <Loader2 aria-hidden="true" size={16} strokeWidth={2.5} />
            ) : (
              <Trash2 aria-hidden="true" size={16} strokeWidth={2.5} />
            )}
            {isPending ? "下架中" : "确认下架"}
          </button>
        </footer>
      </section>
    </div>
  );
}

function formatNumber(value: number): string {
  return new Intl.NumberFormat("zh-CN", {
    maximumFractionDigits: 0,
  }).format(value);
}
