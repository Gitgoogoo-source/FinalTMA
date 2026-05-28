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
import type { WalletConnectionStatus } from "@/features/wallet/wallet.types";

import { WalletEntryButton } from "./WalletEntryButton";

const walletConnectMock = vi.hoisted(() => ({
  disconnectWallet: vi.fn(),
  openWalletModal: vi.fn(),
  refetchStatus: vi.fn(),
  verifyWallet: vi.fn(),
  state: {
    address: null as string | null,
    disconnectWallet: vi.fn(),
    errorMessage: null as string | null,
    isConnected: false,
    isConnecting: false,
    isConnectionRestored: true,
    isDisconnecting: false,
    isStatusLoading: false,
    isVerifying: false,
    openWalletModal: vi.fn(),
    refetchStatus: vi.fn(),
    status: "not_connected" as WalletConnectionStatus,
    verificationStatus: "unverified",
    verifyWallet: vi.fn(),
    wallet: {
      address: null as string | null,
      errorMessage: null as string | null,
      lastSyncAt: null as string | null,
      mintQueue: null,
      network: null as string | null,
      rawAddress: null as string | null,
      status: "not_connected" as WalletConnectionStatus,
      syncStatus: "idle",
      verifiedAt: null as string | null,
      walletAppName: null as string | null,
    },
  },
}));

const syncWalletNftsMock = vi.hoisted(() => ({
  mutateAsync: vi.fn(),
  state: {
    data: null,
    isPending: false,
    mutateAsync: vi.fn(),
  },
}));

const mintQueueMock = vi.hoisted(() => ({
  refetch: vi.fn(),
  state: {
    mintQueue: null,
    refetch: vi.fn(),
  },
}));

vi.mock("@/features/wallet/hooks/useWalletConnect", () => ({
  useWalletConnect: () => walletConnectMock.state,
}));

vi.mock("@/features/wallet/hooks/useSyncWalletNfts", () => ({
  useSyncWalletNfts: () => syncWalletNftsMock.state,
}));

vi.mock("@/features/wallet/hooks/useMintQueue", () => ({
  useMintQueue: () => mintQueueMock.state,
}));

describe("WalletEntryButton", () => {
  beforeEach(() => {
    walletConnectMock.disconnectWallet.mockReset();
    walletConnectMock.disconnectWallet.mockResolvedValue(undefined);
    walletConnectMock.openWalletModal.mockReset();
    walletConnectMock.openWalletModal.mockResolvedValue({ proofReady: true });
    walletConnectMock.refetchStatus.mockReset();
    walletConnectMock.refetchStatus.mockResolvedValue(undefined);
    walletConnectMock.verifyWallet.mockReset();
    walletConnectMock.verifyWallet.mockResolvedValue({ proofReady: true });

    syncWalletNftsMock.mutateAsync.mockReset();
    syncWalletNftsMock.mutateAsync.mockResolvedValue({
      status: "queued",
      jobId: "job-1",
      lastSyncAt: null,
      message: null,
    });

    mintQueueMock.refetch.mockReset();
    mintQueueMock.refetch.mockResolvedValue({ data: null });

    walletConnectMock.state = createWalletConnectState();
    syncWalletNftsMock.state = {
      data: null,
      isPending: false,
      mutateAsync: syncWalletNftsMock.mutateAsync,
    };
    mintQueueMock.state = {
      mintQueue: null,
      refetch: mintQueueMock.refetch,
    };
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

  it("opens the TON Connect modal when wallet is not connected", () => {
    renderWalletEntry(true);

    fireEvent.click(screen.getByRole("button", { name: "Connect Wallet" }));

    expect(walletConnectMock.openWalletModal).toHaveBeenCalledTimes(1);
  });

  it("shows a stable notice when proof preparation is not ready", async () => {
    walletConnectMock.openWalletModal.mockResolvedValue({ proofReady: false });
    walletConnectMock.state = createWalletConnectState({
      openWalletModal: walletConnectMock.openWalletModal,
    });

    renderWalletEntry(true);

    fireEvent.click(screen.getByRole("button", { name: "Connect Wallet" }));

    await waitFor(() => {
      expect(screen.getByRole("status")).toHaveTextContent("钱包验证暂未准备");
    });
  });

  it("opens the wallet status sheet for a connected unverified wallet", () => {
    walletConnectMock.state = createWalletConnectState({
      address: "EQABCDEFGHIJKLMNOPQRSTUV1234567890abcdefghi",
      isConnected: true,
      status: "connected_unverified",
      wallet: {
        address: "EQABCDEFGHIJKLMNOPQRSTUV1234567890abcdefghi",
        rawAddress: "0:abcdef",
        network: "testnet",
        walletAppName: "Tonkeeper",
        verifiedAt: null,
        lastSyncAt: null,
        syncStatus: "idle",
        mintQueue: null,
        errorMessage: null,
        status: "connected_unverified",
      },
    });

    renderWalletEntry(true);

    fireEvent.click(
      screen.getByRole("button", { name: /EQAB...fghi.*验证钱包/ }),
    );

    expect(screen.getByRole("dialog", { name: "钱包状态" })).toBeVisible();
    expect(screen.getByText("钱包已连接，尚未验证")).toBeVisible();
    expect(screen.getByRole("button", { name: "验证钱包" })).toBeEnabled();
  });

  it("uses backend verified status instead of marking the wallet locally", () => {
    walletConnectMock.state = createWalletConnectState({
      address: "EQABCDEFGHIJKLMNOPQRSTUV1234567890abcdefghi",
      isConnected: true,
      status: "verified",
      wallet: {
        address: "EQABCDEFGHIJKLMNOPQRSTUV1234567890abcdefghi",
        rawAddress: "0:abcdef",
        network: "mainnet",
        walletAppName: "Tonkeeper",
        verifiedAt: "2026-05-28T10:00:00.000Z",
        lastSyncAt: null,
        syncStatus: "idle",
        mintQueue: null,
        errorMessage: null,
        status: "verified",
      },
    });

    renderWalletEntry(true);

    expect(
      screen.getByRole("button", { name: /EQAB...fghi.*verified/ }),
    ).toHaveAttribute("title", "钱包已验证");
  });

  it("can trigger wallet verification from the status sheet", async () => {
    walletConnectMock.state = createWalletConnectState({
      address: "EQABCDEFGHIJKLMNOPQRSTUV1234567890abcdefghi",
      isConnected: true,
      status: "connected_unverified",
      wallet: {
        address: "EQABCDEFGHIJKLMNOPQRSTUV1234567890abcdefghi",
        rawAddress: "0:abcdef",
        network: "testnet",
        walletAppName: "Tonkeeper",
        verifiedAt: null,
        lastSyncAt: null,
        syncStatus: "idle",
        mintQueue: null,
        errorMessage: null,
        status: "connected_unverified",
      },
    });

    renderWalletEntry(true);

    fireEvent.click(
      screen.getByRole("button", { name: /EQAB...fghi.*验证钱包/ }),
    );
    fireEvent.click(screen.getByRole("button", { name: "验证钱包" }));

    await waitFor(() => {
      expect(walletConnectMock.verifyWallet).toHaveBeenCalledTimes(1);
    });
  });

  it("disconnects from the status sheet", async () => {
    walletConnectMock.state = createWalletConnectState({
      address: "EQABCDEFGHIJKLMNOPQRSTUV1234567890abcdefghi",
      disconnectWallet: walletConnectMock.disconnectWallet,
      isConnected: true,
      status: "connected_unverified",
      wallet: {
        address: "EQABCDEFGHIJKLMNOPQRSTUV1234567890abcdefghi",
        rawAddress: "0:abcdef",
        network: "testnet",
        walletAppName: "Tonkeeper",
        verifiedAt: null,
        lastSyncAt: null,
        syncStatus: "idle",
        mintQueue: null,
        errorMessage: null,
        status: "connected_unverified",
      },
    });

    renderWalletEntry(true);

    fireEvent.click(
      screen.getByRole("button", { name: /EQAB...fghi.*验证钱包/ }),
    );
    fireEvent.click(screen.getByRole("button", { name: "断开" }));

    await waitFor(() => {
      expect(walletConnectMock.disconnectWallet).toHaveBeenCalledTimes(1);
    });
    expect(screen.getByRole("status")).toHaveTextContent("钱包已断开");
  });

  it("shows loading while TON Connect restores the wallet session", () => {
    walletConnectMock.state = createWalletConnectState({
      isConnecting: true,
      status: "connecting",
    });

    renderWalletEntry(true);

    expect(screen.getByRole("button", { name: "loading" })).toBeDisabled();
  });
});

function renderWalletEntry(tonConnectEnabled: boolean) {
  return render(
    <FeedbackProvider>
      <WalletEntryButton tonConnectEnabled={tonConnectEnabled} />
    </FeedbackProvider>,
  );
}

function createWalletConnectState(
  overrides: Partial<typeof walletConnectMock.state> = {},
): typeof walletConnectMock.state {
  const wallet = {
    address: null,
    errorMessage: null,
    lastSyncAt: null,
    mintQueue: null,
    network: null,
    rawAddress: null,
    status: "not_connected" as WalletConnectionStatus,
    syncStatus: "idle",
    verifiedAt: null,
    walletAppName: null,
    ...overrides.wallet,
  };

  return {
    address: null,
    disconnectWallet: walletConnectMock.disconnectWallet,
    errorMessage: null,
    isConnected: false,
    isConnecting: false,
    isConnectionRestored: true,
    isDisconnecting: false,
    isStatusLoading: false,
    isVerifying: false,
    openWalletModal: walletConnectMock.openWalletModal,
    refetchStatus: walletConnectMock.refetchStatus,
    status: "not_connected",
    verificationStatus: "unverified",
    verifyWallet: walletConnectMock.verifyWallet,
    wallet,
    ...overrides,
  };
}
