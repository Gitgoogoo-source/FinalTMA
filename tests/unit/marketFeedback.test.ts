import { describe, expect, it } from "vitest";

import {
  ApiClientError,
  getApiErrorMessage,
} from "../../apps/web/src/api/errors";

describe("market feedback messages", () => {
  it.each([
    ["KCOIN_NOT_ENOUGH", "余额不足。"],
    ["LISTING_PRICE_CHANGED", "价格已变化，请刷新后重试。"],
    ["LISTING_SOLD_OUT", "该商品已售罄。"],
    ["ITEM_ALREADY_LOCKED", "当前藏品已被锁定。"],
    ["CANNOT_BUY_OWN_LISTING", "不能购买自己的挂单。"],
  ])("uses fixed copy for %s", (code, message) => {
    const error = new ApiClientError({
      code,
      message: "raw database detail should not be shown",
      status: 409,
    });

    expect(getApiErrorMessage(error)).toBe(message);
  });
});
