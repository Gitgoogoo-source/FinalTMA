import { useEffect, useMemo, useState } from "react";

import { BadgeDollarSign, Coins, Loader2, X } from "lucide-react";

import { MARKET_MAX_KCOIN_PRICE } from "../trade.constants";
import type { MyListing } from "../trade.types";
import { calculateMarketFeePreview, formatKcoinWithUnit } from "../trade.utils";

type ChangePriceDialogProps = {
  isPending: boolean;
  listing: MyListing | null;
  open: boolean;
  onClose: () => void;
  onConfirm: (newUnitPriceKcoin: number) => void;
};

export function ChangePriceDialog({
  isPending,
  listing,
  onClose,
  onConfirm,
  open,
}: ChangePriceDialogProps) {
  const [priceInput, setPriceInput] = useState("");

  useEffect(() => {
    if (!open || !listing) {
      setPriceInput("");
      return;
    }

    setPriceInput(String(listing.unitPriceKcoin));
  }, [listing, open]);

  const validation = useMemo(
    () => validatePriceInput(priceInput, listing?.unitPriceKcoin ?? null),
    [listing?.unitPriceKcoin, priceInput],
  );
  const preview = useMemo(
    () =>
      listing && validation.value !== null
        ? estimateNetAmount(listing, validation.value)
        : null,
    [listing, validation.value],
  );
  const confirmDisabled =
    isPending || validation.value === null || validation.error !== null;

  if (!open || !listing) {
    return null;
  }

  const handleClose = () => {
    if (!isPending) {
      onClose();
    }
  };

  const handleConfirm = () => {
    if (!confirmDisabled && validation.value !== null) {
      onConfirm(validation.value);
    }
  };

  return (
    <div className="change-price-dialog" role="presentation">
      <button
        aria-label="关闭改价弹窗"
        className="change-price-dialog__backdrop"
        onClick={handleClose}
        type="button"
      />
      <section
        aria-labelledby="change-price-title"
        aria-modal="true"
        className="change-price-dialog__panel"
        role="dialog"
      >
        <header className="change-price-dialog__header">
          <div>
            <span>改价</span>
            <h2 id="change-price-title">{listing.itemName}</h2>
          </div>
          <button aria-label="关闭" onClick={handleClose} type="button">
            <X aria-hidden="true" size={18} strokeWidth={2.5} />
          </button>
        </header>

        <div className="change-price-dialog__body">
          <div className="change-price-dialog__item">
            <div className="change-price-dialog__image">
              {listing.imageUrl ? (
                <img src={listing.imageUrl} alt={listing.itemName} />
              ) : (
                <span aria-hidden="true">{listing.itemName.slice(0, 1)}</span>
              )}
            </div>
            <div>
              <strong>{listing.itemName}</strong>
              <span>
                {listing.rarityLabel} · 剩余 {listing.remainingCount} /{" "}
                {listing.itemCount}
              </span>
            </div>
          </div>

          <label className="change-price-dialog__input">
            <span>新单价</span>
            <div>
              <Coins aria-hidden="true" size={16} strokeWidth={2.5} />
              <input
                aria-invalid={Boolean(validation.error)}
                disabled={isPending}
                inputMode="numeric"
                max={MARKET_MAX_KCOIN_PRICE}
                min={1}
                onChange={(event) => setPriceInput(event.target.value)}
                step={1}
                type="number"
                value={priceInput}
              />
            </div>
            <strong
              className={
                validation.error
                  ? "change-price-dialog__hint--error"
                  : undefined
              }
            >
              {validation.error ?? "K-coin"}
            </strong>
          </label>

          <dl className="change-price-dialog__summary">
            <div>
              <dt>当前单价</dt>
              <dd>{formatKcoinWithUnit(listing.unitPriceKcoin)}</dd>
            </div>
            <div>
              <dt>新单价</dt>
              <dd>
                {validation.value === null
                  ? "未设置"
                  : formatKcoinWithUnit(validation.value)}
              </dd>
            </div>
            <div>
              <dt>当前预计到账</dt>
              <dd>
                {listing.expectedNetAmountKcoin === null
                  ? "暂无参考"
                  : formatKcoinWithUnit(listing.expectedNetAmountKcoin)}
              </dd>
            </div>
            <div>
              <dt>新预计到账</dt>
              <dd>
                {preview === null ? "以后端为准" : formatKcoinWithUnit(preview)}
              </dd>
            </div>
          </dl>

          <p className="change-price-dialog__notice">
            最终预计到账以服务端返回为准。
          </p>
        </div>

        <footer className="change-price-dialog__actions">
          <button
            className="change-price-dialog__secondary"
            disabled={isPending}
            onClick={handleClose}
            type="button"
          >
            取消
          </button>
          <button
            className="change-price-dialog__primary"
            disabled={confirmDisabled}
            onClick={handleConfirm}
            type="button"
          >
            {isPending ? (
              <Loader2 aria-hidden="true" size={16} strokeWidth={2.5} />
            ) : (
              <BadgeDollarSign aria-hidden="true" size={16} strokeWidth={2.5} />
            )}
            {isPending ? "改价中" : "确认改价"}
          </button>
        </footer>
      </section>
    </div>
  );
}

function validatePriceInput(
  input: string,
  currentPriceKcoin: number | null,
): {
  value: number | null;
  error: string | null;
} {
  const trimmed = input.trim();

  if (!trimmed) {
    return {
      value: null,
      error: "请输入新价格",
    };
  }

  if (!/^\d+$/.test(trimmed)) {
    return {
      value: null,
      error: "价格必须是正整数",
    };
  }

  const value = Number(trimmed);

  if (!Number.isSafeInteger(value) || value <= 0) {
    return {
      value: null,
      error: "价格必须大于 0",
    };
  }

  if (value > MARKET_MAX_KCOIN_PRICE) {
    return {
      value: null,
      error: `价格不能超过 ${formatKcoinWithUnit(MARKET_MAX_KCOIN_PRICE)}`,
    };
  }

  if (currentPriceKcoin !== null && value === currentPriceKcoin) {
    return {
      value: null,
      error: "请输入不同的新价格",
    };
  }

  return {
    value,
    error: null,
  };
}

function estimateNetAmount(listing: MyListing, newUnitPriceKcoin: number) {
  if (listing.remainingCount <= 0 || listing.expectedNetAmountKcoin === null) {
    return null;
  }

  const currentGross = listing.unitPriceKcoin * listing.remainingCount;

  if (currentGross <= 0) {
    return null;
  }

  const currentFee = Math.max(
    currentGross - listing.expectedNetAmountKcoin,
    0,
  );
  const inferredFeeBps = Math.min(
    Math.max(Math.round((currentFee * 10_000) / currentGross), 0),
    10_000,
  );

  return calculateMarketFeePreview(
    newUnitPriceKcoin,
    listing.remainingCount,
    inferredFeeBps,
  ).netAmountKcoin;
}
