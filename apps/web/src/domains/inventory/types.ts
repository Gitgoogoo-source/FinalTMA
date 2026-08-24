import type { RouteOutput } from "@evomypet/api-contracts/app-client";

export type InventoryItem = RouteOutput<"inventory.list">["items"][number];
