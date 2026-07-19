import {
  assertContractRegistry,
  findRouteByPathIn,
  findRouteIn,
} from "../common/registry.ts";
import type { RouteDefinition } from "../common/route.ts";
import { integrationRoutes } from "../domains/integrations/routes.ts";

export const routes = [...integrationRoutes] as const;
assertContractRegistry(routes);

export type AppRoute = (typeof routes)[number];
export type RouteId = AppRoute["id"];
export type RouteById<Id extends RouteId> = Extract<AppRoute, { id: Id }>;

export function findRoute(method: string, pathname: string) {
  return findRouteIn(routes, method, pathname, "integrations");
}

export function findRouteByPath(pathname: string): RouteDefinition | null {
  return findRouteByPathIn(routes, pathname, "integrations");
}
