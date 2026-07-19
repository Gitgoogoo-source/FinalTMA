export const vipRouteIds = [
  "vip.get",
  "vip.create_order",
  "vip.claim_fgems",
  "vip.claim_free_box",
] as const;

export type VipRouteId = (typeof vipRouteIds)[number];
