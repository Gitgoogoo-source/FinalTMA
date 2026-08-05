import { assertContractRegistry } from "../common/registry.ts";
import { integrationRoutes } from "../domains/integrations/routes.ts";
import { activeRoutes as activeAppRoutes } from "./app.ts";
import { activeRoutes as activeJobRoutes } from "./jobs.ts";

export const routes = [
  ...activeAppRoutes,
  ...integrationRoutes,
  ...activeJobRoutes,
] as const;

assertContractRegistry(routes);

export type AppRoute = (typeof routes)[number];
export type RouteId = AppRoute["id"];
