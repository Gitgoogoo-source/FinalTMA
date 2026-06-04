import { BadgeCheck, RefreshCw, ShieldCheck, X } from "lucide-react";

import { formatCurrencyAmount } from "@/shared/lib/formatCurrency";

import type { CollectionInventoryItem } from "../collection.types";

import {
  getCollectionStatusLabel,
  getMintStatusLabel,
} from "./ItemStatusBadge";

type MintConfirmPanelProps = {
  open: boolean;
  item: CollectionInventoryItem | null;
  isPending?: boolean;
  onClose: () => void;
  onConfirm: () => void;
};

export function MintConfirmPanel({
  isPending = false,
  item,
  onClose,
  onConfirm,
  open,
}: MintConfirmPanelProps) {
  if (!open || !item) {
    return null;
  }

  const imageUrl = item.thumbnailUrl ?? item.imageUrl ?? item.avatarUrl;

  function handleClose() {
    if (!isPending) {
      onClose();
    }
  }

  return (
    <div
      className="upgrade-panel mint-confirm-panel growth-panel--liquid-glass"
      role="presentation"
    >
      <button
        aria-label="关闭 Mint 确认面板"
        className="upgrade-panel__backdrop"
        disabled={isPending}
        onClick={handleClose}
        type="button"
      />
      <section
        aria-labelledby="mint-confirm-panel-title"
        aria-modal="true"
        className="upgrade-panel__panel"
        role="dialog"
      >
        <header className="upgrade-panel__header">
          <div>
            <span>NFT Mint</span>
            <h2 id="mint-confirm-panel-title">{item.name}</h2>
          </div>
          <button
            aria-label="关闭"
            disabled={isPending}
            onClick={handleClose}
            type="button"
          >
            <X aria-hidden="true" size={18} strokeWidth={2.5} />
          </button>
        </header>

        <div className="upgrade-panel__body" aria-live="polite">
          <section className="upgrade-panel__item" aria-label="当前藏品">
            <div className="upgrade-panel__thumb">
              {imageUrl ? (
                <img src={imageUrl} alt={item.name} />
              ) : (
                <span aria-hidden="true">{item.name.slice(0, 1)}</span>
              )}
            </div>
            <div>
              <strong>{item.name}</strong>
              <span>
                Lv.{formatCurrencyAmount(item.level)} ·{" "}
                {item.form?.displayName ?? "未分配形态"}
              </span>
            </div>
          </section>

          <section
            className="upgrade-panel__metrics mint-confirm-panel__metrics"
            aria-label="Mint 信息"
          >
            <MintMetric
              label="藏品状态"
              value={getCollectionStatusLabel(item.status)}
            />
            <MintMetric
              label="Mint 状态"
              value={getMintStatusLabel(item.nftMintStatus)}
            />
            <MintMetric label="稀有度" value={item.rarity.label} />
            <MintMetric label="战力" value={formatCurrencyAmount(item.power)} />
          </section>

          <section
            className="mint-confirm-panel__notice"
            aria-label="Mint 提醒"
          >
            <ShieldCheck aria-hidden="true" size={16} strokeWidth={2.4} />
            <div>
              <strong>确认后会请求服务端加入 Mint 队列</strong>
              <span>
                藏品锁定、队列状态和链上结果都以后端返回为准，前端只展示结果。
              </span>
            </div>
          </section>
        </div>

        <footer className="upgrade-panel__footer">
          <button disabled={isPending} onClick={onConfirm} type="button">
            {isPending ? (
              <RefreshCw
                aria-hidden="true"
                className="upgrade-panel__spin"
                size={16}
                strokeWidth={2.5}
              />
            ) : (
              <BadgeCheck aria-hidden="true" size={16} strokeWidth={2.5} />
            )}
            {isPending ? "提交中" : "确认 Mint"}
          </button>
        </footer>
      </section>
    </div>
  );
}

function MintMetric({ label, value }: { label: string; value: string }) {
  return (
    <div className="upgrade-panel__metric">
      <span>
        <BadgeCheck aria-hidden="true" size={14} strokeWidth={2.5} />
        {label}
      </span>
      <strong>{value}</strong>
    </div>
  );
}
