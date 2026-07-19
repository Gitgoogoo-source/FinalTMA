import type { RouteOutput } from "@pokepets/api-contracts";

export type MarketBootstrap = RouteOutput<"market.bootstrap">;
export type MarketListing =
  RouteOutput<"market.my_listings">["listings"][number];
