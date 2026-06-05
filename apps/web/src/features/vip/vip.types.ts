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

export type VipStatus = {
  isVip: boolean;
  subscriptionId: string | null;
  currentPeriodEnd: string | null;
  todayClaimed: boolean;
  plan: VipPlan | null;
  serverTime: string | null;
};

export type CreateVipOrderInput = {
  planId: string;
  expectedPriceXtr: number;
  idempotencyKey?: string | undefined;
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
