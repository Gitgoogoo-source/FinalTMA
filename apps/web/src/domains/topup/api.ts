export const topupRouteIds = [
  "topup.bootstrap",
  "topup.create_order",
  "topup.order",
] as const;

export type TopupRouteId = (typeof topupRouteIds)[number];
