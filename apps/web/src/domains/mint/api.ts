export const mintRouteIds = [
  "mint.list",
  "mint.get",
  "mint.reserve",
  "mint.submit",
  "mint.cancel",
] as const;

export type MintRouteId = (typeof mintRouteIds)[number];
