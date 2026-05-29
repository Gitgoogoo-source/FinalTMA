import "@testing-library/jest-dom/vitest";

import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import type { WalletSyncResult } from "../wallet.types";
import { WalletSyncPanel } from "./WalletSyncPanel";

describe("WalletSyncPanel", () => {
  it("renders successful sync counts from the backend response", () => {
    render(
      <WalletSyncPanel
        lastSyncAt="2026-05-29T08:00:00.000Z"
        result={makeSyncResult({
          ignoredCount: 3,
          linkedCount: 1,
          syncedCount: 2,
        })}
        status="success"
      />,
    );

    expect(screen.getByLabelText("NFT 同步状态")).toBeVisible();
    expect(screen.getByText("NFT 同步完成")).toBeVisible();
    expect(screen.getByText("钱包 NFT 同步完成。")).toBeVisible();
    expect(screen.getByText("游戏 NFT")).toBeVisible();
    expect(screen.getByText("2")).toBeVisible();
    expect(screen.getByText("已关联")).toBeVisible();
    expect(screen.getByText("1")).toBeVisible();
    expect(screen.getByText("已忽略")).toBeVisible();
    expect(screen.getByText("3")).toBeVisible();
  });

  it("shows a retry action for failed sync", () => {
    const onSync = vi.fn();

    render(
      <WalletSyncPanel
        errorMessage="TON API 暂不可用。"
        onSync={onSync}
        status="failed"
      />,
    );

    expect(screen.getByText("NFT 同步未完成")).toBeVisible();
    expect(screen.getByText("TON API 暂不可用。")).toBeVisible();

    fireEvent.click(screen.getByRole("button", { name: "重试同步" }));

    expect(onSync).toHaveBeenCalledTimes(1);
  });

  it("disables manual sync while syncing", () => {
    const onSync = vi.fn();

    render(<WalletSyncPanel loading onSync={onSync} status="idle" />);

    expect(screen.getByText("正在同步链上 NFT")).toBeVisible();
    expect(screen.getByRole("button", { name: "同步中" })).toBeDisabled();
  });
});

function makeSyncResult(
  overrides: Partial<WalletSyncResult> = {},
): WalletSyncResult {
  return {
    ignoredCount: 0,
    jobId: "wallet-sync-job-1",
    lastSyncAt: "2026-05-29T08:00:00.000Z",
    linkedCount: 0,
    message: "钱包 NFT 同步完成。",
    status: "success",
    syncedCount: 0,
    ...overrides,
  };
}
