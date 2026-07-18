import type { Gateway, RouteDefinition } from "./common/route.ts";
import { albumRoutes } from "./domains/album.ts";
import { catalogRoutes } from "./domains/catalog.ts";
import { expeditionRoutes } from "./domains/expedition.ts";
import { gachaRoutes } from "./domains/gacha.ts";
import { identityRoutes } from "./domains/identity.ts";
import { integrationRoutes } from "./domains/integrations.ts";
import { inventoryRoutes } from "./domains/inventory.ts";
import { jobRoutes } from "./domains/jobs.ts";
import { marketRoutes } from "./domains/market.ts";
import { mintRoutes } from "./domains/mint.ts";
import { operationRoutes } from "./domains/operations.ts";
import { referralRoutes } from "./domains/referral.ts";
import { taskRoutes } from "./domains/tasks.ts";
import { topupRoutes } from "./domains/topup.ts";
import { vipRoutes } from "./domains/vip.ts";
import { walletRoutes } from "./domains/wallet.ts";
import { wheelRoutes } from "./domains/wheel.ts";

export const routes = [
  ...identityRoutes,
  ...catalogRoutes,
  ...gachaRoutes,
  ...inventoryRoutes,
  ...expeditionRoutes,
  ...wheelRoutes,
  ...marketRoutes,
  ...topupRoutes,
  ...vipRoutes,
  ...taskRoutes,
  ...referralRoutes,
  ...albumRoutes,
  ...walletRoutes,
  ...mintRoutes,
  ...operationRoutes,
  ...integrationRoutes,
  ...jobRoutes,
] as const;

export type AppRoute = (typeof routes)[number];
export type RouteId = AppRoute["id"];
export type RouteById<Id extends RouteId> = Extract<AppRoute, { id: Id }>;

export function routeById<Id extends RouteId>(id: Id): RouteById<Id> {
  const route = routes.find((candidate) => candidate.id === id);
  if (!route) throw new Error(`Unknown route: ${id}`);
  return route as RouteById<Id>;
}

export function findRoute(
  method: string,
  pathname: string,
  gateway: Gateway,
): { route: AppRoute; params: Record<string, string> } | null {
  for (const route of routes) {
    if (route.gateway !== gateway || route.method !== method) continue;
    const match = new URLPattern({ pathname: route.path }).exec({ pathname });
    if (!match) continue;
    const params: Record<string, string> = {};
    for (const [key, value] of Object.entries(match.pathname.groups)) {
      if (value !== undefined) params[key] = value;
    }
    return { route, params };
  }
  return null;
}

export function findRouteByPath(pathname: string, gateway: Gateway): RouteDefinition | null {
  for (const route of routes) {
    if (route.gateway !== gateway) continue;
    if (new URLPattern({ pathname: route.path }).test({ pathname })) return route;
  }
  return null;
}
