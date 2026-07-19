export const albumRouteIds = ["album.get", "album.claim"] as const;

export type AlbumRouteId = (typeof albumRouteIds)[number];
