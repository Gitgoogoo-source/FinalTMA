import "@testing-library/jest-dom/vitest";

import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import type { DrawResultResponse } from "../box.types";

import { DrawResultModal } from "./DrawResultModal";

describe("DrawResultModal", () => {
  it("shows fulfillment copy while a paid order is being fulfilled", () => {
    renderDrawResultModal({
      orderStatus: "processing",
      paymentStatus: "fulfilling",
    });

    expect(screen.getByText("支付已成功，发货处理中")).toBeVisible();
    expect(
      screen.getByText("服务端正在生成抽卡结果、藏品和账本记录。"),
    ).toBeVisible();
  });

  it("shows compensation copy when a paid order failed fulfillment", () => {
    const { rerender } = renderDrawResultModal({
      orderStatus: "failed",
      paidAt: "2026-05-28T00:01:00.000Z",
      paymentStatus: "failed",
    });

    expect(screen.getByText("支付已成功，奖励补发中")).toBeVisible();
    expect(
      screen.getByText("发货事务异常，系统会重试补发；请不要重复支付。"),
    ).toBeVisible();

    rerender(
      <DrawResultModal
        open
        result={createPendingResult({
          orderStatus: "failed",
          paidAt: "2026-05-28T00:01:00.000Z",
          paymentStatus: "fulfillment_failed_retrying",
        })}
        isLoading={false}
        isError={false}
        errorMessage={null}
        onRetry={vi.fn()}
        onClose={vi.fn()}
      />,
    );

    expect(screen.getByText("支付已成功，奖励补发中")).toBeVisible();
  });

  it("shows configured support contacts for failed paid fulfillment", () => {
    render(
      <DrawResultModal
        open
        result={createPendingResult({
          orderStatus: "failed",
          paidAt: "2026-05-28T00:01:00.000Z",
          paymentStatus: "failed",
        })}
        isLoading={false}
        isError={false}
        errorMessage={null}
        paymentSupport={{
          configured: true,
          supportEmail: "pay@example.test",
          supportUrl: "https://t.me/tma_support",
          serverTime: "2026-05-31T09:00:00.000Z",
        }}
        onRetry={vi.fn()}
        onClose={vi.fn()}
      />,
    );

    expect(screen.getByRole("link", { name: "联系客服" })).toHaveAttribute(
      "href",
      "https://t.me/tma_support",
    );
  });

  it("shows K-coin spend for completed K-coin draw results", () => {
    renderDrawResultModal({
      paymentProvider: "kcoin",
      paidKcoin: 10,
      paidStars: 0,
      results: [
        {
          description: null,
          drawIndex: 1,
          formId: null,
          formIndex: null,
          formName: null,
          imageUrl: null,
          isPityHit: false,
          itemInstanceId: "44444444-4444-4444-8444-444444444444",
          itemType: "character",
          level: 1,
          name: "测试藏品",
          power: 10,
          rarity: "COMMON",
          rarityLabel: "普通",
          rewardSource: "random",
          serialNumber: 1,
          subtitle: null,
          templateId: "55555555-5555-4555-8555-555555555555",
          templateSlug: "test-item",
          thumbnailUrl: null,
        },
      ],
      status: "completed",
    });

    expect(screen.getByText("10 K-coin")).toBeVisible();
    expect(screen.getAllByText("K-coin").length).toBeGreaterThan(0);
    expect(screen.queryByText(/返还/)).not.toBeInTheDocument();
    expect(screen.queryByText("10 Stars")).not.toBeInTheDocument();
  });
});

function renderDrawResultModal(overrides: Partial<DrawResultResponse> = {}) {
  return render(
    <DrawResultModal
      open
      result={createPendingResult(overrides)}
      isLoading={false}
      isError={false}
      errorMessage={null}
      onRetry={vi.fn()}
      onClose={vi.fn()}
    />,
  );
}

function createPendingResult(
  overrides: Partial<DrawResultResponse> = {},
): DrawResultResponse {
  return {
    balances: null,
    boxName: "测试盲盒",
    completedAt: null,
    invoicePayload: "invoice-payload",
    orderId: "11111111-1111-4111-8111-111111111111",
    orderStatus: "processing",
    paidAt: "2026-05-28T00:01:00.000Z",
    paidKcoin: 0,
    paidStars: 10,
    paymentProvider: "telegram_stars",
    paymentOrderStatus: "fulfilling",
    paymentStatus: "fulfilling",
    quantity: 1,
    results: [],
    returnedKcoin: 0,
    serverTime: "2026-05-28T00:02:00.000Z",
    status: "pending",
    ...overrides,
  };
}
