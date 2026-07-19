import type { Gateway, RouteDefinition } from "./common/route.ts";
import { errorRegistry, type ErrorCode } from "./common/errors.ts";
import { albumRoutes } from "./domains/album/index.ts";
import { catalogRoutes } from "./domains/catalog/index.ts";
import { expeditionRoutes } from "./domains/expedition/index.ts";
import { gachaRoutes } from "./domains/gacha/index.ts";
import { identityRoutes } from "./domains/identity/index.ts";
import { integrationRoutes } from "./domains/integrations/index.ts";
import { inventoryRoutes } from "./domains/inventory/index.ts";
import { jobRoutes } from "./domains/jobs/index.ts";
import { marketRoutes } from "./domains/market/index.ts";
import { mintRoutes } from "./domains/mint/index.ts";
import { operationRoutes } from "./domains/operations/index.ts";
import { referralRoutes } from "./domains/referral/index.ts";
import { taskRoutes } from "./domains/tasks/index.ts";
import { topupRoutes } from "./domains/topup/index.ts";
import { vipRoutes } from "./domains/vip/index.ts";
import { walletRoutes } from "./domains/wallet/index.ts";
import { wheelRoutes } from "./domains/wheel/index.ts";

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

assertContractRegistry();

export type AppRoute = (typeof routes)[number];
export type RouteId = AppRoute["id"];
export type RouteById<Id extends RouteId> = Extract<AppRoute, { id: Id }>;
export type RecoverableRoute = Extract<AppRoute, { idempotent: true }>;
export type RecoverableRouteId = RecoverableRoute["id"];
export type TypedOperationSummary = {
  [Route in RecoverableRoute as Route["id"]]: {
    operation_id: string;
    use_case: Route["id"];
    status: "pending" | "succeeded" | "failed" | "unknown";
    result: import("zod").output<Route["output"]> | null;
    error_code: ErrorCode | null;
    created_at: string;
    updated_at: string;
  };
}[RecoverableRouteId];

export function routeById<Id extends RouteId>(id: Id): RouteById<Id> {
  const route = routes.find((candidate) => candidate.id === id);
  if (!route) throw new Error(`Unknown route: ${id}`);
  return route as RouteById<Id>;
}

export function isRecoverableRouteId(
  value: string,
): value is RecoverableRouteId {
  return routes.some((route) => route.id === value && route.idempotent);
}

export function parseRecoveredOperation(value: unknown): TypedOperationSummary {
  if (!value || typeof value !== "object")
    throw new Error("Invalid operation summary");
  const summary = value as Record<string, unknown>;
  if (typeof summary.use_case !== "string")
    throw new Error("Operation use_case is missing");
  const route = routes.find(
    (candidate): candidate is RecoverableRoute =>
      candidate.id === summary.use_case && candidate.idempotent,
  );
  if (!route)
    throw new Error(
      `Operation use_case is not recoverable: ${summary.use_case}`,
    );
  if (summary.status === "succeeded" && summary.result !== null)
    route.output.parse(summary.result);
  return value as TypedOperationSummary;
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

export function findRouteByPath(
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

function assertContractRegistry(): void {
  const ids = new Set<string>();
  const signatures = new Set<string>();
  for (const route of routes) {
    const definition: RouteDefinition = route;
    if (ids.has(route.id)) throw new Error(`Duplicate route id: ${route.id}`);
    ids.add(route.id);
    const signature = `${route.gateway}:${route.method}:${route.path}`;
    if (signatures.has(signature))
      throw new Error(`Duplicate route signature: ${signature}`);
    signatures.add(signature);
    for (const code of route.errors)
      if (!Object.hasOwn(errorRegistry, code))
        throw new Error(`Unknown error code ${code} on ${route.id}`);
    if (definition.idempotent && !definition.refreshScopes?.length) {
      throw new Error(
        `Idempotent route ${definition.id} must declare refreshScopes`,
      );
    }
  }
}
