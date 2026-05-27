import "@testing-library/jest-dom/vitest";

import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { FeedbackProvider } from "@/app/providers/FeedbackProvider";
import { useFeedbackStore } from "@/features/feedback/feedback.store";

import { WalletEntryButton } from "./WalletEntryButton";

describe("WalletEntryButton", () => {
  afterEach(() => {
    useFeedbackStore.getState().clearFeedback();
  });

  it("shows a disabled unavailable state when TON Connect is closed", () => {
    renderWalletEntry(false);

    const button = screen.getByRole("button", { name: "暂未开放" });

    expect(button).toBeDisabled();
    expect(button).toHaveAttribute("title", "钱包暂未开放");
  });

  it("keeps the existing wallet placeholder behavior when TON Connect is open", () => {
    renderWalletEntry(true);

    fireEvent.click(screen.getByRole("button", { name: "Connect Wallet" }));

    expect(screen.getByRole("status")).toHaveTextContent("钱包功能后续开放");
    expect(screen.getByRole("status")).toHaveTextContent(
      "第一阶段只保留入口占位，暂不接 TON Connect。",
    );
  });
});

function renderWalletEntry(tonConnectEnabled: boolean) {
  return render(
    <FeedbackProvider>
      <WalletEntryButton tonConnectEnabled={tonConnectEnabled} />
    </FeedbackProvider>,
  );
}
