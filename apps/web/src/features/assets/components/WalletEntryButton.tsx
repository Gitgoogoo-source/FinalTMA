import { Wallet } from "lucide-react";

import { useFeedback } from "@/app/providers/FeedbackProvider";

export function WalletEntryButton() {
  const { pushToast } = useFeedback();

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
