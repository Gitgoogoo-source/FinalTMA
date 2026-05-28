import "@testing-library/jest-dom/vitest";

import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import type { CreateOpenOrderResponse } from "../box.types";

import { PaymentPendingSheet } from "./PaymentPendingSheet";

describe("PaymentPendingSheet", () => {
  it("renders the fifth-stage fulfillment status copy", () => {
    renderPaymentSheet({
      paymentStatus: "fulfilling",
    });

    expect(screen.getByRole("dialog", { name: "发货处理中" })).toBeVisible();
    expect(screen.getAllByText("发货中")).toHaveLength(2);
    expect(
      screen.getByText("服务端正在生成抽卡结果、库存和账本记录。"),
    ).toBeVisible();
  });

  it("shows payment validation copy for pre-checkout status", () => {
    const { rerender } = renderPaymentSheet({
      paymentStatus: "precheckout_checked",
    });

    expect(
      screen.getByRole("dialog", { name: "Telegram 正在校验支付" }),
    ).toBeVisible();
    expect(screen.getAllByText("支付校验中")).toHaveLength(2);
    expect(
      screen.getByText(
        "支付校验中，服务端已确认订单可支付，正在等待最终支付成功回调。",
      ),
    ).toBeVisible();

    rerender(
      <PaymentPendingSheet
        open
        order={createOrder({ paymentStatus: "precheckout_ok" })}
        onCheckResult={vi.fn()}
        onClose={vi.fn()}
      />,
    );

    expect(screen.getAllByText("支付校验中")).toHaveLength(2);
  });

  it("does not treat refund and dispute states as completed", () => {
    const { rerender } = renderPaymentSheet({
      paymentStatus: "refunded",
    });

    expect(screen.getByRole("dialog", { name: "已退款" })).toBeVisible();
    expect(screen.getAllByText("退款")).toHaveLength(2);

    rerender(
      <PaymentPendingSheet
        open
        order={createOrder({ paymentStatus: "disputed" })}
        onCheckResult={vi.fn()}
        onClose={vi.fn()}
      />,
    );

    expect(
      screen.getByRole("dialog", { name: "订单争议处理中" }),
    ).toBeVisible();
    expect(screen.getAllByText("争议")).toHaveLength(2);
  });

  it("uses the status action label when checking the result", () => {
    const onCheckResult = vi.fn();
    renderPaymentSheet(
      {
        paymentStatus: "fulfilled",
      },
      onCheckResult,
    );

    fireEvent.click(screen.getByRole("button", { name: "查看开盒结果" }));

    expect(onCheckResult).toHaveBeenCalledTimes(1);
  });

  it("prefers normalized payment order status over stale draw order status", () => {
    renderPaymentSheet({
      orderStatus: "invoice_created",
      paymentOrderStatus: "paid",
      paymentStatus: "invoice_created",
    });

    expect(
      screen.getByRole("dialog", { name: "支付已成功，等待发货" }),
    ).toBeVisible();
    expect(screen.getAllByText("已支付")).toHaveLength(2);
  });

  it("shows compensation copy for paid orders with failed fulfillment", () => {
    renderPaymentSheet({
      paidAt: "2026-05-28T00:02:00.000Z",
      paymentOrderStatus: "failed",
      paymentStatus: "fulfillment_failed_retrying",
    });

    expect(
      screen.getByRole("dialog", { name: "支付已成功，奖励补发中" }),
    ).toBeVisible();
    expect(screen.getAllByText("补发中")).toHaveLength(2);
    expect(
      screen.getByText("发货事务异常，后台会重试补发；请不要重复支付。"),
    ).toBeVisible();
  });

  it("shows retry copy when the Telegram invoice did not open", () => {
    const onRetryPayment = vi.fn();

    render(
      <PaymentPendingSheet
        open
        order={createOrder()}
        invoiceOpenNotice={{
          status: "not_opened",
          detail: "当前环境不能打开 Telegram Stars invoice。",
        }}
        onCheckResult={vi.fn()}
        onRetryPayment={onRetryPayment}
        onClose={vi.fn()}
      />,
    );

    expect(screen.getByText("支付未打开，可重试支付")).toBeVisible();
    expect(
      screen.getByText("当前环境不能打开 Telegram Stars invoice。"),
    ).toBeVisible();

    fireEvent.click(screen.getByRole("button", { name: "重试支付" }));

    expect(onRetryPayment).toHaveBeenCalledTimes(1);
  });

  it("does not offer payment retry after the server confirms fulfillment", () => {
    const onRetryPayment = vi.fn();

    render(
      <PaymentPendingSheet
        open
        order={createOrder({ paymentStatus: "fulfilling" })}
        invoiceOpenNotice={{
          status: "cancelled",
          detail: "Telegram 支付窗口已关闭。",
        }}
        onCheckResult={vi.fn()}
        onRetryPayment={onRetryPayment}
        onClose={vi.fn()}
      />,
    );

    expect(screen.getByRole("dialog", { name: "发货处理中" })).toBeVisible();
    expect(
      screen.queryByRole("button", { name: "重试支付" }),
    ).not.toBeInTheDocument();
  });
});

function renderPaymentSheet(
  overrides: Partial<CreateOpenOrderResponse> = {},
  onCheckResult = vi.fn(),
) {
  return render(
    <PaymentPendingSheet
      open
      order={createOrder(overrides)}
      onCheckResult={onCheckResult}
      onClose={vi.fn()}
    />,
  );
}

function createOrder(
  overrides: Partial<CreateOpenOrderResponse> = {},
): CreateOpenOrderResponse {
  const order: CreateOpenOrderResponse = {
    devPaymentProcessed: false,
    drawCount: 1,
    expiresAt: "2026-05-28T00:15:00.000Z",
    idempotent: false,
    invoiceLink: "https://t.me/invoice/test-open-order",
    invoiceOpenMode: "web_app_open_invoice",
    invoicePayload: "invoice-payload",
    orderId: "11111111-1111-4111-8111-111111111111",
    orderStatus: "created",
    paymentOrderStatus: "invoice_created",
    paymentStatus: "invoice_created",
    resultReady: false,
    starOrderId: "22222222-2222-4222-8222-222222222222",
    xtrAmount: 100,
    ...overrides,
  };

  if (overrides.paymentStatus && !overrides.paymentOrderStatus) {
    order.paymentOrderStatus = overrides.paymentStatus;
  }

  return order;
}
