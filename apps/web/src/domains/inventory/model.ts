import type { RouteOutput } from "@pokepets/api-contracts";

export type Inventory = RouteOutput<"inventory.list">;
export type InventoryItem = Inventory["items"][number];
