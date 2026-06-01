/**
 * 共享币种枚举与展示常量。
 *
 * 注意：
 * 1. 这里不负责真实余额计算。
 * 2. KCOIN / FGEMS 的真实增减必须以后端 RPC + economy.currency_ledger 为准。
 * 3. STAR_DISPLAY 仅用于展示 Telegram Stars 相关支付信息，不代表内部可随意扣减的用户余额。
 */

export const CURRENCY = {
  KCOIN: "KCOIN",
  FGEMS: "FGEMS",
  STAR_DISPLAY: "STAR_DISPLAY",
} as const;

export type CurrencyCode = (typeof CURRENCY)[keyof typeof CURRENCY];

export type CurrencyCategory =
  | "game_point"
  | "upgrade_material"
  | "external_payment_display";

export interface CurrencyMeta {
  code: CurrencyCode;
  displayNameCn: string;
  displayNameEn: string;
  shortName: string;
  symbol: string;
  iconKey: string;
  category: CurrencyCategory;
  precision: number;
  sortOrder: number;

  /**
   * 是否是平台内部账本币种。
   * true：需要写 economy.currency_ledger。
   * false：仅展示或外部支付来源，不作为内部可直接扣减余额。
   */
  isInternalLedgerCurrency: boolean;

  /**
   * 是否展示在顶部资产栏。
   */
  isTopBarVisible: boolean;

  /**
   * 是否可由游戏内行为发放。
   */
  canBeGrantedByGame: boolean;

  /**
   * 是否可由游戏内行为消耗。
   */
  canBeSpentByGame: boolean;

  /**
   * 是否来自外部支付系统。
   */
  isExternalPaymentCurrency: boolean;

  description: string;
}

export const CURRENCY_META = {
  [CURRENCY.KCOIN]: {
    code: CURRENCY.KCOIN,
    displayNameCn: "K-coin",
    displayNameEn: "K-coin",
    shortName: "K-coin",
    symbol: "★",
    iconKey: "currency-kcoin",
    category: "game_point",
    precision: 0,
    sortOrder: 10,
    isInternalLedgerCurrency: true,
    isTopBarVisible: true,
    canBeGrantedByGame: true,
    canBeSpentByGame: true,
    isExternalPaymentCurrency: false,
    description:
      "游戏内主要积分，用于市场购买藏品、合成进化、任务奖励、邀请奖励等。",
  },

  [CURRENCY.FGEMS]: {
    code: CURRENCY.FGEMS,
    displayNameCn: "Fgems",
    displayNameEn: "Fgems",
    shortName: "Fgems",
    symbol: "◆",
    iconKey: "currency-fgems",
    category: "upgrade_material",
    precision: 0,
    sortOrder: 20,
    isInternalLedgerCurrency: true,
    isTopBarVisible: true,
    canBeGrantedByGame: true,
    canBeSpentByGame: true,
    isExternalPaymentCurrency: false,
    description:
      "游戏内强化材料积分，主要用于藏品升级，也可由分解重复藏品获得。",
  },

  [CURRENCY.STAR_DISPLAY]: {
    code: CURRENCY.STAR_DISPLAY,
    displayNameCn: "Stars",
    displayNameEn: "Stars",
    shortName: "Stars",
    symbol: "✦",
    iconKey: "currency-stars",
    category: "external_payment_display",
    precision: 0,
    sortOrder: 30,
    isInternalLedgerCurrency: false,
    isTopBarVisible: false,
    canBeGrantedByGame: false,
    canBeSpentByGame: false,
    isExternalPaymentCurrency: true,
    description:
      "Telegram Stars 支付展示币种。真实扣款、支付状态、开盒发货必须以 Telegram 支付回调和后端订单为准，不作为顶部可用余额展示。",
  },
} as const satisfies Record<CurrencyCode, CurrencyMeta>;

export const CURRENCY_CODES = Object.values(CURRENCY) as CurrencyCode[];

export const INTERNAL_LEDGER_CURRENCY_CODES = CURRENCY_CODES.filter(
  (code) => CURRENCY_META[code].isInternalLedgerCurrency,
);

export const TOP_BAR_CURRENCY_CODES = CURRENCY_CODES.filter(
  (code) => CURRENCY_META[code].isTopBarVisible,
);

export function isCurrencyCode(value: unknown): value is CurrencyCode {
  return (
    typeof value === "string" &&
    (CURRENCY_CODES as readonly string[]).includes(value)
  );
}

export function assertCurrencyCode(
  value: unknown,
): asserts value is CurrencyCode {
  if (!isCurrencyCode(value)) {
    throw new Error(`Invalid currency code: ${String(value)}`);
  }
}

export function getCurrencyMeta(code: CurrencyCode): CurrencyMeta {
  return CURRENCY_META[code];
}

export function getCurrencyDisplayName(
  code: CurrencyCode,
  locale: "zh-CN" | "en-US" = "zh-CN",
): string {
  const meta = getCurrencyMeta(code);
  return locale === "en-US" ? meta.displayNameEn : meta.displayNameCn;
}

export function isInternalLedgerCurrency(code: CurrencyCode): boolean {
  return CURRENCY_META[code].isInternalLedgerCurrency;
}

export function isExternalPaymentCurrency(code: CurrencyCode): boolean {
  return CURRENCY_META[code].isExternalPaymentCurrency;
}
