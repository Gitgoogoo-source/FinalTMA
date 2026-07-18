import { findRoute, findRouteByPath, type AppRoute, type Gateway } from "@pokepets/contracts";

import { ApiError } from "./errors.ts";

export function matchRequest(request: Request, gateway: Gateway): { route: AppRoute; params: Record<string, string> } {
  const url = new URL(request.url);
  const routed = url.searchParams.get("__route");
  const pathname = routed ? `/api/${routed.replace(/^\/+/, "")}` : gateway === "integrations" ? "/api/telegram/webhook" : url.pathname;
  const match = findRoute(request.method, pathname, gateway);
  if (match) return match;
  if (findRouteByPath(pathname, gateway)) throw new ApiError(405, "METHOD_NOT_ALLOWED", "请求方法不支持");
  throw new ApiError(404, "API_ROUTE_NOT_FOUND", "接口不存在");
}
