export type TopAssetCurrencyCode = "KCOIN" | "FGEMS";

export type AssetBalance = {
  currencyCode: TopAssetCurrencyCode;
  available: string;
  locked: string;
};

export type AssetBalanceMap = {
  KCOIN: AssetBalance;
  FGEMS: AssetBalance;
};

export type AssetSummary = {
  kcoin: AssetBalance;
  fgems: AssetBalance;
};

export type AssetProfile = {
  id: string | null;
  telegramUserId: string | null;
  username: string | null;
  firstName: string | null;
  lastName: string | null;
  displayName: string;
  avatarUrl: string | null;
};

export type WalletEntryState = {
  status: "placeholder";
  label: "Connect Wallet";
};

export type MyAssets = {
  userId: string | null;
  profile: AssetProfile;
  balances: AssetBalanceMap;
  assets: AssetSummary;
  wallet: WalletEntryState;
  updatedAt: string | null;
};

export type AssetProfileSource = {
  id?: string | null;
  telegramUserId?: string | null;
  username?: string | null;
  firstName?: string | null;
  lastName?: string | null;
  displayName?: string | null;
  avatarUrl?: string | null;
};

export type KcoinTopupAmount = number;

export type CreateKcoinTopupOrderInput = {
  amount: KcoinTopupAmount;
  intent?: "MANUAL_TOPUP" | "OPEN_BOX";
  boxSlug?: string | null;
  drawCount?: 1 | 10 | null;
};

export type CreateKcoinTopupOrderResponse = {
  orderId: string;
  topupOrderId: string;
  starOrderId: string | null;
  invoicePayload: string | null;
  invoiceLink: string | null;
  invoiceOpenMode: string | null;
  xtrAmount: number;
  kcoinAmount: number;
  orderStatus: string;
  paymentStatus: string;
  paymentOrderStatus: string;
  expiresAt: string | null;
  paidAt: string | null;
  fulfilledAt: string | null;
  idempotent: boolean;
};

export type KcoinTopupPaymentStatus =
  | "created"
  | "precheckout_checked"
  | "paid"
  | "fulfilling"
  | "fulfilled"
  | "failed"
  | "refunded"
  | "disputed"
  | "expired";

export type KcoinTopupStatusResponse = {
  orderId: string;
  topupOrderId: string;
  starOrderId: string | null;
  status: KcoinTopupPaymentStatus;
  paymentOrderStatus: KcoinTopupPaymentStatus;
  xtrAmount: number;
  kcoinAmount: number;
  paidAt: string | null;
  fulfilledAt: string | null;
  topupOrder: {
    id: string;
    status: string;
    paymentOrderStatus: KcoinTopupPaymentStatus;
    xtrAmount: number;
    kcoinAmount: number;
    paidAt: string | null;
    fulfilledAt: string | null;
    createdAt: string | null;
    updatedAt: string | null;
    hasError: boolean;
  };
  starOrder: {
    id: string;
    status: string;
    paymentOrderStatus: KcoinTopupPaymentStatus;
    xtrAmount: number;
    expiresAt: string | null;
    precheckoutAt: string | null;
    paidAt: string | null;
    fulfilledAt: string | null;
    createdAt: string | null;
    updatedAt: string | null;
    hasError: boolean;
  } | null;
  payment: {
    recorded: boolean;
    status: KcoinTopupPaymentStatus;
    currency: string;
    xtrAmount: number;
    paidAt: string | null;
    createdAt: string | null;
  };
  fulfillment: {
    status: KcoinTopupPaymentStatus;
    credited: boolean;
    completedAt: string | null;
    failed: boolean;
    retryable: boolean;
  };
  serverTime: string | null;
};
