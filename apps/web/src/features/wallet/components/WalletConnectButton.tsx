import {
  CheckCircle2,
  Loader2,
  ShieldAlert,
  ShieldCheck,
  Wallet,
} from "lucide-react";
import {
  useIsConnectionRestored,
  useTonAddress,
  useTonConnectModal,
  useTonConnectUI,
} from "@tonconnect/ui-react";
import { useCallback, useMemo, useState } from "react";

import { useFeedback } from "@/app/providers/FeedbackProvider";
import { isFeatureEnabled } from "@/env";

type WalletVerificationStatus =
  | "unverified"
  | "verified"
  | "invalid_proof"
  | "expired_proof";

type WalletConnectButtonProps = {
  className?: string | undefined;
  isVerifying?: boolean;
  onVerifyWallet?: (() => void | Promise<void>) | undefined;
  tonConnectEnabled?: boolean;
  verificationStatus?: WalletVerificationStatus;
};

type EnabledWalletConnectButtonProps = {
  className?: string | undefined;
  isVerifying: boolean;
  onVerifyWallet?: (() => void | Promise<void>) | undefined;
  verificationStatus: WalletVerificationStatus;
};

export function WalletConnectButton({
  className,
  isVerifying = false,
  onVerifyWallet,
  tonConnectEnabled = isFeatureEnabled("TON_CONNECT"),
  verificationStatus = "unverified",
}: WalletConnectButtonProps) {
  if (!tonConnectEnabled) {
    return (
      <button
        aria-label="暂未开放"
        className={getClassName(className)}
        disabled
        title="钱包暂未开放"
        type="button"
      >
        <Wallet aria-hidden="true" size={16} strokeWidth={2.3} />
        <span>暂未开放</span>
      </button>
    );
  }

  return (
    <EnabledWalletConnectButton
      className={className}
      isVerifying={isVerifying}
      onVerifyWallet={onVerifyWallet}
      verificationStatus={verificationStatus}
    />
  );
}

function EnabledWalletConnectButton({
  className,
  isVerifying,
  onVerifyWallet,
  verificationStatus,
}: EnabledWalletConnectButtonProps) {
  const { pushToast } = useFeedback();
  const [tonConnectUI] = useTonConnectUI();
  const modal = useTonConnectModal();
  const isConnectionRestored = useIsConnectionRestored();
  const address = useTonAddress();
  const [isOpening, setIsOpening] = useState(false);
  const [isHandlingVerify, setIsHandlingVerify] = useState(false);
  const shortAddress = useMemo(() => shortenAddress(address), [address]);
  const isModalOpen = modal.state?.status === "opened";
  const isBusy =
    !isConnectionRestored || isOpening || isModalOpen || isVerifying === true;
  const isVerifyBusy = isHandlingVerify || isVerifying === true;
  const buttonState = getButtonState({
    hasAddress: address.length > 0,
    isBusy,
    isConnectionRestored,
    isVerifyBusy,
    shortAddress,
    verificationStatus,
  });

  const openWalletModal = useCallback(async () => {
    setIsOpening(true);

    try {
      await tonConnectUI.openModal();
    } catch {
      pushToast({
        type: "error",
        title: "钱包连接失败",
        message: "请重新尝试，或检查 Telegram 内的钱包应用是否可用。",
      });
    } finally {
      setIsOpening(false);
    }
  }, [pushToast, tonConnectUI]);

  const handleVerifyWallet = useCallback(async () => {
    if (!onVerifyWallet) {
      await openWalletModal();
      return;
    }

    setIsHandlingVerify(true);

    try {
      await onVerifyWallet();
    } catch {
      pushToast({
        type: "error",
        title: "钱包验证失败",
        message: "请重新连接钱包后再试。",
      });
    } finally {
      setIsHandlingVerify(false);
    }
  }, [onVerifyWallet, openWalletModal, pushToast]);

  const handleClick = useCallback(async () => {
    if (buttonState.action === "verify") {
      await handleVerifyWallet();
      return;
    }

    await openWalletModal();
  }, [buttonState.action, handleVerifyWallet, openWalletModal]);

  return (
    <button
      aria-busy={buttonState.busy}
      aria-label={buttonState.ariaLabel}
      className={getClassName(className)}
      disabled={buttonState.disabled}
      onClick={() => void handleClick()}
      title={buttonState.title}
      type="button"
    >
      <buttonState.Icon aria-hidden="true" size={16} strokeWidth={2.3} />
      <span>{buttonState.label}</span>
    </button>
  );
}

function getButtonState(options: {
  hasAddress: boolean;
  isBusy: boolean;
  isConnectionRestored: boolean;
  isVerifyBusy: boolean;
  shortAddress: string;
  verificationStatus: WalletVerificationStatus;
}) {
  if (!options.isConnectionRestored) {
    return {
      action: "connect" as const,
      ariaLabel: "钱包状态加载中",
      busy: true,
      disabled: true,
      Icon: Loader2,
      label: "加载中",
      title: "正在恢复钱包连接",
    };
  }

  if (!options.hasAddress) {
    return {
      action: "connect" as const,
      ariaLabel: "Connect Wallet",
      busy: options.isBusy,
      disabled: options.isBusy,
      Icon: options.isBusy ? Loader2 : Wallet,
      label: options.isBusy ? "连接中" : "Connect Wallet",
      title: "连接 TON 钱包",
    };
  }

  if (options.verificationStatus === "verified") {
    return {
      action: "connect" as const,
      ariaLabel: `${options.shortAddress} 已验证`,
      busy: false,
      disabled: false,
      Icon: CheckCircle2,
      label: `${options.shortAddress} verified`,
      title: "钱包已验证",
    };
  }

  if (
    options.verificationStatus === "invalid_proof" ||
    options.verificationStatus === "expired_proof"
  ) {
    return {
      action: "verify" as const,
      ariaLabel: `${options.shortAddress} 验证失败，重试`,
      busy: options.isVerifyBusy,
      disabled: options.isVerifyBusy,
      Icon: options.isVerifyBusy ? Loader2 : ShieldAlert,
      label: options.isVerifyBusy ? "验证中" : "重试验证",
      title:
        options.verificationStatus === "expired_proof"
          ? "钱包验证已过期"
          : "钱包验证失败",
    };
  }

  return {
    action: "verify" as const,
    ariaLabel: `${options.shortAddress} 未验证，验证钱包`,
    busy: options.isVerifyBusy,
    disabled: options.isVerifyBusy,
    Icon: options.isVerifyBusy ? Loader2 : ShieldCheck,
    label: options.isVerifyBusy ? "验证中" : `${options.shortAddress} 验证钱包`,
    title: "钱包已连接，等待后端验证",
  };
}

function shortenAddress(address: string): string {
  if (address.length <= 12) {
    return address;
  }

  return `${address.slice(0, 4)}...${address.slice(-4)}`;
}

function getClassName(className: string | undefined): string {
  return ["wallet-entry-button", "wallet-connect-button", className]
    .filter(Boolean)
    .join(" ");
}
