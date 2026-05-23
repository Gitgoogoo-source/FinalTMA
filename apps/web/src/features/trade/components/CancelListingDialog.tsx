import { AlertTriangle, Loader2, Trash2, X } from "lucide-react";

import type { MyListing } from "../trade.types";
import { formatKcoinWithUnit, getListingStatusLabel } from "../trade.utils";

type CancelListingDialogProps = {
  isPending: boolean;
  listing: MyListing | null;
  open: boolean;
  onClose: () => void;
  onConfirm: () => void;
};

export function CancelListingDialog({
  isPending,
  listing,
  onClose,
  onConfirm,
  open,
}: CancelListingDialogProps) {
  if (!open || !listing) {
    return null;
  }

  const remainingValueKcoin =
    listing.unitPriceKcoin * Math.max(listing.remainingCount, 0);

  const handleClose = () => {
    if (!isPending) {
      onClose();
    }
  };

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
        aria-labelledby="cancel-listing-title"
        aria-modal="true"
        className="cancel-listing-dialog__panel change-price-dialog__panel"
        role="dialog"
      >
        <header className="cancel-listing-dialog__header change-price-dialog__header">
          <div>
            <span>下架确认</span>
            <h2 id="cancel-listing-title">{listing.itemName}</h2>
          </div>
          <button aria-label="关闭" onClick={handleClose} type="button">
            <X aria-hidden="true" size={18} strokeWidth={2.5} />
          </button>
        </header>

        <div className="cancel-listing-dialog__body change-price-dialog__body">
          <div className="cancel-listing-dialog__item change-price-dialog__item">
            <div className="cancel-listing-dialog__image change-price-dialog__image">
              {listing.imageUrl ? (
                <img src={listing.imageUrl} alt={listing.itemName} />
              ) : (
                <span aria-hidden="true">{listing.itemName.slice(0, 1)}</span>
              )}
            </div>
            <div>
              <strong>{listing.itemName}</strong>
              <span>
                {listing.rarityLabel} · {getListingStatusLabel(listing.status)}
              </span>
            </div>
          </div>

          <dl className="cancel-listing-dialog__summary change-price-dialog__summary">
            <div>
              <dt>单价</dt>
              <dd>{formatKcoinWithUnit(listing.unitPriceKcoin)}</dd>
            </div>
            <div>
              <dt>未售出数量</dt>
              <dd>
                {listing.remainingCount} / {listing.itemCount}
              </dd>
            </div>
            <div>
              <dt>未售出总价</dt>
              <dd>{formatKcoinWithUnit(remainingValueKcoin)}</dd>
            </div>
            <div>
              <dt>预计到账</dt>
              <dd>
                {listing.expectedNetAmountKcoin === null
                  ? "暂无参考"
                  : formatKcoinWithUnit(listing.expectedNetAmountKcoin)}
              </dd>
            </div>
          </dl>

          <p className="cancel-listing-dialog__notice change-price-dialog__notice">
            <AlertTriangle aria-hidden="true" size={15} strokeWidth={2.5} />
            确认下架后，未售出的藏品会回到库存，并可在出售页重新选择。
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
