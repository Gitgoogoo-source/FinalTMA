import type { RouteOutput } from "@pokepets/api-contracts/app-client";

export type PaymentOrder = RouteOutput<"topup.bootstrap">["orders"][number];
