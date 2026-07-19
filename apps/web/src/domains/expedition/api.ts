export const expeditionRouteIds = [
  "expedition.list",
  "expedition.eligible_items",
  "expedition.create",
  "expedition.claim",
] as const;

export type ExpeditionRouteId = (typeof expeditionRouteIds)[number];
