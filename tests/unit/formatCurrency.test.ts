import { describe, expect, it } from "vitest";

import {
  formatCurrencyAmount,
  normalizeCurrencyAmount,
} from "../../apps/web/src/shared/lib/formatCurrency";

describe("formatCurrencyAmount", () => {
  it("formats integer balances with grouping", () => {
    expect(formatCurrencyAmount("1234567")).toBe("1,234,567");
    expect(formatCurrencyAmount(9876543.8)).toBe("9,876,543");
  });

  it("falls back to zero for invalid frontend-visible values", () => {
    expect(normalizeCurrencyAmount(null)).toBe("0");
    expect(normalizeCurrencyAmount("not-a-number")).toBe("0");
  });
});
