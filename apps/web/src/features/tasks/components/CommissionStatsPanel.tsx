import { useState } from "react";
import { HandCoins, Loader2, X } from "lucide-react";

import { formatCurrencyAmount } from "@/shared/lib/formatCurrency";

import type { CommissionHistory, CommissionStats } from "../tasks.types";

type CommissionStatsPanelProps = {
  history: CommissionHistory | null;
  isPending: boolean;
  stats: CommissionStats | null;
  onClaim: () => void;
};

export function CommissionStatsPanel({
  history,
  isPending,
  onClaim,
  stats,
}: CommissionStatsPanelProps) {
  const [confirmOpen, setConfirmOpen] = useState(false);
  const pendingAmount = stats?.pendingAmountKcoin ?? 0;
  const pendingCount = stats?.pendingCount ?? 0;
  const canClaim = pendingAmount > 0 && pendingCount > 0 && !isPending;

  function handleConfirm() {
    onClaim();
    setConfirmOpen(false);
  }

  return (
    <section className="commission-panel" aria-labelledby="commission-title">
      <header className="commission-panel__header">
        <div>
          <span>邀请分红</span>
          <h2 id="commission-title">待领取分红</h2>
        </div>
        <button
          disabled={!canClaim}
          onClick={() => setConfirmOpen(true)}
          type="button"
        >
          {isPending ? (
            <Loader2 aria-hidden="true" size={15} strokeWidth={2.5} />
          ) : (
            <HandCoins aria-hidden="true" size={15} strokeWidth={2.5} />
          )}
          {isPending ? "领取中" : "领取"}
        </button>
      </header>

      <dl className="commission-panel__stats">
        <div>
          <dt>待领取</dt>
          <dd>{formatCurrencyAmount(pendingAmount)} KCOIN</dd>
        </div>
        <div>
          <dt>已领取</dt>
          <dd>{formatCurrencyAmount(stats?.grantedAmountKcoin ?? 0)} KCOIN</dd>
        </div>
      </dl>

      <div className="commission-panel__history">
        {(history?.items ?? []).slice(0, 3).map((item) => (
          <article key={item.commissionId}>
            <span>
              {item.inviteeDisplayName ?? item.inviteeUsername ?? "好友"}
            </span>
            <strong>
              +{formatCurrencyAmount(item.commissionAmountKcoin)} KCOIN
            </strong>
            <em>{getCommissionStatusLabel(item.status)}</em>
          </article>
        ))}
        {history?.items.length === 0 ? <span>暂无分红明细</span> : null}
      </div>

      <ConfirmCommissionDialog
        amountKcoin={pendingAmount}
        count={pendingCount}
        onClose={() => setConfirmOpen(false)}
        onConfirm={handleConfirm}
        open={confirmOpen}
      />
    </section>
  );
}

type ConfirmCommissionDialogProps = {
  amountKcoin: number;
  count: number;
  open: boolean;
  onClose: () => void;
  onConfirm: () => void;
};

function ConfirmCommissionDialog({
  amountKcoin,
  count,
  onClose,
  onConfirm,
  open,
}: ConfirmCommissionDialogProps) {
  if (!open) {
    return null;
  }

  return (
    <div className="commission-confirm-dialog" role="presentation">
      <button
        aria-label="关闭领取确认"
        className="commission-confirm-dialog__backdrop"
        onClick={onClose}
        type="button"
      />
      <section
        aria-labelledby="commission-confirm-title"
        aria-modal="true"
        className="commission-confirm-dialog__panel"
        role="dialog"
      >
        <header className="commission-confirm-dialog__header">
          <div>
            <span>领取确认</span>
            <h2 id="commission-confirm-title">领取待结算分红</h2>
          </div>
          <button aria-label="关闭" onClick={onClose} type="button">
            <X aria-hidden="true" size={18} strokeWidth={2.5} />
          </button>
        </header>
        <div className="commission-confirm-dialog__body">
          <strong>{formatCurrencyAmount(amountKcoin)} KCOIN</strong>
          <span>{count} 笔待领取记录</span>
        </div>
        <footer className="commission-confirm-dialog__actions">
          <button onClick={onClose} type="button">
            取消
          </button>
          <button onClick={onConfirm} type="button">
            确认领取
          </button>
        </footer>
      </section>
    </div>
  );
}

function getCommissionStatusLabel(status: string): string {
  switch (status) {
    case "pending":
      return "待领取";
    case "granted":
      return "已领取";
    case "reversed":
      return "已撤销";
    default:
      return "处理中";
  }
}
