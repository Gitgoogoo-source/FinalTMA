import { describe, expect, it } from "vitest";

import { getPaymentStatusMeta, normalizePaymentStatus } from "./box.status";

describe("payment status labels", () => {
  it.each([
    ["created", "支付中", "支付订单已创建"],
    ["invoice_created", "支付中", "等待 Stars 支付"],
    ["precheckout_checked", "支付校验中", "Telegram 正在校验支付"],
    ["paid", "已支付", "支付已成功"],
    ["fulfilling", "发货中", "发货处理中"],
    ["fulfilled", "已完成", "开盒完成"],
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
    ["pending_payment", "invoice_created"],
    ["precheckout_ok", "precheckout_checked"],
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
});
