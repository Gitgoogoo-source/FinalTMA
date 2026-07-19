export const catalogRouteIds = ["catalog.get"] as const;

export type CatalogRouteId = (typeof catalogRouteIds)[number];
