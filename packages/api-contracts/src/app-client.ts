import { z } from "zod";

import {
  standardErrorSchema,
  successEnvelopeSchema,
  type SuccessEnvelope,
} from "./common/envelope.ts";
import type { ErrorCode } from "./common/error-codes.ts";
import type { RefreshScope } from "./common/errors.ts";
import { operationSummarySchema } from "./common/models.ts";
import type { RouteDefinition } from "./common/route.ts";
import type {
  AppRoute,
  RecoverableOperationSummary,
  RecoverableRouteId,
  RouteById,
  RouteId,
  TypedOperationSummary,
} from "./registries/app.ts";
import type { evolutionRejectedResultSchema } from "./domains/inventory/models.ts";
import type {
  battleRealtimeInvalidationSchema,
  battleTeamSelectionSchema,
} from "./domains/battle/models.ts";

export { standardErrorSchema };
export { MARKET_PURCHASE_MAX_QUANTITY } from "./domains/market/policy.ts";
export type {
  AppRoute,
  ErrorCode,
  RecoverableOperationSummary,
  RecoverableRouteId,
  RefreshScope,
  RouteId,
  TypedOperationSummary,
};
export type * from "./domains/battle/models.ts";

export type RouteInput<Id extends RouteId> = z.input<RouteById<Id>["input"]>;
export type RouteOutput<Id extends RouteId> = z.output<RouteById<Id>["output"]>;
export type RouteResult<Id extends RouteId> =
  RouteById<Id> extends { rawResponse: true }
    ? RouteOutput<Id>
    : SuccessEnvelope<RouteOutput<Id>>;
export type EvolutionRejectedResult = z.output<
  typeof evolutionRejectedResultSchema
>;
export type BattleRealtimeInvalidation = z.output<
  typeof battleRealtimeInvalidationSchema
>;

type ClientRoute = RouteDefinition<RouteId>;
type RouteModule = { readonly [key: string]: unknown };
type RouteLoader = () => Promise<RouteModule>;

const firstScreenRouteLoader = cachedLoader(
  () => import("./client-routes/first-screen.ts"),
);
const routeLoaders = {
  album: cachedLoader(() => import("./domains/album/routes.ts")),
  battle: cachedLoader(() => import("./domains/battle/routes.ts")),
  expedition: cachedLoader(() => import("./domains/expedition/routes.ts")),
  inventory: cachedLoader(() => import("./domains/inventory/routes.ts")),
  market: cachedLoader(() => import("./domains/market/routes.ts")),
  referral: cachedLoader(() => import("./domains/referral/routes.ts")),
  tasks: cachedLoader(() => import("./domains/tasks/routes.ts")),
  wheel: cachedLoader(() => import("./domains/wheel/routes.ts")),
} as const;

const firstScreenPrefixes = new Set([
  "catalog",
  "gacha",
  "health",
  "identity",
  "operations",
  "telegram",
  "topup",
  "vip",
]);

export function preloadFirstScreenContracts(): Promise<void> {
  return firstScreenRouteLoader().then(() => undefined);
}

export async function loadClientRoute<Id extends RouteId>(
  id: Id,
): Promise<RouteById<Id>> {
  const prefix = id.split(".")[0] ?? "";
  const module = firstScreenPrefixes.has(prefix)
    ? await firstScreenRouteLoader()
    : await loadDomainRouteModule(prefix);
  const route = routeFromModule(module, id);
  if (!route) throw new Error(`Unknown active client route: ${id}`);
  return route as RouteById<Id>;
}

export async function parseRouteInput<Id extends RouteId>(
  id: Id,
  input: unknown,
): Promise<RouteInput<Id>> {
  const route = await loadClientRoute(id);
  return route.input.parse(input) as RouteInput<Id>;
}

export async function parseRouteOutput<Id extends RouteId>(
  id: Id,
  value: unknown,
): Promise<RouteOutput<Id>> {
  const route = await loadClientRoute(id);
  return route.output.parse(value) as RouteOutput<Id>;
}

export async function parseRouteResult<Id extends RouteId>(
  id: Id,
  value: unknown,
): Promise<RouteResult<Id>> {
  const route = await loadClientRoute(id);
  const parsed =
    "rawResponse" in route && route.rawResponse
      ? route.output.parse(value)
      : successEnvelopeSchema(route.output).parse(value);
  return parsed as unknown as RouteResult<Id>;
}

export function isRecoverableRouteId(
  value: string,
): value is RecoverableRouteId {
  return recoverableRouteIds.has(value as RecoverableRouteId);
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

export async function parseBattleRealtimeInvalidation(
  value: unknown,
): Promise<BattleRealtimeInvalidation> {
  const { battleRealtimeInvalidationSchema } =
    await import("./domains/battle/models.ts");
  return battleRealtimeInvalidationSchema.parse(value);
}

export async function parseBattleTeamSelection(
  value: unknown,
): Promise<z.output<typeof battleTeamSelectionSchema>> {
  const { battleTeamSelectionSchema } =
    await import("./domains/battle/models.ts");
  return battleTeamSelectionSchema.parse(value);
}

export async function parseEvolutionRejectedResult(
  value: unknown,
): Promise<EvolutionRejectedResult> {
  const { evolutionRejectedResultSchema } =
    await import("./domains/inventory/models.ts");
  return evolutionRejectedResultSchema.parse(value);
}

const recoverableRouteIds = new Set<RecoverableRouteId>([
  "album.claim",
  "battle.accept",
  "battle.action",
  "battle.cancel",
  "battle.create",
  "battle.matchmake",
  "expedition.claim",
  "expedition.create",
  "gacha.open",
  "inventory.decompose",
  "inventory.evolve",
  "market.cancel_template_listings",
  "market.create_listing",
  "market.purchase",
  "referral.bind",
  "tasks.check_in",
  "tasks.claim",
  "topup.cancel_order",
  "topup.create_order",
  "topup.fail_order",
  "vip.cancel_order",
  "vip.claim_fgems",
  "vip.claim_free_box",
  "vip.create_order",
  "wheel.spin",
]);

function cachedLoader(loader: RouteLoader): RouteLoader {
  let task: Promise<RouteModule> | null = null;
  return () => {
    task ??= loader().catch((cause: unknown) => {
      task = null;
      throw cause;
    });
    return task;
  };
}

async function loadDomainRouteModule(prefix: string): Promise<RouteModule> {
  const loader = routeLoaders[prefix as keyof typeof routeLoaders];
  if (!loader) throw new Error(`Unknown active client route prefix: ${prefix}`);
  return loader();
}

function routeFromModule(module: RouteModule, id: string): ClientRoute | null {
  if ("firstScreenRouteById" in module) {
    const lookup = module.firstScreenRouteById;
    if (typeof lookup === "function")
      return (lookup as (routeId: string) => ClientRoute | null)(id);
  }
  for (const value of Object.values(module)) {
    if (!Array.isArray(value)) continue;
    const route = value.find(
      (candidate): candidate is ClientRoute =>
        Boolean(candidate) &&
        typeof candidate === "object" &&
        "id" in candidate &&
        candidate.id === id,
    );
    if (route) return route;
  }
  return null;
}
