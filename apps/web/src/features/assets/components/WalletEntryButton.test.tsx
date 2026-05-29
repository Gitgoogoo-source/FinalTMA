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
import type {
  WalletConnectionStatus,
  WalletMintQueueItem,
  WalletMintQueueSummary,
  WalletSyncResult,
} from "@/features/wallet/wallet.types";

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
      mintQueue: null as WalletMintQueueSummary | null,
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
    data: null as WalletSyncResult | null,
    error: null as unknown,
    isError: false,
    isPending: false,
    mutateAsync: vi.fn(),
  },
}));

const mintQueueMock = vi.hoisted(() => ({
  refetch: vi.fn(),
  state: {
    error: null as unknown,
    isError: false,
    isFetching: false,
    isLoading: false,
    items: [] as WalletMintQueueItem[],
    mintQueue: null as WalletMintQueueSummary | null,
    nextCursor: null as string | null,
    refetch: vi.fn(),
    serverTime: null as string | null,
  },
}));

const walletNftsMock = vi.hoisted(() => ({
  refetch: vi.fn(),
  state: {
    error: null as unknown,
    isError: false,
    isLoading: false,
    items: [],
    nextCursor: null as string | null,
    refetch: vi.fn(),
    serverTime: null as string | null,
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

vi.mock("@/features/wallet/hooks/useWalletNfts", () => ({
  useWalletNfts: () => walletNftsMock.state,
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
      syncedCount: 0,
      linkedCount: 0,
      ignoredCount: 0,
    });

    mintQueueMock.refetch.mockReset();
    mintQueueMock.refetch.mockResolvedValue({ data: null });
    walletNftsMock.refetch.mockReset();
    walletNftsMock.refetch.mockResolvedValue({ data: null });

    walletConnectMock.state = createWalletConnectState();
    syncWalletNftsMock.state = {
      data: null,
      error: null,
      isError: false,
      isPending: false,
      mutateAsync: syncWalletNftsMock.mutateAsync,
    };
    mintQueueMock.state = {
      error: null,
      isError: false,
      isFetching: false,
      isLoading: false,
      items: [],
      mintQueue: null,
      nextCursor: null,
      refetch: mintQueueMock.refetch,
      serverTime: null,
    };
    walletNftsMock.state = {
      error: null,
      isError: false,
      isLoading: false,
      items: [],
      nextCursor: null,
      refetch: walletNftsMock.refetch,
      serverTime: null,
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

  it("keeps the entry unconnected when the user cancels wallet connection", async () => {
    walletConnectMock.openWalletModal.mockResolvedValue({ proofReady: true });
    walletConnectMock.state = createWalletConnectState({
      openWalletModal: walletConnectMock.openWalletModal,
    });

    renderWalletEntry(true);

    fireEvent.click(screen.getByRole("button", { name: "Connect Wallet" }));

    await waitFor(() => {
      expect(walletConnectMock.openWalletModal).toHaveBeenCalledTimes(1);
    });
    expect(
      screen.getByRole("button", { name: "Connect Wallet" }),
    ).toBeVisible();
    expect(
      screen.queryByRole("dialog", { name: "钱包状态" }),
    ).not.toBeInTheDocument();
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

  it("restores verified wallet UI from backend status after refresh", () => {
    walletConnectMock.state = createWalletConnectState({
      address: "EQBACKENDRESTOREDWALLET1234567890abcdefghi",
      isConnected: true,
      status: "verified",
      wallet: {
        address: "EQBACKENDRESTOREDWALLET1234567890abcdefghi",
        rawAddress: "0:backend",
        network: "mainnet",
        walletAppName: "Tonkeeper",
        verifiedAt: "2026-05-28T10:00:00.000Z",
        lastSyncAt: "2026-05-28T11:00:00.000Z",
        syncStatus: "success",
        mintQueue: {
          queued: 1,
          processing: 0,
          failed: 0,
          manualReview: 0,
        },
        errorMessage: null,
        status: "verified",
      },
    });

    renderWalletEntry(true);

    fireEvent.click(
      screen.getByRole("button", { name: /EQBA...fghi.*verified/ }),
    );

    expect(screen.getByRole("dialog", { name: "钱包状态" })).toBeVisible();
    expect(screen.getByText("钱包验证已通过")).toBeVisible();
    expect(screen.getByText("Tonkeeper")).toBeVisible();
    expect(screen.getByText("已同步")).toBeVisible();
    expect(screen.getByText("1 个进行中")).toBeVisible();
  });

  it("opens the Mint queue sheet from a verified wallet status sheet", () => {
    walletConnectMock.state = createWalletConnectState({
      address: "EQBACKENDRESTOREDWALLET1234567890abcdefghi",
      isConnected: true,
      status: "verified",
      wallet: {
        address: "EQBACKENDRESTOREDWALLET1234567890abcdefghi",
        rawAddress: "0:backend",
        network: "mainnet",
        walletAppName: "Tonkeeper",
        verifiedAt: "2026-05-28T10:00:00.000Z",
        lastSyncAt: "2026-05-28T11:00:00.000Z",
        syncStatus: "success",
        mintQueue: {
          queued: 1,
          processing: 0,
          failed: 0,
          manualReview: 0,
        },
        errorMessage: null,
        status: "verified",
      },
    });
    mintQueueMock.state = {
      error: null,
      isError: false,
      isFetching: false,
      isLoading: false,
      items: [
        {
          chain: "MAINNET",
          collectionAddress:
            "EQAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAM9c",
          createdAt: "2026-05-29T08:00:00.000Z",
          errorCode: null,
          errorMessage: null,
          itemAddress: null,
          itemInstanceId: "66666666-6666-4666-8666-666666666666",
          mintedAt: null,
          mintQueueId: "77777777-7777-4777-8777-777777777777",
          retryCount: 0,
          status: "queued",
          targetAddress: "EQBACKENDRESTOREDWALLET1234567890abcdefghi",
          transactionHash: null,
          updatedAt: "2026-05-29T08:01:00.000Z",
        },
      ],
      mintQueue: {
        queued: 1,
        processing: 0,
        failed: 0,
        manualReview: 0,
      },
      nextCursor: null,
      refetch: mintQueueMock.refetch,
      serverTime: "2026-05-29T08:02:00.000Z",
    };

    renderWalletEntry(true);

    fireEvent.click(
      screen.getByRole("button", { name: /EQBA...fghi.*verified/ }),
    );
    fireEvent.click(screen.getByRole("button", { name: "Mint 队列" }));

    expect(mintQueueMock.refetch).toHaveBeenCalledTimes(1);
    expect(
      screen.queryByRole("dialog", { name: "钱包状态" }),
    ).not.toBeInTheDocument();
    expect(screen.getByRole("dialog", { name: "Mint 队列" })).toBeVisible();
    expect(screen.getByText("排队中")).toBeVisible();
  });

  it("triggers wallet NFT sync from the status sheet", async () => {
    walletConnectMock.state = createWalletConnectState({
      address: "EQBACKENDRESTOREDWALLET1234567890abcdefghi",
      isConnected: true,
      status: "verified",
      wallet: {
        address: "EQBACKENDRESTOREDWALLET1234567890abcdefghi",
        rawAddress: "0:backend",
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

    fireEvent.click(
      screen.getByRole("button", { name: /EQBA...fghi.*verified/ }),
    );
    fireEvent.click(screen.getByRole("button", { name: "同步 NFT" }));

    await waitFor(() => {
      expect(syncWalletNftsMock.mutateAsync).toHaveBeenCalledTimes(1);
    });
    expect(walletNftsMock.refetch).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("status")).toHaveTextContent("NFT 同步已提交");
  });

  it("shows the latest backend NFT sync counts in the status sheet", () => {
    walletConnectMock.state = createWalletConnectState({
      address: "EQBACKENDRESTOREDWALLET1234567890abcdefghi",
      isConnected: true,
      status: "verified",
      wallet: {
        address: "EQBACKENDRESTOREDWALLET1234567890abcdefghi",
        rawAddress: "0:backend",
        network: "mainnet",
        walletAppName: "Tonkeeper",
        verifiedAt: "2026-05-28T10:00:00.000Z",
        lastSyncAt: "2026-05-28T11:00:00.000Z",
        syncStatus: "success",
        mintQueue: null,
        errorMessage: null,
        status: "verified",
      },
    });
    syncWalletNftsMock.state = {
      data: {
        status: "success",
        jobId: "job-1",
        lastSyncAt: "2026-05-29T08:00:00.000Z",
        message: "钱包 NFT 同步完成。",
        syncedCount: 2,
        linkedCount: 1,
        ignoredCount: 3,
      },
      error: null,
      isError: false,
      isPending: false,
      mutateAsync: syncWalletNftsMock.mutateAsync,
    };

    renderWalletEntry(true);

    fireEvent.click(
      screen.getByRole("button", { name: /EQBA...fghi.*verified/ }),
    );

    expect(screen.getByText("NFT 同步完成")).toBeVisible();
    expect(screen.getByText("钱包 NFT 同步完成。")).toBeVisible();
    expect(screen.getByText("游戏 NFT")).toBeVisible();
    expect(screen.getByText("2")).toBeVisible();
    expect(screen.getByText("已关联")).toBeVisible();
    expect(screen.getByText("1")).toBeVisible();
    expect(screen.getByText("已忽略")).toBeVisible();
    expect(screen.getByText("3")).toBeVisible();
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

  it("shows an invalid proof state with a retry action", () => {
    walletConnectMock.state = createWalletConnectState({
      address: "EQABCDEFGHIJKLMNOPQRSTUV1234567890abcdefghi",
      errorMessage: "钱包 proof 校验失败。",
      isConnected: true,
      status: "invalid_proof",
      wallet: {
        address: "EQABCDEFGHIJKLMNOPQRSTUV1234567890abcdefghi",
        rawAddress: "0:abcdef",
        network: "testnet",
        walletAppName: "Tonkeeper",
        verifiedAt: null,
        lastSyncAt: null,
        syncStatus: "idle",
        mintQueue: null,
        errorMessage: "钱包 proof 校验失败。",
        status: "invalid_proof",
      },
    });

    renderWalletEntry(true);

    fireEvent.click(screen.getByRole("button", { name: /EQAB...fghi.*重试/ }));

    expect(screen.getByText("钱包 proof 未通过")).toBeVisible();
    expect(screen.getByText("钱包 proof 校验失败。")).toBeVisible();
    expect(screen.getByRole("button", { name: "验证钱包" })).toBeEnabled();
  });

  it("shows an expired proof state with a retry action", () => {
    walletConnectMock.state = createWalletConnectState({
      address: "EQABCDEFGHIJKLMNOPQRSTUV1234567890abcdefghi",
      errorMessage: "钱包 proof 已过期，请重新连接钱包。",
      isConnected: true,
      status: "expired_proof",
      wallet: {
        address: "EQABCDEFGHIJKLMNOPQRSTUV1234567890abcdefghi",
        rawAddress: "0:abcdef",
        network: "testnet",
        walletAppName: "Tonkeeper",
        verifiedAt: null,
        lastSyncAt: null,
        syncStatus: "idle",
        mintQueue: null,
        errorMessage: "钱包 proof 已过期，请重新连接钱包。",
        status: "expired_proof",
      },
    });

    renderWalletEntry(true);

    fireEvent.click(screen.getByRole("button", { name: /EQAB...fghi.*重试/ }));

    expect(screen.getByText("钱包 proof 已过期")).toBeVisible();
    expect(
      screen.getByText("钱包 proof 已过期，请重新连接钱包。"),
    ).toBeVisible();
    expect(screen.getByRole("button", { name: "验证钱包" })).toBeEnabled();
  });

  it("can refresh backend wallet status from the status sheet", () => {
    walletConnectMock.state = createWalletConnectState({
      address: "EQABCDEFGHIJKLMNOPQRSTUV1234567890abcdefghi",
      isConnected: true,
      refetchStatus: walletConnectMock.refetchStatus,
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

    fireEvent.click(
      screen.getByRole("button", { name: /EQAB...fghi.*verified/ }),
    );
    fireEvent.click(screen.getByRole("button", { name: "刷新状态" }));

    expect(walletConnectMock.refetchStatus).toHaveBeenCalledTimes(1);
    expect(mintQueueMock.refetch).toHaveBeenCalledTimes(1);
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

  it("returns to the unconnected UI after disconnect state refreshes", async () => {
    const { rerender } = renderWalletEntry(true);

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
    rerender(
      <FeedbackProvider>
        <WalletEntryButton tonConnectEnabled />
      </FeedbackProvider>,
    );

    fireEvent.click(
      screen.getByRole("button", { name: /EQAB...fghi.*验证钱包/ }),
    );
    fireEvent.click(screen.getByRole("button", { name: "断开" }));

    await waitFor(() => {
      expect(walletConnectMock.disconnectWallet).toHaveBeenCalledTimes(1);
    });

    walletConnectMock.state = createWalletConnectState({
      status: "not_connected",
    });
    rerender(
      <FeedbackProvider>
        <WalletEntryButton tonConnectEnabled />
      </FeedbackProvider>,
    );

    expect(
      screen.getAllByRole("button", { name: "Connect Wallet" })[0]!,
    ).toBeVisible();
    expect(screen.getByText("尚未连接钱包")).toBeVisible();
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
    mintQueue: null as WalletMintQueueSummary | null,
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
