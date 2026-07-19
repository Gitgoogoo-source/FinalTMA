export const inventoryRouteIds = [
  "inventory.list",
  "inventory.detail",
  "inventory.evolve",
  "inventory.decompose",
] as const;

export type InventoryRouteId = (typeof inventoryRouteIds)[number];
