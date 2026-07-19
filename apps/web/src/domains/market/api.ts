export const marketRouteIds = [
  "market.bootstrap",
  "market.template",
  "market.my_listings",
  "market.create_listing",
  "market.cancel_listing",
  "market.purchase",
] as const;

export type MarketRouteId = (typeof marketRouteIds)[number];
