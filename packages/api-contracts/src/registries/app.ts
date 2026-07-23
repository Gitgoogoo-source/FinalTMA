import type { ErrorCode } from "../common/errors.ts";
import {
  assertContractRegistry,
  findRouteByPathIn,
  findRouteIn,
} from "../common/registry.ts";
import type { RouteDefinition } from "../common/route.ts";
import { operationSummarySchema } from "../common/models.ts";
import { albumRoutes } from "../domains/album/routes.ts";
import { catalogRoutes } from "../domains/catalog/routes.ts";
import { expeditionRoutes } from "../domains/expedition/routes.ts";
import { gachaRoutes } from "../domains/gacha/routes.ts";
import { identityRoutes } from "../domains/identity/routes.ts";
import { inventoryRoutes } from "../domains/inventory/routes.ts";
import { marketRoutes } from "../domains/market/routes.ts";
import { mintRoutes } from "../domains/mint/routes.ts";
import { monsterTamerRoutes } from "../domains/monster-tamer/routes.ts";
import { operationRoutes } from "../domains/operations/routes.ts";
import { paymentSupportRoutes } from "../domains/payment-support/routes.ts";
import { referralRoutes } from "../domains/referral/routes.ts";
import { taskRoutes } from "../domains/tasks/routes.ts";
import { topupRoutes } from "../domains/topup/routes.ts";
import { vipRoutes } from "../domains/vip/routes.ts";
import { walletRoutes } from "../domains/wallet/routes.ts";
import { wheelRoutes } from "../domains/wheel/routes.ts";

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
  ...monsterTamerRoutes,
  ...operationRoutes,
  ...paymentSupportRoutes,
] as const;

assertContractRegistry(routes);

export type AppRoute = (typeof routes)[number];
export type RouteId = AppRoute["id"];
export type RouteById<Id extends RouteId> = Extract<AppRoute, { id: Id }>;
export type RecoverableRoute = Exclude<
  Extract<AppRoute, { idempotent: true }>,
  RouteById<"identity.authenticate">
>;
export type RecoverableRouteId = RecoverableRoute["id"];
export type RecoverableOperationSummary = Omit<
  import("zod").output<typeof operationSummarySchema>,
  "use_case"
> & { use_case: RecoverableRouteId };
export type TypedOperationSummary = {
  [Route in RecoverableRoute as Route["id"]]: {
    operation_id: string;
    use_case: Route["id"];
    status: "pending" | "succeeded" | "failed" | "unknown";
    result: import("zod").output<Route["output"]> | null;
    error_code: ErrorCode | null;
    acknowledged_at: string | null;
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
  return routes.some(
    (route) =>
      route.id === value &&
      route.idempotent &&
      route.id !== "identity.authenticate",
  );
}

export function parseRecoverableOperationSummary(
  value: unknown,
): RecoverableOperationSummary {
  const summary = operationSummarySchema.parse(value);
  if (!isRecoverableRouteId(summary.use_case))
    throw new Error(
      `Operation use_case is not recoverable: ${summary.use_case}`,
    );
  return summary as RecoverableOperationSummary;
}

export function parseRecoveredOperation(value: unknown): TypedOperationSummary {
  const summary = parseRecoverableOperationSummary(value);
  const route = routeById(summary.use_case);
  if (summary.status === "succeeded" && summary.result !== null)
    route.output.parse(summary.result);
  return summary as TypedOperationSummary;
}

export function findRoute(method: string, pathname: string) {
  return findRouteIn(routes, method, pathname, "app");
}

export function findRouteByPath(pathname: string): RouteDefinition | null {
  return findRouteByPathIn(routes, pathname, "app");
}
