import { describe, expect, it } from "vitest";

import {
  ApiClientError,
  getApiErrorMessage,
  isApiErrorResponse,
  isApiSuccessResponse,
} from "../../apps/web/src/api/errors";

describe("stage-3 API feedback messages", () => {
  it.each([
    ["ITEM_NOT_OWNER", "不能操作不属于你的藏品。"],
    ["ITEM_NOT_AVAILABLE", "藏品当前不可操作。"],
    ["INSUFFICIENT_FGEMS", "FGEMS 余额不足。"],
    ["INSUFFICIENT_KCOIN", "KCOIN 余额不足。"],
    ["UPGRADE_RULE_NOT_FOUND", "升级配置缺失，请稍后重试。"],
    ["EVOLVE_RULE_NOT_FOUND", "合成配置缺失，请稍后重试。"],
    ["DECOMPOSE_REQUIRES_DUPLICATE", "只能分解重复藏品。"],
    ["MILESTONE_NOT_REACHED", "图鉴里程碑尚未达成。"],
    ["MILESTONE_VERSION_MISMATCH", "图鉴奖励配置已变更，请刷新后重试。"],
    ["LEADERBOARD_NOT_FOUND", "排行榜生成中，请稍后再试。"],
  ])("uses fixed copy for %s", (code, message) => {
    const error = new ApiClientError({
      code,
      message: "raw database detail should not be shown",
      status: 409,
    });

    expect(getApiErrorMessage(error)).toBe(message);
  });

  it("requires the standard success flag on API success responses", () => {
    expect(
      isApiSuccessResponse<{ value: number }>({
        ok: true,
        success: true,
        data: { value: 1 },
      }),
    ).toBe(true);

    expect(
      isApiSuccessResponse({
        ok: true,
        data: { value: 1 },
      }),
    ).toBe(false);
  });

  it("requires the standard success flag on API error responses", () => {
    expect(
      isApiErrorResponse({
        ok: false,
        success: false,
        error: {
          code: "VALIDATION_ERROR",
          message: "请求参数校验失败。",
        },
      }),
    ).toBe(true);

    expect(
      isApiErrorResponse({
        ok: false,
        error: {
          code: "VALIDATION_ERROR",
          message: "请求参数校验失败。",
        },
      }),
    ).toBe(false);
  });
});
