import type { RouteOutput } from "@pokepets/api-contracts";

export type TopupBootstrap = RouteOutput<"topup.bootstrap">;
export type PaymentOrder = TopupBootstrap["orders"][number];
