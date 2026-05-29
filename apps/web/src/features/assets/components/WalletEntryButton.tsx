import {
  CheckCircle2,
  Loader2,
  ShieldAlert,
  ShieldCheck,
  Wallet,
} from "lucide-react";
import { useCallback, useMemo, useState } from "react";

import { useFeedback } from "@/app/providers/FeedbackProvider";
import { getApiErrorMessage } from "@/api/errors";
import { isFeatureEnabled } from "@/env";
import { MintQueueSheet } from "@/features/wallet/components/MintQueueSheet";
import { WalletStatusSheet } from "@/features/wallet/components/WalletStatusSheet";
import { useMintQueue } from "@/features/wallet/hooks/useMintQueue";
import { useSyncWalletNfts } from "@/features/wallet/hooks/useSyncWalletNfts";
import { useWalletConnect } from "@/features/wallet/hooks/useWalletConnect";
import { useWalletNfts } from "@/features/wallet/hooks/useWalletNfts";
import type { WalletConnectionStatus } from "@/features/wallet/wallet.types";

type WalletEntryButtonProps = {
  tonConnectEnabled?: boolean;
};

export function WalletEntryButton({
  tonConnectEnabled = isFeatureEnabled("TON_CONNECT"),
}: WalletEntryButtonProps) {
  if (!tonConnectEnabled) {
    return (
      <button
        className="wallet-entry-button"
        disabled
        title="钱包暂未开放"
        type="button"
      >
        <Wallet aria-hidden="true" size={16} strokeWidth={2.3} />
        <span>暂未开放</span>
      </button>
    );
  }

  return <EnabledWalletEntryButton />;
}

function EnabledWalletEntryButton() {
  const { pushToast } = useFeedback();
  const [isSheetOpen, setIsSheetOpen] = useState(false);
  const [isMintQueueOpen, setIsMintQueueOpen] = useState(false);
  const walletConnect = useWalletConnect();
  const syncWalletNfts = useSyncWalletNfts();
  const mintQueue = useMintQueue({
    enabled:
      (isSheetOpen || isMintQueueOpen) && walletConnect.status === "verified",
  });
  const walletNfts = useWalletNfts({
    enabled:
      (isSheetOpen || isMintQueueOpen) && walletConnect.status === "verified",
  });
  const shortAddress = useMemo(
    () => formatWalletAddress(walletConnect.address ?? ""),
    [walletConnect.address],
  );
  const buttonState = getWalletButtonState({
    isConnecting: walletConnect.isConnecting,
    isDisconnecting: walletConnect.isDisconnecting,
    isStatusLoading: walletConnect.isStatusLoading,
    isVerifying: walletConnect.isVerifying,
    shortAddress,
    status: walletConnect.status,
  });

  const handleConnect = useCallback(async () => {
    if (walletConnect.isConnecting) {
      return;
    }

    try {
      const result = await walletConnect.openWalletModal();

      if (!result.proofReady) {
        pushToast({
          type: "info",
          title: "钱包验证暂未准备",
          message: "仍可先连接钱包，verified 状态稍后以服务端 proof 为准。",
        });
      }
    } catch (error) {
      pushToast({
        type: "error",
        title: "钱包连接失败",
        message:
          error instanceof Error
            ? error.message
            : "请重新尝试，或检查 Telegram 内的钱包应用是否可用。",
      });
    }
  }, [pushToast, walletConnect]);

  const handleVerify = useCallback(async () => {
    try {
      const result = await walletConnect.verifyWallet();

      if (!result.proofReady) {
        pushToast({
          type: "info",
          title: "钱包验证暂未准备",
          message: "未拿到 proof challenge，请稍后重试验证钱包。",
        });
      }
    } catch (error) {
      pushToast({
        type: "error",
        title: "打开验证失败",
        message:
          error instanceof Error ? error.message : "请稍后重新发起钱包验证。",
      });
    }
  }, [pushToast, walletConnect]);

  const handleDisconnect = useCallback(async () => {
    try {
      await walletConnect.disconnectWallet();
      pushToast({
        type: "info",
        title: "钱包已断开",
        message: "TON Connect 已回到未连接状态。",
      });
    } catch (error) {
      pushToast({
        type: "error",
        title: "钱包已从本机断开",
        message:
          error instanceof Error
            ? `后端状态同步失败：${error.message}`
            : "后端状态同步失败，请稍后刷新。",
      });
    }
  }, [pushToast, walletConnect]);

  const handleSyncNfts = useCallback(async () => {
    try {
      await syncWalletNfts.mutateAsync();
      void walletNfts.refetch();
      pushToast({
        type: "success",
        title: "NFT 同步已提交",
        message: "同步结果会以服务端状态为准。",
      });
    } catch (error) {
      pushToast({
        type: "error",
        title: "NFT 同步失败",
        message: error instanceof Error ? error.message : "请稍后重试。",
      });
    }
  }, [pushToast, syncWalletNfts, walletNfts]);

  const handleCopyAddress = useCallback(
    async (address: string) => {
      await navigator.clipboard?.writeText(address);
      pushToast({
        type: "info",
        title: "地址已复制",
        message: "已复制公开钱包地址。",
      });
    },
    [pushToast],
  );

  const handleOpenMintQueue = useCallback(() => {
    setIsSheetOpen(false);
    setIsMintQueueOpen(true);
    void mintQueue.refetch();
  }, [mintQueue]);

  const handleRefreshStatus = useCallback(() => {
    void walletConnect.refetchStatus();
    void mintQueue.refetch();
    void walletNfts.refetch();
  }, [mintQueue, walletConnect, walletNfts]);

  const handleClick = useCallback(async () => {
    if (buttonState.disabled) {
      return;
    }

    if (walletConnect.isConnected) {
      setIsSheetOpen(true);
      return;
    }

    await handleConnect();
  }, [buttonState.disabled, handleConnect, walletConnect.isConnected]);

  return (
    <>
      <button
        aria-busy={buttonState.busy}
        className="wallet-entry-button"
        disabled={buttonState.disabled}
        onClick={() => void handleClick()}
        title={buttonState.title}
        type="button"
      >
        <buttonState.Icon aria-hidden="true" size={16} strokeWidth={2.3} />
        <span>{buttonState.label}</span>
        {buttonState.badge ? <span>{buttonState.badge}</span> : null}
      </button>

      <WalletStatusSheet
        errorMessage={walletConnect.errorMessage}
        isConnecting={walletConnect.isConnecting}
        isDisconnecting={walletConnect.isDisconnecting}
        isSyncing={syncWalletNfts.isPending}
        isVerifying={walletConnect.isVerifying}
        mintQueue={mintQueue.mintQueue ?? walletConnect.wallet.mintQueue}
        onClose={() => setIsSheetOpen(false)}
        onConnect={() => void handleConnect()}
        onCopyAddress={(address) => void handleCopyAddress(address)}
        onDisconnect={() => void handleDisconnect()}
        onOpenMintQueue={handleOpenMintQueue}
        onRefreshStatus={handleRefreshStatus}
        onSyncNfts={() => void handleSyncNfts()}
        onVerify={() => void handleVerify()}
        open={isSheetOpen}
        status={walletConnect.status}
        syncedNftCount={walletNfts.items.length}
        syncErrorMessage={
          syncWalletNfts.isError
            ? getApiErrorMessage(syncWalletNfts.error)
            : null
        }
        syncResult={syncWalletNfts.data ?? null}
        syncStatus={
          syncWalletNfts.data?.status ?? walletConnect.wallet.syncStatus
        }
        wallet={{
          address: walletConnect.wallet.address,
          lastSyncAt: walletConnect.wallet.lastSyncAt,
          network: walletConnect.wallet.network,
          verifiedAt: walletConnect.wallet.verifiedAt,
          walletAppName: walletConnect.wallet.walletAppName,
        }}
      />

      <MintQueueSheet
        open={isMintQueueOpen}
        items={mintQueue.items ?? []}
        summary={mintQueue.mintQueue ?? walletConnect.wallet.mintQueue}
        syncedNfts={walletNfts.items}
        loading={
          Boolean(mintQueue.isLoading) && (mintQueue.items?.length ?? 0) === 0
        }
        nftLoading={Boolean(walletNfts.isLoading)}
        errorMessage={
          mintQueue.isError ? getApiErrorMessage(mintQueue.error) : null
        }
        onClose={() => setIsMintQueueOpen(false)}
        onRefresh={() => void mintQueue.refetch()}
      />
    </>
  );
}

type WalletButtonStateInput = {
  isConnecting: boolean;
  isDisconnecting: boolean;
  isStatusLoading: boolean;
  isVerifying: boolean;
  shortAddress: string;
  status: WalletConnectionStatus;
};

function getWalletButtonState(options: WalletButtonStateInput) {
  const isBusy =
    options.isConnecting ||
    options.isDisconnecting ||
    options.isVerifying ||
    options.isStatusLoading;

  if (options.isConnecting || options.status === "connecting") {
    return {
      badge: null,
      busy: true,
      disabled: true,
      Icon: Loader2,
      label: "loading",
      title: "正在恢复或打开 TON Connect",
    };
  }

  if (options.isDisconnecting) {
    return {
      badge: null,
      busy: true,
      disabled: true,
      Icon: Loader2,
      label: "断开中",
      title: "正在断开钱包",
    };
  }

  if (options.isVerifying) {
    return {
      badge: null,
      busy: true,
      disabled: true,
      Icon: Loader2,
      label: "验证中",
      title: "正在验证钱包",
    };
  }

  if (options.status === "verified") {
    return {
      badge: "verified",
      busy: isBusy,
      disabled: false,
      Icon: CheckCircle2,
      label: options.shortAddress,
      title: "钱包已验证",
    };
  }

  if (
    options.status === "invalid_proof" ||
    options.status === "expired_proof"
  ) {
    return {
      badge: "重试",
      busy: isBusy,
      disabled: false,
      Icon: ShieldAlert,
      label: options.shortAddress || "验证失败",
      title:
        options.status === "expired_proof" ? "钱包验证已过期" : "钱包验证失败",
    };
  }

  if (options.status === "connected_unverified") {
    return {
      badge: "验证钱包",
      busy: isBusy,
      disabled: false,
      Icon: ShieldCheck,
      label: options.shortAddress,
      title: "钱包已连接，等待后端 proof 验证",
    };
  }

  return {
    badge: null,
    busy: isBusy,
    disabled: false,
    Icon: Wallet,
    label: "Connect Wallet",
    title: "连接 TON 钱包",
  };
}

function formatWalletAddress(address: string): string {
  if (!address) {
    return "";
  }

  if (address.length <= 12) {
    return address;
  }

  return `${address.slice(0, 4)}...${address.slice(-4)}`;
}
