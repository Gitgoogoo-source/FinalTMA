export const wheelRouteIds = ["wheel.get", "wheel.spin"] as const;

export type WheelRouteId = (typeof wheelRouteIds)[number];
