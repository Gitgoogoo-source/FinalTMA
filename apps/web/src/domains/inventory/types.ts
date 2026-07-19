import type { RouteOutput } from "@pokepets/api-contracts/app";

export type InventoryItem = RouteOutput<"inventory.list">["items"][number];
