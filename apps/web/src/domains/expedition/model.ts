import type { RouteOutput } from "@pokepets/api-contracts";

export type ExpeditionList = RouteOutput<"expedition.list">;
export type Expedition = ExpeditionList["active"][number];
