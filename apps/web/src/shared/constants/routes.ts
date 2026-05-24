export const APP_ROUTES = {
  box: "/box",
  collection: "/collection",
  album: "/album",
  trade: "/trade",
  game: "/game",
  tasks: "/tasks",
} as const;

export type AppRouteKey = keyof typeof APP_ROUTES;
export type AppRoutePath = (typeof APP_ROUTES)[AppRouteKey];

export function resolveAppRoute(pathname: string): AppRouteKey {
  if (pathname === "/" || pathname.startsWith(APP_ROUTES.box)) {
    return "box";
  }

  if (pathname.startsWith(APP_ROUTES.collection)) {
    return "collection";
  }

  if (pathname.startsWith(APP_ROUTES.album)) {
    return "album";
  }

  if (pathname.startsWith(APP_ROUTES.trade)) {
    return "trade";
  }

  if (pathname.startsWith(APP_ROUTES.game)) {
    return "game";
  }

  if (pathname.startsWith(APP_ROUTES.tasks)) {
    return "tasks";
  }

  return "box";
}
