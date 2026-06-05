import "@testing-library/jest-dom/vitest";

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { MyAssets } from "../assets.types";
import { AssetBar } from "./AssetBar";

type UseMyAssetsMockState = {
  assets: MyAssets["assets"];
  data: Pick<MyAssets, "updatedAt">;
  isError: boolean;
  isFetching: boolean;
  profile: MyAssets["profile"];
  refreshAssets: () => Promise<void>;
};

const mocks = vi.hoisted(() => ({
  openKcoinTopupSheet: vi.fn(),
  refreshAssets: vi.fn(),
  useMyAssetsState: {
    assets: {
      kcoin: { currencyCode: "KCOIN", available: "0", locked: "0" },
      fgems: { currencyCode: "FGEMS", available: "0", locked: "0" },
    },
    data: {
      updatedAt: null,
    },
    isError: false,
    isFetching: false,
    profile: {
      id: "11111111-1111-4111-8111-111111111111",
      telegramUserId: "7001",
      username: "tester",
      firstName: "Test",
      lastName: null,
      displayName: "测试玩家",
      avatarUrl: null,
    },
    refreshAssets: vi.fn(),
  } as UseMyAssetsMockState,
}));

vi.mock("../hooks/useMyAssets", () => ({
  useMyAssets: () => mocks.useMyAssetsState,
}));

vi.mock("./WalletEntryButton", () => ({
  WalletEntryButton: () => <button type="button">Connect Wallet</button>,
}));

vi.mock("./KcoinTopupProvider", () => ({
  useKcoinTopupSheet: () => ({
    openKcoinTopupSheet: mocks.openKcoinTopupSheet,
  }),
}));

describe("AssetBar", () => {
  beforeEach(() => {
    mocks.openKcoinTopupSheet.mockReset();
    mocks.refreshAssets.mockReset();
    mocks.refreshAssets.mockResolvedValue(undefined);
    mocks.useMyAssetsState = createMyAssetsState({
      refreshAssets: mocks.refreshAssets,
    });
  });

  afterEach(() => {
    cleanup();
  });

  it("does not present placeholder zero balances as truth after the first asset request fails", () => {
    mocks.useMyAssetsState = createMyAssetsState({
      isError: true,
      refreshAssets: mocks.refreshAssets,
    });

    render(<AssetBar />);

    expect(screen.getByLabelText("K-coin 余额，点击充值")).toHaveTextContent(
      "--",
    );
    expect(screen.getByLabelText("Fgems 余额")).toHaveTextContent("--");
    expect(
      screen.getByLabelText("K-coin 余额，点击充值"),
    ).not.toHaveTextContent("0");
    expect(screen.getByLabelText("Fgems 余额")).not.toHaveTextContent("0");
    expect(screen.getByRole("button", { name: "刷新" })).toBeVisible();
  });

  it("keeps the last trusted snapshot visible when a refresh fails", () => {
    mocks.useMyAssetsState = createMyAssetsState({
      assets: {
        kcoin: { currencyCode: "KCOIN", available: "1200", locked: "0" },
        fgems: { currencyCode: "FGEMS", available: "35", locked: "0" },
      },
      data: {
        updatedAt: "2026-06-02T00:00:00.000Z",
      },
      isError: true,
      refreshAssets: mocks.refreshAssets,
    });

    render(<AssetBar />);

    expect(screen.getByLabelText("K-coin 余额，点击充值")).toHaveTextContent(
      "1,200",
    );
    expect(screen.getByLabelText("Fgems 余额")).toHaveTextContent("35");
    expect(screen.getByRole("button", { name: "刷新" })).toBeVisible();
  });

  it("does not render the avatar status dot", () => {
    const { container } = render(<AssetBar />);

    expect(
      container.querySelector(".user-avatar__status"),
    ).not.toBeInTheDocument();
  });

  it("opens the K-coin topup sheet when the K-coin pill is clicked", () => {
    mocks.useMyAssetsState = createMyAssetsState({
      assets: {
        kcoin: { currencyCode: "KCOIN", available: "1200", locked: "0" },
        fgems: { currencyCode: "FGEMS", available: "35", locked: "0" },
      },
      data: {
        updatedAt: "2026-06-02T00:00:00.000Z",
      },
      refreshAssets: mocks.refreshAssets,
    });

    render(<AssetBar />);

    fireEvent.click(
      screen.getByRole("button", { name: "K-coin 余额，点击充值" }),
    );

    expect(mocks.openKcoinTopupSheet).toHaveBeenCalledTimes(1);
    expect(mocks.openKcoinTopupSheet).toHaveBeenCalledWith();
  });
});

function createMyAssetsState(
  overrides: Partial<{
    assets: MyAssets["assets"];
    data: Pick<MyAssets, "updatedAt">;
    isError: boolean;
    isFetching: boolean;
    refreshAssets: () => Promise<void>;
  }> = {},
): UseMyAssetsMockState {
  return {
    assets: overrides.assets ?? {
      kcoin: { currencyCode: "KCOIN", available: "0", locked: "0" },
      fgems: { currencyCode: "FGEMS", available: "0", locked: "0" },
    },
    data: overrides.data ?? {
      updatedAt: null,
    },
    isError: overrides.isError ?? false,
    isFetching: overrides.isFetching ?? false,
    profile: {
      id: "11111111-1111-4111-8111-111111111111",
      telegramUserId: "7001",
      username: "tester",
      firstName: "Test",
      lastName: null,
      displayName: "测试玩家",
      avatarUrl: null,
    },
    refreshAssets: overrides.refreshAssets ?? mocks.refreshAssets,
  };
}
