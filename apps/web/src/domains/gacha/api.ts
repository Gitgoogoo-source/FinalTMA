export const gachaRouteIds = ["gacha.bootstrap", "gacha.open"] as const;

export type GachaRouteId = (typeof gachaRouteIds)[number];
