import type { RouteOutput } from "@pokepets/api-contracts/app";

export type PaymentOrder = RouteOutput<"topup.bootstrap">["orders"][number];
