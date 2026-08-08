import type { RouteOutput } from "@pokepets/api-contracts/app-client";

export type InventoryItem = RouteOutput<"inventory.list">["items"][number];
