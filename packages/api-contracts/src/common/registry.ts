import type { Gateway, RouteDefinition } from "./route.ts";
import { errorRegistry } from "./errors.ts";

export function assertContractRegistry(
  routes: readonly RouteDefinition[],
): void {
  const ids = new Set<string>();
  const signatures = new Set<string>();
  for (const route of routes) {
    if (ids.has(route.id)) throw new Error(`Duplicate route id: ${route.id}`);
    ids.add(route.id);
    const signature = `${route.gateway}:${route.method}:${route.path}`;
    if (signatures.has(signature))
      throw new Error(`Duplicate route signature: ${signature}`);
    signatures.add(signature);
    for (const code of route.errors)
      if (!Object.hasOwn(errorRegistry, code))
        throw new Error(`Unknown error code ${code} on ${route.id}`);
    if (route.idempotent && !route.refreshScopes?.length)
      throw new Error(
        `Idempotent route ${route.id} must declare refreshScopes`,
      );
  }
}

export function findRouteIn<Routes extends readonly RouteDefinition[]>(
  routes: Routes,
  method: string,
  pathname: string,
  gateway: Gateway,
): { route: Routes[number]; params: Record<string, string> } | null {
  for (const route of routes) {
    if (route.gateway !== gateway || route.method !== method) continue;
    const match = new URLPattern({ pathname: route.path }).exec({ pathname });
    if (!match) continue;
    const params: Record<string, string> = {};
    for (const [key, value] of Object.entries(match.pathname.groups))
      if (value !== undefined) params[key] = value;
    return { route, params };
  }
  return null;
}

export function findRouteByPathIn(
  routes: readonly RouteDefinition[],
  pathname: string,
  gateway: Gateway,
): RouteDefinition | null {
  for (const route of routes) {
    if (route.gateway !== gateway) continue;
    if (new URLPattern({ pathname: route.path }).test({ pathname }))
      return route;
  }
  return null;
}
