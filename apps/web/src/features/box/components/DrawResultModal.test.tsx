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
      screen.getByText("服务端正在生成抽卡结果、库存和账本记录。"),
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
      screen.getByText("发货事务异常，后台会重试补发；请不要重复支付。"),
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
    paidStars: 10,
    paymentOrderStatus: "fulfilling",
    paymentStatus: "fulfilling",
    quantity: 1,
    results: [],
    returnedKcoin: 100,
    serverTime: "2026-05-28T00:02:00.000Z",
    status: "pending",
    ...overrides,
  };
}
