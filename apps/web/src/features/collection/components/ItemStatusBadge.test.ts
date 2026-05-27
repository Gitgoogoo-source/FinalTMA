import { describe, expect, it } from "vitest";

import { getMintStatusLabel } from "./ItemStatusBadge";

describe("getMintStatusLabel", () => {
  it.each([
    ["not_minted", "未 Mint"],
    ["queued", "Mint 排队中"],
    ["processing", "正在处理 Mint"],
    ["submitted", "交易已提交链上"],
    ["confirming", "等待链上确认"],
    ["minted", "Mint 成功"],
    ["failed", "Mint 失败"],
    ["retrying", "正在重试"],
    ["manual_review", "需要人工处理"],
    ["cancelled", "已取消"],
  ])("maps %s to %s", (status, label) => {
    expect(getMintStatusLabel(status)).toBe(label);
  });

  it("keeps unknown mint statuses visible", () => {
    expect(getMintStatusLabel("waiting_operator")).toBe("waiting_operator");
  });
});
