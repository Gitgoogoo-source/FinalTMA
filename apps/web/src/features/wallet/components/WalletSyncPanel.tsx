import {
  AlertTriangle,
  CheckCircle2,
  Clock3,
  Loader2,
  RefreshCw,
} from "lucide-react";

import type { WalletSyncResult, WalletSyncStatus } from "../wallet.types";

type WalletSyncPanelProps = {
  status: WalletSyncStatus;
  result?: WalletSyncResult | null | undefined;
  lastSyncAt?: string | null | undefined;
  syncedNftCount?: number | undefined;
  loading?: boolean | undefined;
  disabled?: boolean | undefined;
  errorMessage?: string | null | undefined;
  onSync?: (() => void) | undefined;
};

type WalletSyncTone = "neutral" | "progress" | "success" | "warning" | "danger";

type WalletSyncMeta = {
  label: string;
  title: string;
  detail: string;
  tone: WalletSyncTone;
  Icon: typeof Clock3;
};

export function WalletSyncPanel({
  status,
  result = null,
  lastSyncAt = null,
  syncedNftCount = 0,
  loading = false,
  disabled = false,
  errorMessage = null,
  onSync,
}: WalletSyncPanelProps) {
  const effectiveStatus = loading ? "syncing" : status;
  const meta = getWalletSyncMeta(effectiveStatus, {
    errorMessage,
    resultMessage: result?.message ?? null,
  });
  const Icon = meta.Icon;
  const lastSyncedAt = result?.lastSyncAt ?? lastSyncAt;
  const syncedCount = result?.syncedCount ?? syncedNftCount;
  const linkedCount = result?.linkedCount ?? 0;
  const ignoredCount = result?.ignoredCount ?? 0;
  const canSync = Boolean(onSync) && !loading && !disabled;

  return (
    <section
      aria-busy={loading}
      aria-label="NFT 同步状态"
      className={`wallet-sync-panel wallet-sync-panel--${meta.tone}`}
    >
      <div className="wallet-sync-panel__header">
        <Icon aria-hidden="true" size={22} strokeWidth={2.4} />
        <div>
          <span>{meta.label}</span>
          <strong>{meta.title}</strong>
          <p>{meta.detail}</p>
        </div>
      </div>

      <dl className="wallet-sync-panel__metrics">
        <Metric label="游戏 NFT" value={syncedCount} />
        <Metric label="已关联" value={linkedCount} />
        <Metric label="已忽略" value={ignoredCount} />
        <div>
          <dt>上次同步</dt>
          <dd>{formatDateTime(lastSyncedAt)}</dd>
        </div>
      </dl>

      <button
        className="wallet-sync-panel__action"
        disabled={!canSync}
        onClick={onSync}
        title={disabled ? "验证钱包后可同步 NFT" : "同步链上 NFT"}
        type="button"
      >
        {loading ? (
          <Loader2 aria-hidden="true" size={15} strokeWidth={2.4} />
        ) : (
          <RefreshCw aria-hidden="true" size={15} strokeWidth={2.4} />
        )}
        {getSyncActionLabel(effectiveStatus)}
      </button>
    </section>
  );
}

function Metric({ label, value }: { label: string; value: number }) {
  return (
    <div>
      <dt>{label}</dt>
      <dd>{value}</dd>
    </div>
  );
}

function getWalletSyncMeta(
  status: WalletSyncStatus,
  options: {
    errorMessage: string | null;
    resultMessage: string | null;
  },
): WalletSyncMeta {
  switch (status) {
    case "queued":
      return {
        label: "排队中",
        title: "NFT 同步已排队",
        detail:
          options.resultMessage ?? "服务端已接收同步请求，请稍后刷新状态。",
        tone: "progress",
        Icon: Clock3,
      };
    case "syncing":
      return {
        label: "同步中",
        title: "正在同步链上 NFT",
        detail: "正在通过后端查询 TON 链上数据，前端只展示同步结果。",
        tone: "progress",
        Icon: Loader2,
      };
    case "success":
      return {
        label: "已同步",
        title: "NFT 同步完成",
        detail: options.resultMessage ?? "已读取服务端保存的钱包 NFT 快照。",
        tone: "success",
        Icon: CheckCircle2,
      };
    case "failed":
      return {
        label: "同步失败",
        title: "NFT 同步未完成",
        detail: options.errorMessage ?? options.resultMessage ?? "请稍后重试。",
        tone: "danger",
        Icon: AlertTriangle,
      };
    case "disabled":
      return {
        label: "已暂停",
        title: "NFT 同步暂不可用",
        detail: "后端同步开关当前未开放，只能查看已有快照。",
        tone: "warning",
        Icon: AlertTriangle,
      };
    case "idle":
      return {
        label: "未同步",
        title: "尚未同步链上 NFT",
        detail: "完成 verified 钱包验证后，可手动触发一次服务端同步。",
        tone: "neutral",
        Icon: Clock3,
      };
  }
}

function getSyncActionLabel(status: WalletSyncStatus): string {
  switch (status) {
    case "syncing":
    case "queued":
      return "同步中";
    case "failed":
      return "重试同步";
    default:
      return "同步 NFT";
  }
}

function formatDateTime(value: string | null): string {
  if (!value) {
    return "未同步";
  }

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
