import "@testing-library/jest-dom/vitest";

import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import type {
  WalletMintQueueItem,
  WalletMintQueueStatus,
  WalletMintQueueSummary,
} from "../wallet.types";

import { MintQueueSheet } from "./MintQueueSheet";

describe("MintQueueSheet", () => {
  it("renders the fifth-stage Mint worker status copy", () => {
    render(
      <MintQueueSheet
        open
        items={[
          makeMintQueueItem("queued"),
          makeMintQueueItem("processing"),
          makeMintQueueItem("submitted"),
          makeMintQueueItem("confirming"),
          makeMintQueueItem("minted"),
          makeMintQueueItem("failed"),
          makeMintQueueItem("retrying"),
          makeMintQueueItem("manual_review"),
        ]}
        summary={makeSummary({
          queued: 1,
          processing: 1,
          submitted: 1,
          confirming: 1,
          minted: 1,
          failed: 1,
          retrying: 1,
          manualReview: 1,
        })}
        onClose={vi.fn()}
      />,
    );

    expect(screen.getByRole("dialog", { name: "Mint 队列" })).toBeVisible();
    expect(screen.getByText("排队中")).toBeVisible();
    expect(screen.getByText("处理中")).toBeVisible();
    expect(screen.getByText("已提交链上")).toBeVisible();
    expect(screen.getByText("等待确认")).toBeVisible();
    expect(screen.getByText("Mint 成功")).toBeVisible();
    expect(screen.getByText("Mint 失败")).toBeVisible();
    expect(screen.getByText("重试中")).toBeVisible();
    expect(screen.getByText("人工处理中")).toBeVisible();
    expect(screen.getByText("5")).toBeVisible();
    expect(screen.getByText("2")).toBeVisible();
  });

  it("refreshes Mint status through the provided mint-status query callback", () => {
    const onRefresh = vi.fn();

    render(
      <MintQueueSheet
        open
        items={[makeMintQueueItem("confirming")]}
        summary={makeSummary({ confirming: 1 })}
        onClose={vi.fn()}
        onRefresh={onRefresh}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "刷新状态" }));

    expect(onRefresh).toHaveBeenCalledTimes(1);
  });
});

function makeMintQueueItem(
  status: WalletMintQueueStatus,
): WalletMintQueueItem {
  return {
    mintQueueId: `mint-${status}`,
    itemInstanceId: `item-${status}`,
    status,
    chain: "MAINNET",
    collectionAddress: "EQcollection",
    itemAddress: status === "minted" ? "EQitem" : null,
    targetAddress: "EQtarget",
    transactionHash:
      status === "submitted" || status === "confirming" || status === "minted"
        ? `tx-${status}`
        : null,
    errorCode: null,
    errorMessage: status === "failed" ? "TON API 不可用。" : null,
    retryCount: status === "retrying" ? 1 : 0,
    createdAt: "2026-05-29T08:00:00.000Z",
    updatedAt: "2026-05-29T08:01:00.000Z",
    mintedAt: status === "minted" ? "2026-05-29T08:02:00.000Z" : null,
  };
}

function makeSummary(
  overrides: Partial<WalletMintQueueSummary>,
): WalletMintQueueSummary {
  return {
    queued: 0,
    processing: 0,
    submitted: 0,
    confirming: 0,
    retrying: 0,
    minted: 0,
    cancelled: 0,
    failed: 0,
    manualReview: 0,
    ...overrides,
  };
}
