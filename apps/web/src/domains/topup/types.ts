import type { RouteOutput } from "@evomypet/api-contracts/app-client";

export type PaymentOrder = RouteOutput<"topup.bootstrap">["orders"][number];
