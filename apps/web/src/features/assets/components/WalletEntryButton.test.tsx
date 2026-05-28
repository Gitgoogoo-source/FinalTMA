import "@testing-library/jest-dom/vitest";

import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { FeedbackProvider } from "@/app/providers/FeedbackProvider";
import { useFeedbackStore } from "@/features/feedback/feedback.store";

import { WalletEntryButton } from "./WalletEntryButton";

const tonConnectMocks = vi.hoisted(() => ({
  address: "",
  disconnect: vi.fn(),
  isConnectionRestored: true,
  modalOpen: vi.fn(),
  modalState: { status: "closed" as "closed" | "opened" },
}));

vi.mock("@tonconnect/ui-react", () => ({
  useIsConnectionRestored: () => tonConnectMocks.isConnectionRestored,
  useTonAddress: () => tonConnectMocks.address,
  useTonConnectModal: () => ({
    open: tonConnectMocks.modalOpen,
    close: vi.fn(),
    state: tonConnectMocks.modalState,
  }),
  useTonConnectUI: () => [{ disconnect: tonConnectMocks.disconnect }],
}));

describe("WalletEntryButton", () => {
  beforeEach(() => {
    tonConnectMocks.address = "";
    tonConnectMocks.disconnect.mockReset();
    tonConnectMocks.disconnect.mockResolvedValue(undefined);
    tonConnectMocks.isConnectionRestored = true;
    tonConnectMocks.modalOpen.mockReset();
    tonConnectMocks.modalState = { status: "closed" };
  });

  afterEach(() => {
    cleanup();
    useFeedbackStore.getState().clearFeedback();
  });

  it("shows a disabled unavailable state when TON Connect is closed", () => {
    renderWalletEntry(false);

    const button = screen.getByRole("button", { name: "暂未开放" });

    expect(button).toBeDisabled();
    expect(button).toHaveAttribute("title", "钱包暂未开放");
  });

  it("opens the TON Connect modal when TON Connect is open", () => {
    renderWalletEntry(true);

    fireEvent.click(screen.getByRole("button", { name: "Connect Wallet" }));

    expect(tonConnectMocks.modalOpen).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });

  it("shows the connected address without marking the wallet verified", () => {
    tonConnectMocks.address = "EQABCDEFGHIJKLMNOPQRSTUV1234567890abcdefghi";

    renderWalletEntry(true);

    expect(
      screen.getByRole("button", { name: "EQAB...fghi未验证" }),
    ).toHaveAttribute("title", "钱包已连接，后端验证待接入");
  });

  it("disconnects an already connected TON wallet", async () => {
    tonConnectMocks.address = "EQABCDEFGHIJKLMNOPQRSTUV1234567890abcdefghi";

    renderWalletEntry(true);

    fireEvent.click(screen.getByRole("button", { name: "EQAB...fghi未验证" }));

    await waitFor(() => {
      expect(tonConnectMocks.disconnect).toHaveBeenCalledTimes(1);
    });

    expect(screen.getByRole("status")).toHaveTextContent("钱包已断开");
  });

  it("shows loading while TON Connect restores the wallet session", () => {
    tonConnectMocks.isConnectionRestored = false;

    renderWalletEntry(true);

    expect(screen.getByRole("button", { name: "loading" })).toBeDisabled();
  });

  it("shows loading while the wallet modal is open", () => {
    tonConnectMocks.modalState = { status: "opened" };

    renderWalletEntry(true);

    expect(screen.getByRole("button", { name: "连接中" })).toBeDisabled();
  });

  it("shows a stable error toast when disconnect fails", async () => {
    tonConnectMocks.address = "EQABCDEFGHIJKLMNOPQRSTUV1234567890abcdefghi";
    tonConnectMocks.disconnect.mockRejectedValue(new Error("disconnect failed"));

    renderWalletEntry(true);

    fireEvent.click(screen.getByRole("button", { name: "EQAB...fghi未验证" }));

    await waitFor(() => {
      expect(screen.getByRole("alert")).toHaveTextContent("断开钱包失败");
    });
    expect(screen.getByRole("alert")).toHaveTextContent(
      "请稍后重试，或在钱包 App 中断开连接。",
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
