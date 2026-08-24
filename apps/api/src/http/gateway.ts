import { randomUUID } from "node:crypto";

import type {
  ErrorCode,
  Gateway,
  RouteDefinition,
} from "@evomypet/api-contracts/common";

import { writeLog } from "../platform/logging/index.ts";
import {
  createBattleRequestTelemetry,
  observeRequestStage,
  observeRequestStageSync,
  observesBattleRoute,
  type RequestTelemetry,
} from "../platform/observability/index.ts";
import { normalizeError } from "./errors.ts";
import type { RouteHandler } from "./handlers.ts";
import {
  authenticateGateway,
  authenticateRoute,
  idempotencyKey,
  parseInput,
} from "./middleware.ts";
import { failureResponse, successResponse } from "./response.ts";
import type { RouteMatcher } from "./router.ts";
import { matchRequest } from "./router.ts";

export type GatewayRegistry<Route extends RouteDefinition> = {
  gateway: Gateway;
  findRoute: RouteMatcher<Route>["findRoute"];
  findRouteByPath: RouteMatcher<Route>["findRouteByPath"];
  handlers: Readonly<Record<Route["id"], RouteHandler>>;
};

export function createGateway<Route extends RouteDefinition>(
  registry: GatewayRegistry<Route>,
): (request: Request) => Promise<Response> {
  const { gateway, handlers } = registry;
  return async (request) => {
    const requestId = randomUUID();
    const startedAt = Date.now();
    let route: Route | null = null;
    let telemetry: RequestTelemetry | null = null;
    try {
      const match = matchRequest(request, registry);
      const matchedRoute = match.route;
      route = matchedRoute;
      telemetry = observesBattleRoute(matchedRoute.id)
        ? createBattleRequestTelemetry()
        : null;
      const session = observeRequestStageSync(telemetry, "auth", () => {
        authenticateGateway(request, gateway, matchedRoute);
        return authenticateRoute(request, matchedRoute);
      });
      const input = await observeRequestStage(telemetry, "input_parse", () =>
        parseInput(request, matchedRoute, gateway, match.params),
      );
      const handler = (handlers as Readonly<Record<string, RouteHandler>>)[
        matchedRoute.id
      ];
      if (!handler) throw new Error(`Missing handler: ${matchedRoute.id}`);
      const result = await observeRequestStage(telemetry, "handler", () =>
        handler({
          request,
          input,
          session,
          operationId: idempotencyKey(request, matchedRoute),
          telemetry,
        }),
      );
      const response = observeRequestStageSync(telemetry, "response", () =>
        successResponse(matchedRoute, result, requestId),
      );
      writeLog("info", {
        request_id: requestId,
        route_id: matchedRoute.id,
        status: response.status,
        elapsed_ms: Date.now() - startedAt,
        ...(telemetry?.snapshot() ?? {}),
      });
      return response;
    } catch (cause) {
      if (request.signal.aborted) {
        const response = observeRequestStageSync(
          telemetry,
          "response",
          () => new Response(null, { status: 499 }),
        );
        writeLog("info", {
          request_id: requestId,
          route_id: route?.id ?? null,
          status: 499,
          client_aborted: true,
          elapsed_ms: Date.now() - startedAt,
          ...(telemetry?.snapshot() ?? {}),
        });
        return response;
      }
      const error = normalizeError(
        cause,
        route?.errors ?? preRouteErrors(gateway),
      );
      const response = observeRequestStageSync(telemetry, "response", () =>
        failureResponse(error, requestId),
      );
      writeLog("error", {
        request_id: requestId,
        route_id: route?.id ?? null,
        code: error.code,
        status: error.status,
        elapsed_ms: Date.now() - startedAt,
        ...(telemetry?.snapshot() ?? {}),
      });
      return response;
    }
  };
}

function preRouteErrors(gateway: Gateway): readonly ErrorCode[] {
  return [
    "API_ROUTE_NOT_FOUND",
    "METHOD_NOT_ALLOWED",
    "INTERNAL_ERROR",
    ...(gateway === "jobs" ? (["CRON_UNAUTHORIZED"] as const) : []),
    ...(gateway === "integrations" ? (["WEBHOOK_UNAUTHORIZED"] as const) : []),
  ] as const;
}
