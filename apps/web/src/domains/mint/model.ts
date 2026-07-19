import type { RouteOutput } from "@pokepets/api-contracts";

export type MintList = RouteOutput<"mint.list">;
export type Mint = MintList["mints"][number];
