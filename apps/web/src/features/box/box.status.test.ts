import { describe, expect, it } from "vitest";

import {
  getPaymentStatusMeta,
  isPaymentRetryAllowed,
  normalizePaymentStatus,
  shouldPollDrawResultStatus,
} from "./box.status";

describe("payment status labels", () => {
  it.each([
    ["pending_payment", "待支付", "等待支付"],
    ["created", "支付中", "支付订单已创建"],
    ["invoice_created", "支付中", "等待 Stars 支付"],
    ["precheckout_checked", "支付校验中", "Telegram 正在校验支付"],
    ["paid", "已支付", "支付已成功，等待发货"],
    ["paid_waiting_fulfillment", "已支付", "支付已成功，等待发货"],
    ["fulfilling", "发货中", "发货处理中"],
    ["fulfillment_failed_retrying", "补发中", "支付已成功，奖励补发中"],
    ["fulfilled", "已完成", "开盒完成"],
    ["cancelled", "已取消", "支付已取消"],
    ["failed", "失败", "支付或发货异常"],
    ["expired", "过期", "订单已过期"],
    ["refunded", "退款", "已退款"],
    ["disputed", "争议", "订单争议处理中"],
  ])("maps %s to %s", (status, label, title) => {
    expect(getPaymentStatusMeta(status)).toMatchObject({
      label,
      title,
    });
  });

  it.each([
    ["precheckout_ok", "precheckout_checked"],
    ["paid_waiting", "paid_waiting_fulfillment"],
    ["completed", "fulfilled"],
    ["opened", "fulfilled"],
    ["dev_paid", "fulfilled"],
  ])("keeps backward-compatible alias %s", (status, normalized) => {
    expect(normalizePaymentStatus(status)).toBe(normalized);
  });

  it("keeps an unknown status visible without treating it as success", () => {
    expect(getPaymentStatusMeta("manual_review")).toMatchObject({
      label: "支付中",
      title: "状态同步中",
      tone: "neutral",
      toastType: "info",
    });
  });

  it("only allows retry before payment is confirmed by the server", () => {
    expect(isPaymentRetryAllowed("pending_payment")).toBe(true);
    expect(isPaymentRetryAllowed("invoice_created")).toBe(true);
    expect(isPaymentRetryAllowed("paid")).toBe(false);
    expect(isPaymentRetryAllowed("fulfilling")).toBe(false);
    expect(isPaymentRetryAllowed("fulfillment_failed_retrying")).toBe(false);
    expect(isPaymentRetryAllowed("failed")).toBe(false);
  });

  it("polls only while result status can still advance", () => {
    expect(
      shouldPollDrawResultStatus({
        status: "pending",
        paymentStatus: "fulfilling",
        orderStatus: "processing",
      }),
    ).toBe(true);

    expect(
      shouldPollDrawResultStatus({
        status: "pending",
        paymentStatus: "fulfillment_failed_retrying",
        orderStatus: "failed",
      }),
    ).toBe(true);

    expect(
      shouldPollDrawResultStatus({
        status: "pending",
        paymentStatus: "failed",
        orderStatus: "failed",
      }),
    ).toBe(false);

    expect(
      shouldPollDrawResultStatus({
        status: "completed",
        paymentStatus: "fulfilled",
        orderStatus: "completed",
      }),
    ).toBe(false);
  });
});
