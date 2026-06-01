export const CURRENCY_CODE = {
  KCOIN: "KCOIN",
  FGEMS: "FGEMS",
  STAR_DISPLAY: "STAR_DISPLAY",
} as const;

export type CurrencyCode = (typeof CURRENCY_CODE)[keyof typeof CURRENCY_CODE];

export const TOP_BAR_CURRENCY_CODES = [
  CURRENCY_CODE.KCOIN,
  CURRENCY_CODE.FGEMS,
] as const;
