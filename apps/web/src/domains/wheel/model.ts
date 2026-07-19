import type { RouteOutput } from "@pokepets/api-contracts";

export type WheelStatus = RouteOutput<"wheel.get">;
export type WheelResult = RouteOutput<"wheel.spin">;
