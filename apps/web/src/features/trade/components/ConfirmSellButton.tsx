import { useEffect, useState } from "react";

import { BadgeDollarSign, Loader2, X } from "lucide-react";

import type { SellableItemGroup } from "../trade.types";
import {
  calculateMarketFeePreview,
  formatKcoinAmount,
  formatKcoinWithUnit,
} from "../trade.utils";

type ConfirmSellButtonProps = {
  disabled: boolean;
  feeBps: number | null;
  isPending: boolean;
  item: SellableItemGroup | null;
  quantity: number;
  unitPriceKcoin: number | null;
  validationMessage: string | null;
  onConfirm: () => void;
};

export function ConfirmSellButton({
  disabled,
  feeBps,
  isPending,
  item,
  onConfirm,
  quantity,
  unitPriceKcoin,
  validationMessage,
}: ConfirmSellButtonProps) {
  const [open, setOpen] = useDialogState(isPending);
  const hasUnitPrice = unitPriceKcoin !== null;
  const canOpen = Boolean(!disabled && !isPending && item && hasUnitPrice);
  const preview =
    item && hasUnitPrice && feeBps !== null
      ? calculateMarketFeePreview(unitPriceKcoin, quantity, feeBps)
      : null;
  const receiveAmountLabel = hasUnitPrice
    ? preview
      ? formatKcoinAmount(preview.netAmountKcoin)
      : "以后端为准"
    : "-";

  useEffect(() => {
    if (!item || !hasUnitPrice) {
      setOpen(false);
    }
  }, [hasUnitPrice, item, setOpen]);

  const handleOpen = () => {
    if (canOpen) {
      setOpen(true);
    }
  };

  const handleClose = () => {
    if (!isPending) {
      setOpen(false);
    }
  };

  const handleConfirm = () => {
    if (!disabled && !isPending) {
      onConfirm();
    }
  };

  return (
    <>
      <div className="sell-confirm">
        <button
          aria-label="确认出售"
          className="sell-confirm__button"
          disabled={disabled || isPending}
          onClick={handleOpen}
          type="button"
        >
          <span className="sell-confirm__action">
            {isPending ? (
              <Loader2 aria-hidden="true" size={16} strokeWidth={2.5} />
            ) : (
              <BadgeDollarSign aria-hidden="true" size={16} strokeWidth={2.5} />
            )}
            {isPending ? "上架中" : "确认出售"}
          </span>
          <span className="sell-confirm__divider" aria-hidden="true" />
          <span className="sell-confirm__receive" aria-hidden="true">
            到手 <strong>{receiveAmountLabel}</strong>
            {preview ? <small>K-coin</small> : null}
          </span>
        </button>
        {validationMessage ? (
          <span className="sell-confirm__hint">{validationMessage}</span>
        ) : null}
      </div>

      <ConfirmSellDialog
        feeBps={feeBps}
        isPending={isPending}
        item={item}
        onClose={handleClose}
        onConfirm={handleConfirm}
        open={open}
        quantity={quantity}
        unitPriceKcoin={unitPriceKcoin}
      />
    </>
  );
}

type ConfirmSellDialogProps = {
  feeBps: number | null;
  isPending: boolean;
  item: SellableItemGroup | null;
  open: boolean;
  quantity: number;
  unitPriceKcoin: number | null;
  onClose: () => void;
  onConfirm: () => void;
};

function ConfirmSellDialog({
  feeBps,
  isPending,
  item,
  onClose,
  onConfirm,
  open,
  quantity,
  unitPriceKcoin,
}: ConfirmSellDialogProps) {
  if (!open || !item || unitPriceKcoin === null) {
    return null;
  }

  const preview =
    feeBps === null
      ? null
      : calculateMarketFeePreview(unitPriceKcoin, quantity, feeBps);

  return (
    <div className="sell-confirm-dialog" role="presentation">
      <button
        aria-label="关闭出售确认"
        className="sell-confirm-dialog__backdrop"
        onClick={onClose}
        type="button"
      />
      <section
        aria-labelledby="sell-confirm-title"
        aria-modal="true"
        className="sell-confirm-dialog__panel"
        role="dialog"
      >
        <header className="sell-confirm-dialog__header">
          <div>
            <span>出售确认</span>
            <h2 id="sell-confirm-title">{item.itemName}</h2>
          </div>
          <button aria-label="关闭" onClick={onClose} type="button">
            <X aria-hidden="true" size={18} strokeWidth={2.5} />
          </button>
        </header>

        <div className="sell-confirm-dialog__body">
          <div className="sell-confirm-dialog__item">
            <div className="sell-confirm-dialog__image">
              {item.imageUrl ? (
                <img src={item.imageUrl} alt={item.itemName} />
              ) : (
                <span aria-hidden="true">{item.itemName.slice(0, 1)}</span>
              )}
            </div>
            <div>
              <strong>{item.itemName}</strong>
              <span>
                {item.rarityLabel} · 出售 {quantity} 件
              </span>
            </div>
          </div>

          <dl className="sell-confirm-dialog__summary">
            <div>
              <dt>单价</dt>
              <dd>{formatKcoinWithUnit(unitPriceKcoin)}</dd>
            </div>
            <div>
              <dt>数量</dt>
              <dd>{quantity}</dd>
            </div>
            <div>
              <dt>总价</dt>
              <dd>
                {preview
                  ? formatKcoinWithUnit(preview.grossAmountKcoin)
                  : formatKcoinWithUnit(unitPriceKcoin * quantity)}
              </dd>
            </div>
            <div>
              <dt>平台手续费</dt>
              <dd>
                {preview
                  ? formatKcoinWithUnit(preview.feeAmountKcoin)
                  : "以后端为准"}
              </dd>
            </div>
            <div>
              <dt>预计到手</dt>
              <dd>
                {preview
                  ? formatKcoinWithUnit(preview.netAmountKcoin)
                  : "以后端为准"}
              </dd>
            </div>
          </dl>

          <p className="sell-confirm-dialog__notice">
            实际到手金额以后端返回为准。
          </p>
        </div>

        <footer className="sell-confirm-dialog__actions">
          <button
            className="sell-confirm-dialog__secondary"
            disabled={isPending}
            onClick={onClose}
            type="button"
          >
            取消
          </button>
          <button
            className="sell-confirm-dialog__primary"
            disabled={isPending}
            onClick={onConfirm}
            type="button"
          >
            {isPending ? (
              <Loader2 aria-hidden="true" size={16} strokeWidth={2.5} />
            ) : (
              <BadgeDollarSign aria-hidden="true" size={16} strokeWidth={2.5} />
            )}
            {isPending ? "上架中" : "确认出售"}
          </button>
        </footer>
      </section>
    </div>
  );
}

function useDialogState(
  isPending: boolean,
): [boolean, (value: boolean) => void] {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!isPending) {
      return;
    }

    setOpen(true);
  }, [isPending]);

  return [open, setOpen];
}
