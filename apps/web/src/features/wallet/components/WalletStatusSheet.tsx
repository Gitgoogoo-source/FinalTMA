import { useId } from "react";
import {
  AlertTriangle,
  Clock,
  Copy,
  Loader2,
  LogOut,
  RefreshCw,
  ShieldCheck,
  ShieldQuestion,
  Wallet,
  X,
} from "lucide-react";

import type {
  WalletSyncResult,
  WalletSyncStatus as WalletSyncStatusValue,
} from "../wallet.types";
import { WalletSyncPanel } from "./WalletSyncPanel";

export type WalletStatusSheetStatus =
  | "not_connected"
  | "connecting"
  | "connected_unverified"
  | "verified"
  | "invalid_proof"
  | "expired_proof"
  | "disconnected";

export type WalletSyncStatus = WalletSyncStatusValue;

export type WalletStatusSheetWallet = {
  address: string | null;
  network?: string | null;
  walletAppName?: string | null;
  verifiedAt?: string | null;
  lastSyncAt?: string | null;
};

export type WalletMintQueueSummary = {
  queued?: number;
  processing?: number;
  submitted?: number;
  confirming?: number;
  retrying?: number;
  minted?: number;
  cancelled?: number;
  failed?: number;
  manualReview?: number;
};

export type WalletStatusSheetProps = {
  open: boolean;
  status: WalletStatusSheetStatus;
  wallet?: WalletStatusSheetWallet | null;
  syncStatus?: WalletSyncStatus;
  syncResult?: WalletSyncResult | null | undefined;
  syncErrorMessage?: string | null | undefined;
  syncedNftCount?: number | undefined;
  mintQueue?: WalletMintQueueSummary | null;
  isConnecting?: boolean;
  isVerifying?: boolean;
  isDisconnecting?: boolean;
  isSyncing?: boolean;
  errorMessage?: string | null;
  onClose: () => void;
  onConnect?: () => void;
  onVerify?: () => void;
  onDisconnect?: () => void;
  onSyncNfts?: () => void;
  onOpenMintQueue?: () => void;
  onRefreshStatus?: () => void;
  onCopyAddress?: (address: string) => void | Promise<void>;
};

type WalletStatusTone =
  | "neutral"
  | "progress"
  | "success"
  | "warning"
  | "danger";

type WalletStatusMeta = {
  label: string;
  title: string;
  detail: string;
  tone: WalletStatusTone;
  Icon: typeof Wallet;
};

export function WalletStatusSheet({
  open,
  status,
  wallet = null,
  syncStatus = "idle",
  syncResult = null,
  syncErrorMessage = null,
  syncedNftCount = 0,
  mintQueue = null,
  isConnecting = false,
  isVerifying = false,
  isDisconnecting = false,
  isSyncing = false,
  errorMessage = null,
  onClose,
  onConnect,
  onVerify,
  onDisconnect,
  onSyncNfts,
  onOpenMintQueue,
  onRefreshStatus,
  onCopyAddress,
}: WalletStatusSheetProps) {
  const titleId = useId();

  if (!open) {
    return null;
  }

  const meta = getWalletStatusMeta(status, {
    isConnecting,
    isVerifying,
    errorMessage,
  });
  const address = wallet?.address?.trim() ?? "";
  const hasAddress = address.length > 0;
  const isVerified = status === "verified";
  const isConnected =
    status === "connected_unverified" ||
    status === "verified" ||
    status === "invalid_proof" ||
    status === "expired_proof";
  const canVerify =
    hasAddress &&
    (status === "connected_unverified" ||
      status === "invalid_proof" ||
      status === "expired_proof") &&
    Boolean(onVerify);
  const canOpenMintQueue = isVerified && Boolean(onOpenMintQueue);
  const StatusIcon = meta.Icon;

  async function handleCopyAddress() {
    if (!address) {
      return;
    }

    if (onCopyAddress) {
      await onCopyAddress(address);
      return;
    }

    await navigator.clipboard?.writeText(address);
  }

  return (
    <div className="wallet-status-sheet" role="presentation">
      <button
        aria-label="关闭钱包面板"
        className="wallet-status-sheet__backdrop"
        onClick={onClose}
        type="button"
      />
      <section
        aria-busy={isConnecting || isVerifying || isDisconnecting || isSyncing}
        aria-labelledby={titleId}
        aria-modal="true"
        className="wallet-status-sheet__panel"
        role="dialog"
      >
        <header className="wallet-status-sheet__header">
          <div>
            <span>TON Wallet</span>
            <h2 id={titleId}>钱包状态</h2>
          </div>
          <button aria-label="关闭" onClick={onClose} type="button">
            <X aria-hidden="true" size={18} strokeWidth={2.5} />
          </button>
        </header>

        <div className="wallet-status-sheet__body" aria-live="polite">
          <section
            className={`wallet-status-sheet__status wallet-status-sheet__status--${meta.tone}`}
          >
            <StatusIcon aria-hidden="true" size={28} strokeWidth={2.4} />
            <div>
              <span>{meta.label}</span>
              <strong>{meta.title}</strong>
              <p>{meta.detail}</p>
            </div>
          </section>

          {hasAddress ? (
            <dl className="wallet-status-sheet__details">
              <div>
                <dt>公开地址</dt>
                <dd>
                  <code>{formatWalletAddress(address)}</code>
                  <button
                    aria-label="复制钱包地址"
                    onClick={() => void handleCopyAddress()}
                    title="复制钱包地址"
                    type="button"
                  >
                    <Copy aria-hidden="true" size={14} strokeWidth={2.4} />
                  </button>
                </dd>
              </div>
              <DetailRow label="网络" value={wallet?.network ?? "TON"} />
              <DetailRow label="钱包 App" value={wallet?.walletAppName} />
              <DetailRow
                label="验证时间"
                value={
                  isVerified ? formatDateTime(wallet?.verifiedAt) : "未验证"
                }
              />
              <DetailRow
                label="上次同步"
                value={formatDateTime(wallet?.lastSyncAt)}
              />
            </dl>
          ) : (
            <div className="wallet-status-sheet__empty">
              <Wallet aria-hidden="true" size={22} strokeWidth={2.4} />
              <strong>尚未连接钱包</strong>
              <span>
                连接后只会在前端展示公开地址，verified 状态以服务端为准。
              </span>
            </div>
          )}

          <section className="wallet-status-sheet__actions">
            {!isConnected ? (
              <button
                className="wallet-status-sheet__primary-action"
                disabled={!onConnect || isConnecting}
                onClick={onConnect}
                type="button"
              >
                {isConnecting ? (
                  <Loader2 aria-hidden="true" size={15} strokeWidth={2.4} />
                ) : (
                  <Wallet aria-hidden="true" size={15} strokeWidth={2.4} />
                )}
                Connect Wallet
              </button>
            ) : null}

            {isConnected && status !== "verified" ? (
              <button
                className="wallet-status-sheet__primary-action"
                disabled={!canVerify || isVerifying}
                onClick={onVerify}
                type="button"
              >
                {isVerifying ? (
                  <Loader2 aria-hidden="true" size={15} strokeWidth={2.4} />
                ) : (
                  <ShieldQuestion
                    aria-hidden="true"
                    size={15}
                    strokeWidth={2.4}
                  />
                )}
                验证钱包
              </button>
            ) : null}

            <button
              className="wallet-status-sheet__secondary-action"
              disabled={!canOpenMintQueue}
              onClick={onOpenMintQueue}
              title={
                isVerified ? "查看 Mint 队列" : "验证钱包后可查看 Mint 队列"
              }
              type="button"
            >
              <Clock aria-hidden="true" size={15} strokeWidth={2.4} />
              Mint 队列
            </button>

            {isConnected ? (
              <button
                className="wallet-status-sheet__danger-action"
                disabled={!onDisconnect || isDisconnecting}
                onClick={onDisconnect}
                type="button"
              >
                {isDisconnecting ? (
                  <Loader2 aria-hidden="true" size={15} strokeWidth={2.4} />
                ) : (
                  <LogOut aria-hidden="true" size={15} strokeWidth={2.4} />
                )}
                断开
              </button>
            ) : null}

            {onRefreshStatus ? (
              <button
                className="wallet-status-sheet__secondary-action"
                onClick={onRefreshStatus}
                type="button"
              >
                <RefreshCw aria-hidden="true" size={15} strokeWidth={2.4} />
                刷新状态
              </button>
            ) : null}
          </section>

          <WalletSyncPanel
            disabled={!isVerified || !onSyncNfts}
            errorMessage={syncErrorMessage}
            lastSyncAt={wallet?.lastSyncAt}
            loading={isSyncing}
            onSync={onSyncNfts}
            result={syncResult}
            status={syncStatus}
            syncedNftCount={syncedNftCount}
          />

          <section className="wallet-status-sheet__summary wallet-status-sheet__summary--single">
            <StatusPill
              label="Mint 队列"
              tone={getMintQueueTone(mintQueue)}
              value={formatMintQueueSummary(mintQueue)}
            />
          </section>
        </div>
      </section>
    </div>
  );
}

function DetailRow({
  label,
  value,
}: {
  label: string;
  value?: string | null | undefined;
}) {
  return (
    <div>
      <dt>{label}</dt>
      <dd>{value && value.length > 0 ? value : "未提供"}</dd>
    </div>
  );
}

function StatusPill({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone: WalletStatusTone;
}) {
  return (
    <div
      className={`wallet-status-sheet__pill wallet-status-sheet__pill--${tone}`}
    >
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function getWalletStatusMeta(
  status: WalletStatusSheetStatus,
  options: {
    isConnecting: boolean;
    isVerifying: boolean;
    errorMessage: string | null;
  },
): WalletStatusMeta {
  if (options.isConnecting) {
    return {
      label: "连接中",
      title: "正在打开 TON Connect",
      detail: "请在钱包选择器中确认连接，取消后不会保存任何钱包状态。",
      tone: "progress",
      Icon: Loader2,
    };
  }

  if (options.isVerifying) {
    return {
      label: "验证中",
      title: "正在等待后端 proof 验证",
      detail: "前端不会直接标记 verified，验证结果以服务端返回为准。",
      tone: "progress",
      Icon: Loader2,
    };
  }

  switch (status) {
    case "not_connected":
      return {
        label: "未连接",
        title: "连接 TON 钱包",
        detail: "连接后可进行钱包 proof 验证、链上 NFT 同步和 Mint 状态查看。",
        tone: "neutral",
        Icon: Wallet,
      };
    case "connecting":
      return {
        label: "连接中",
        title: "正在连接钱包",
        detail: "请在 TON Connect 钱包选择器中继续操作。",
        tone: "progress",
        Icon: Loader2,
      };
    case "connected_unverified":
      return {
        label: "待验证",
        title: "钱包已连接，尚未验证",
        detail: "已读取公开地址，但必须完成后端 proof 验证后才能用于 Mint。",
        tone: "warning",
        Icon: ShieldQuestion,
      };
    case "verified":
      return {
        label: "已验证",
        title: "钱包验证已通过",
        detail: "服务端 proof 验证已通过，可用于 Mint 和链上 NFT 同步。",
        tone: "success",
        Icon: ShieldCheck,
      };
    case "invalid_proof":
      return {
        label: "验证失败",
        title: "钱包 proof 未通过",
        detail:
          options.errorMessage ??
          "签名、域名或地址校验失败，请重新发起钱包验证。",
        tone: "danger",
        Icon: AlertTriangle,
      };
    case "expired_proof":
      return {
        label: "验证过期",
        title: "钱包 proof 已过期",
        detail:
          options.errorMessage ??
          "challenge 或 proof 已过期，请重新生成并完成验证。",
        tone: "warning",
        Icon: AlertTriangle,
      };
    case "disconnected":
      return {
        label: "已断开",
        title: "钱包已断开",
        detail: "如需同步 NFT 或查看 Mint 队列，请重新连接并完成验证。",
        tone: "neutral",
        Icon: Wallet,
      };
  }
}

function formatWalletAddress(address: string): string {
  const normalized = address.trim();

  if (normalized.length <= 18) {
    return normalized;
  }

  return `${normalized.slice(0, 8)}...${normalized.slice(-6)}`;
}

function formatDateTime(value: string | null | undefined): string {
  if (!value) {
    return "未提供";
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

function formatMintQueueSummary(
  summary: WalletMintQueueSummary | null,
): string {
  if (!summary) {
    return "暂无队列";
  }

  const queued = summary.queued ?? 0;
  const processing = summary.processing ?? 0;
  const failed = summary.failed ?? 0;
  const manualReview = summary.manualReview ?? 0;
  const activeCount =
    queued +
    processing +
    (summary.submitted ?? 0) +
    (summary.confirming ?? 0) +
    (summary.retrying ?? 0);

  if (failed > 0 || manualReview > 0) {
    return `${failed + manualReview} 个需处理`;
  }

  if (activeCount > 0) {
    return `${activeCount} 个进行中`;
  }

  return "暂无队列";
}

function getMintQueueTone(
  summary: WalletMintQueueSummary | null,
): WalletStatusTone {
  if (!summary) {
    return "neutral";
  }

  if ((summary.failed ?? 0) > 0 || (summary.manualReview ?? 0) > 0) {
    return "warning";
  }

  if (
    (summary.queued ?? 0) > 0 ||
    (summary.processing ?? 0) > 0 ||
    (summary.submitted ?? 0) > 0 ||
    (summary.confirming ?? 0) > 0 ||
    (summary.retrying ?? 0) > 0
  ) {
    return "progress";
  }

  return "neutral";
}
