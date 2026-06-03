import { BadgeDollarSign, Coins, Loader2, X } from "lucide-react";
import { useEffect, useMemo, useState } from "react";

import { MARKET_MAX_KCOIN_PRICE } from "@/features/trade/trade.constants";
import {
  calculateMarketFeePreview,
  formatKcoinWithUnit,
} from "@/features/trade/trade.utils";

import type { CollectionInventoryItem } from "../collection.types";

type CollectionSellEntryProps = {
  feeBps: number | null;
  isPending: boolean;
  item: CollectionInventoryItem | null;
  open: boolean;
  onClose: () => void;
  onConfirm: (unitPriceKcoin: number) => void;
};

export function CollectionSellEntry({
  feeBps,
  isPending,
  item,
  onClose,
  onConfirm,
  open,
}: CollectionSellEntryProps) {
  const [priceInput, setPriceInput] = useState("");

  useEffect(() => {
    if (!open) {
      setPriceInput("");
    }
  }, [open]);

  const validation = useMemo(
    () => validatePriceInput(priceInput),
    [priceInput],
  );
  const preview =
    validation.value !== null && feeBps !== null
      ? calculateMarketFeePreview(validation.value, 1, feeBps)
      : null;
  const confirmDisabled =
    isPending || validation.value === null || validation.error !== null;

  if (!open || !item) {
    return null;
  }

  const imageUrl = item.imageUrl ?? item.thumbnailUrl ?? item.avatarUrl;

  function handleClose() {
    if (!isPending) {
      onClose();
    }
  }

  function handleConfirm() {
    if (!confirmDisabled && validation.value !== null) {
      onConfirm(validation.value);
    }
  }

  return (
    <div
      className="change-price-dialog collection-entry-dialog"
      role="presentation"
    >
      <button
        aria-label="关闭出售弹窗"
        className="change-price-dialog__backdrop"
        onClick={handleClose}
        type="button"
      />
      <section
        aria-labelledby="collection-sell-entry-title"
        aria-modal="true"
        className="change-price-dialog__panel"
        role="dialog"
      >
        <header className="change-price-dialog__header">
          <div>
            <span>出售藏品</span>
            <h2 id="collection-sell-entry-title">{item.name}</h2>
          </div>
          <button aria-label="关闭" onClick={handleClose} type="button">
            <X aria-hidden="true" size={18} strokeWidth={2.5} />
          </button>
        </header>

        <div className="change-price-dialog__body">
          <div className="change-price-dialog__item">
            <div className="change-price-dialog__image">
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
                {item.serialNo
                  ? `#${formatCurrencyNumber(item.serialNo)}`
                  : "未编号"}
              </span>
            </div>
          </div>

          <label className="change-price-dialog__input">
            <span>出售单价</span>
            <div>
              <Coins aria-hidden="true" size={16} strokeWidth={2.5} />
              <input
                aria-label="出售单价"
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
              <dt>数量</dt>
              <dd>1</dd>
            </div>
            <div>
              <dt>单价</dt>
              <dd>
                {validation.value === null
                  ? "未设置"
                  : formatKcoinWithUnit(validation.value)}
              </dd>
            </div>
            <div>
              <dt>平台手续费</dt>
              <dd>
                {preview === null
                  ? feeBps === null
                    ? "以后端为准"
                    : "-"
                  : formatKcoinWithUnit(preview.feeAmountKcoin)}
              </dd>
            </div>
            <div>
              <dt>预计到账</dt>
              <dd>
                {preview === null
                  ? "以后端为准"
                  : formatKcoinWithUnit(preview.netAmountKcoin)}
              </dd>
            </div>
          </dl>

          <p className="change-price-dialog__notice">
            挂单会由服务端锁定该藏品，最终手续费和预计到账以服务端返回为准。
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
            {isPending ? "上架中" : "确认出售"}
          </button>
        </footer>
      </section>
    </div>
  );
}

function validatePriceInput(input: string): {
  value: number | null;
  error: string | null;
} {
  const trimmed = input.trim();

  if (!trimmed) {
    return {
      value: null,
      error: "请输入出售单价",
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

  return {
    value,
    error: null,
  };
}

function formatCurrencyNumber(value: number): string {
  return new Intl.NumberFormat("zh-CN", {
    maximumFractionDigits: 0,
  }).format(value);
}
