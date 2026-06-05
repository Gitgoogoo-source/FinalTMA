export type VipPlan = {
  id: string;
  code: string | null;
  displayName: string;
  priceXtr: number;
  durationDays: number | null;
  dailyFgems: number;
  dailyFreeBoxCount: number;
  feeRebateBps: number;
};

export type VipTodayStatus = {
  businessDateUtc: string | null;
  claimId: string | null;
  claimed: boolean;
  canClaim: boolean;
  fgemsAmount: number;
  freeBoxCount: number;
  freeBoxUsedCount: number;
  remainingFreeBoxCount: number;
  freeBoxAvailable: boolean;
};

export type VipStatus = {
  isVip: boolean;
  subscriptionId: string | null;
  currentPeriodEnd: string | null;
  todayClaimed: boolean;
  today: VipTodayStatus | null;
  plan: VipPlan | null;
  serverTime: string | null;
};

export type CreateVipOrderInput = {
  planId: string;
  idempotencyKey?: string | undefined;
};

export type ClaimVipDailyBenefitInput = {
  idempotencyKey?: string | undefined;
};

export type ClaimVipDailyBenefitResponse = {
  claimId: string;
  subscriptionId: string | null;
  claimDate: string | null;
  fgemsAmount: number;
  fgemsLedgerId: string | null;
  freeBoxCount: number;
  freeBoxUsedCount: number;
  remainingFreeBoxCount: number;
  freeBoxAvailable: boolean;
  alreadyClaimed: boolean;
  idempotent: boolean;
};

export type CreateVipOrderResponse = {
  orderId: string;
  starOrderId: string | null;
  invoicePayload: string | null;
  invoiceLink: string | null;
  invoiceOpenMode: string | null;
  xtrAmount: number;
  orderStatus: string;
  paymentStatus: string;
  paymentOrderStatus: string;
  expiresAt: string | null;
  paidAt: string | null;
  fulfilledAt: string | null;
  idempotent: boolean;
};
