import {
  useIsConnectionRestored,
  useTonAddress,
  useTonConnectModal,
  useTonConnectUI,
} from "@tonconnect/ui-react";
import { Loader2, Wallet } from "lucide-react";
import { useCallback, useState } from "react";

import { useFeedback } from "@/app/providers/FeedbackProvider";
import { isFeatureEnabled } from "@/env";

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
  const modal = useTonConnectModal();
  const address = useTonAddress();
  const isConnectionRestored = useIsConnectionRestored();
  const [tonConnectUI] = useTonConnectUI();
  const { pushToast } = useFeedback();
  const [isDisconnecting, setIsDisconnecting] = useState(false);

  const isConnected = address.length > 0;
  const isModalOpen = modal.state.status === "opened";
  const isBusy = !isConnectionRestored || isModalOpen || isDisconnecting;
  const shortAddress = formatWalletAddress(address);
  const label = getWalletButtonLabel({
    isConnected,
    isDisconnecting,
    isModalOpen,
    isConnectionRestored,
    shortAddress,
  });

  const handleClick = useCallback(async () => {
    if (!isConnectionRestored || isDisconnecting) {
      return;
    }

    if (!isConnected) {
      modal.open();
      return;
    }

    setIsDisconnecting(true);

    try {
      await tonConnectUI.disconnect();
      pushToast({
        type: "info",
        title: "钱包已断开",
        message: "TON Connect 已回到未连接状态。",
      });
    } catch {
      pushToast({
        type: "error",
        title: "断开钱包失败",
        message: "请稍后重试，或在钱包 App 中断开连接。",
      });
    } finally {
      setIsDisconnecting(false);
    }
  }, [
    isConnected,
    isConnectionRestored,
    isDisconnecting,
    modal,
    pushToast,
    tonConnectUI,
  ]);

  return (
    <button
      aria-busy={isBusy}
      className="wallet-entry-button"
      disabled={!isConnectionRestored || isModalOpen || isDisconnecting}
      onClick={() => void handleClick()}
      title={isConnected ? "钱包已连接，后端验证待接入" : "连接 TON 钱包"}
      type="button"
    >
      {isBusy ? (
        <Loader2 aria-hidden="true" size={16} strokeWidth={2.3} />
      ) : (
        <Wallet aria-hidden="true" size={16} strokeWidth={2.3} />
      )}
      <span>{label}</span>
      {isConnected ? <span>未验证</span> : null}
    </button>
  );
}

type WalletButtonLabelInput = {
  isConnected: boolean;
  isDisconnecting: boolean;
  isModalOpen: boolean;
  isConnectionRestored: boolean;
  shortAddress: string;
};

function getWalletButtonLabel({
  isConnected,
  isDisconnecting,
  isModalOpen,
  isConnectionRestored,
  shortAddress,
}: WalletButtonLabelInput): string {
  if (!isConnectionRestored) {
    return "loading";
  }

  if (isDisconnecting) {
    return "断开中";
  }

  if (isConnected) {
    return shortAddress;
  }

  if (isModalOpen) {
    return "连接中";
  }

  return "Connect Wallet";
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
