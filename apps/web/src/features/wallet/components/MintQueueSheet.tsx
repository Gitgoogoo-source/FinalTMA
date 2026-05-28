import {
  AlertTriangle,
  CheckCircle2,
  Clock3,
  Loader2,
  RefreshCw,
  RotateCcw,
  Send,
  X,
} from "lucide-react";

import type {
  WalletMintQueueItem,
  WalletMintQueueSummary,
  WalletMintQueueStatus,
} from "../wallet.types";

type MintQueueSheetProps = {
  open: boolean;
  items: WalletMintQueueItem[];
  summary: WalletMintQueueSummary | null;
  loading?: boolean;
  errorMessage?: string | null;
  onClose: () => void;
  onRefresh?: () => void;
};

type MintStatusTone = "neutral" | "progress" | "success" | "warning" | "danger";

export function MintQueueSheet({
  open,
  items,
  summary,
  loading = false,
  errorMessage = null,
  onClose,
  onRefresh,
}: MintQueueSheetProps) {
  if (!open) {
    return null;
  }

  const activeCount = getActiveMintCount(summary);

  return (
    <div className="mint-queue-sheet" role="presentation">
      <button
        aria-label="关闭 Mint 队列"
        className="mint-queue-sheet__backdrop"
        onClick={onClose}
        type="button"
      />
      <section
        aria-busy={loading}
        aria-labelledby="mint-queue-title"
        aria-modal="true"
        className="mint-queue-sheet__panel"
        role="dialog"
      >
        <header className="mint-queue-sheet__header">
          <div>
            <span>NFT Mint</span>
            <h2 id="mint-queue-title">Mint 队列</h2>
          </div>
          <button aria-label="关闭" onClick={onClose} type="button">
            <X aria-hidden="true" size={18} strokeWidth={2.5} />
          </button>
        </header>

        <div className="mint-queue-sheet__body" aria-live="polite">
          <section className="mint-queue-sheet__summary">
            <SummaryPill label="进行中" tone="progress" value={activeCount} />
            <SummaryPill
              label="成功"
              tone="success"
              value={summary?.minted ?? 0}
            />
            <SummaryPill
              label="需处理"
              tone="warning"
              value={(summary?.failed ?? 0) + (summary?.manualReview ?? 0)}
            />
          </section>

          {loading ? (
            <div className="mint-queue-sheet__state" role="status">
              <Loader2 aria-hidden="true" size={22} strokeWidth={2.4} />
              <strong>队列同步中</strong>
              <span>正在读取服务端 Mint 状态。</span>
            </div>
          ) : null}

          {errorMessage ? (
            <div
              className="mint-queue-sheet__state mint-queue-sheet__state--danger"
              role="alert"
            >
              <AlertTriangle aria-hidden="true" size={22} strokeWidth={2.4} />
              <strong>队列读取失败</strong>
              <span>{errorMessage}</span>
            </div>
          ) : null}

          {!loading && !errorMessage && items.length === 0 ? (
            <div className="mint-queue-sheet__state">
              <Clock3 aria-hidden="true" size={22} strokeWidth={2.4} />
              <strong>暂无 Mint 队列</strong>
              <span>可 Mint 的藏品入队后会显示在这里。</span>
            </div>
          ) : null}

          {items.length > 0 ? (
            <ol className="mint-queue-sheet__list">
              {items.map((item) => (
                <MintQueueRow item={item} key={item.mintQueueId} />
              ))}
            </ol>
          ) : null}

          {onRefresh ? (
            <button
              className="mint-queue-sheet__refresh"
              disabled={loading}
              onClick={onRefresh}
              type="button"
            >
              <RefreshCw aria-hidden="true" size={15} strokeWidth={2.4} />
              刷新状态
            </button>
          ) : null}
        </div>
      </section>
    </div>
  );
}

function SummaryPill({
  label,
  tone,
  value,
}: {
  label: string;
  tone: MintStatusTone;
  value: number;
}) {
  return (
    <div className={`mint-queue-sheet__pill mint-queue-sheet__pill--${tone}`}>
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function MintQueueRow({ item }: { item: WalletMintQueueItem }) {
  const meta = getMintStatusMeta(item.status);
  const Icon = meta.Icon;

  return (
    <li className={`mint-queue-row mint-queue-row--${meta.tone}`}>
      <Icon aria-hidden="true" size={18} strokeWidth={2.4} />
      <div>
        <strong>{meta.label}</strong>
        <span>藏品 {formatShortId(item.itemInstanceId)}</span>
      </div>
      <dl>
        <div>
          <dt>网络</dt>
          <dd>{item.chain === "TESTNET" ? "testnet" : "mainnet"}</dd>
        </div>
        <div>
          <dt>交易</dt>
          <dd>{formatOptionalHash(item.transactionHash)}</dd>
        </div>
        <div>
          <dt>更新时间</dt>
          <dd>{formatDateTime(item.updatedAt)}</dd>
        </div>
      </dl>
      {item.errorMessage ? (
        <p className="mint-queue-row__error">{item.errorMessage}</p>
      ) : null}
    </li>
  );
}

function getMintStatusMeta(status: WalletMintQueueStatus): {
  label: string;
  tone: MintStatusTone;
  Icon: typeof Clock3;
} {
  switch (status) {
    case "queued":
      return { label: "排队中", tone: "progress", Icon: Clock3 };
    case "processing":
      return { label: "处理中", tone: "progress", Icon: Loader2 };
    case "submitted":
      return { label: "已提交链上", tone: "progress", Icon: Send };
    case "confirming":
      return { label: "等待确认", tone: "progress", Icon: Clock3 };
    case "retrying":
      return { label: "等待重试", tone: "warning", Icon: RotateCcw };
    case "manual_review":
      return { label: "人工处理", tone: "warning", Icon: AlertTriangle };
    case "minted":
      return { label: "Mint 成功", tone: "success", Icon: CheckCircle2 };
    case "failed":
      return { label: "Mint 失败", tone: "danger", Icon: AlertTriangle };
    case "cancelled":
      return { label: "已取消", tone: "neutral", Icon: X };
  }
}

function getActiveMintCount(summary: WalletMintQueueSummary | null): number {
  if (!summary) {
    return 0;
  }

  return (
    (summary.queued ?? 0) +
    (summary.processing ?? 0) +
    (summary.submitted ?? 0) +
    (summary.confirming ?? 0) +
    (summary.retrying ?? 0)
  );
}

function formatShortId(value: string): string {
  return value.length <= 10
    ? value
    : `${value.slice(0, 8)}...${value.slice(-4)}`;
}

function formatOptionalHash(value: string | null): string {
  if (!value) {
    return "待提交";
  }

  return value.length <= 12
    ? value
    : `${value.slice(0, 8)}...${value.slice(-4)}`;
}

function formatDateTime(value: string): string {
  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return value;
  }

  return date.toLocaleString("zh-CN", {
    hour12: false,
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}
