import { Coins, ShoppingCart, X } from "lucide-react";

import type { MarketListingCard, MarketListingDetail } from "../trade.types";
import {
  formatKcoinWithUnit,
  getMarketBuyDisabledReason,
} from "../trade.utils";

type BuyConfirmDialogProps = {
  open: boolean;
  listing: MarketListingCard | MarketListingDetail | null;
  balanceAvailable: string;
  isPending: boolean;
  onClose: () => void;
  onConfirm: () => void;
};

export function BuyConfirmDialog({
  balanceAvailable,
  isPending,
  listing,
  onClose,
  onConfirm,
  open,
}: BuyConfirmDialogProps) {
  if (!open || !listing) {
    return null;
  }

  const disabledReason = getMarketBuyDisabledReason(listing, balanceAvailable);
  const confirmDisabled = Boolean(disabledReason) || isPending;

  return (
    <div className="buy-confirm-dialog" role="presentation">
      <button
        aria-label="关闭购买确认"
        className="buy-confirm-dialog__backdrop"
        onClick={onClose}
        type="button"
      />
      <section
        aria-labelledby="buy-confirm-title"
        aria-modal="true"
        className="buy-confirm-dialog__panel"
        role="dialog"
      >
        <header className="buy-confirm-dialog__header">
          <div>
            <span>购买确认</span>
            <h2 id="buy-confirm-title">{listing.itemName}</h2>
          </div>
          <button aria-label="关闭" onClick={onClose} type="button">
            <X aria-hidden="true" size={18} strokeWidth={2.5} />
          </button>
        </header>

        <div className="buy-confirm-dialog__body">
          <div className="buy-confirm-dialog__item">
            <div className="buy-confirm-dialog__image">
              {listing.imageUrl ? (
                <img src={listing.imageUrl} alt={listing.itemName} />
              ) : (
                <span aria-hidden="true">{listing.itemName.slice(0, 1)}</span>
              )}
            </div>
            <div>
              <strong>{listing.itemName}</strong>
              <span>
                {listing.rarityLabel} · 剩余 {listing.remainingCount}
              </span>
            </div>
          </div>

          <dl className="buy-confirm-dialog__summary">
            <div>
              <dt>单价</dt>
              <dd>{formatKcoinWithUnit(listing.unitPriceKcoin)}</dd>
            </div>
            <div>
              <dt>购买数量</dt>
              <dd>1</dd>
            </div>
            <div>
              <dt>需支付</dt>
              <dd>{formatKcoinWithUnit(listing.unitPriceKcoin)}</dd>
            </div>
            <div>
              <dt>当前余额</dt>
              <dd>{formatKcoinWithUnit(balanceAvailable)}</dd>
            </div>
          </dl>

          {disabledReason ? (
            <p className="buy-confirm-dialog__notice">{disabledReason}</p>
          ) : null}
        </div>

        <footer className="buy-confirm-dialog__actions">
          <button
            className="buy-confirm-dialog__secondary"
            disabled={isPending}
            onClick={onClose}
            type="button"
          >
            取消
          </button>
          <button
            className="buy-confirm-dialog__primary"
            disabled={confirmDisabled}
            onClick={onConfirm}
            type="button"
          >
            {isPending ? (
              <ShoppingCart aria-hidden="true" size={16} strokeWidth={2.5} />
            ) : (
              <Coins aria-hidden="true" size={16} strokeWidth={2.5} />
            )}
            {isPending ? "购买中" : "确认购买"}
          </button>
        </footer>
      </section>
    </div>
  );
}
