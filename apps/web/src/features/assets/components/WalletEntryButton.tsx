import { Wallet } from "lucide-react";

import { useFeedback } from "@/app/providers/FeedbackProvider";
import { isFeatureEnabled } from "@/env";

type WalletEntryButtonProps = {
  tonConnectEnabled?: boolean;
};

export function WalletEntryButton({
  tonConnectEnabled = isFeatureEnabled("TON_CONNECT"),
}: WalletEntryButtonProps) {
  const { pushToast } = useFeedback();

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

  return (
    <button
      className="wallet-entry-button"
      onClick={() =>
        pushToast({
          type: "info",
          title: "钱包功能后续开放",
          message: "第一阶段只保留入口占位，暂不接 TON Connect。",
        })
      }
      title="钱包功能后续开放"
      type="button"
    >
      <Wallet aria-hidden="true" size={16} strokeWidth={2.3} />
      <span>Connect Wallet</span>
    </button>
  );
}
