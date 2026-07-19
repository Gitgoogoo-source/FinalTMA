import type { Gateway, RouteDefinition } from "@pokepets/api-contracts/common";

import { ApiError } from "./errors.ts";

export type RouteMatcher<Route extends RouteDefinition> = {
  gateway: Gateway;
  findRoute: (
    method: string,
    pathname: string,
  ) => { route: Route; params: Record<string, string> } | null;
  findRouteByPath: (pathname: string) => RouteDefinition | null;
};

export function matchRequest<Route extends RouteDefinition>(
  request: Request,
  matcher: RouteMatcher<Route>,
): { route: Route; params: Record<string, string> } {
  const { gateway } = matcher;
  const url = new URL(request.url);
  const routed = url.searchParams.get("__route");
  const pathname = routed
    ? `/api/${routed.replace(/^\/+/, "")}`
    : gateway === "integrations"
      ? "/api/telegram/webhook"
      : url.pathname;
  const match = matcher.findRoute(request.method, pathname);
  if (match) return match;
  if (matcher.findRouteByPath(pathname))
    throw new ApiError(405, "METHOD_NOT_ALLOWED", "请求方法不支持");
  throw new ApiError(404, "API_ROUTE_NOT_FOUND", "接口不存在");
}
