import {
  assertContractRegistry,
  findRouteByPathIn,
  findRouteIn,
} from "../common/registry.ts";
import type { RouteDefinition } from "../common/route.ts";
import { jobRoutes } from "../domains/jobs/routes.ts";

export const routes = [...jobRoutes] as const;
export const activeRoutes = jobRoutes.filter(
  (route) => route.id !== "jobs.reconcile_mints",
);
assertContractRegistry(routes);
assertContractRegistry(activeRoutes);

export type AppRoute = (typeof routes)[number];
export type RouteId = AppRoute["id"];
export type RouteById<Id extends RouteId> = Extract<AppRoute, { id: Id }>;

export function findRoute(method: string, pathname: string) {
  return findRouteIn(activeRoutes, method, pathname, "jobs");
}

export function findRouteByPath(pathname: string): RouteDefinition | null {
  return findRouteByPathIn(activeRoutes, pathname, "jobs");
}
