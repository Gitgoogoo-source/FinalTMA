import { randomUUID } from "node:crypto";

import type {
  ErrorCode,
  Gateway,
  RouteDefinition,
} from "@pokepets/api-contracts/common";

import { writeLog } from "../platform/logging/index.ts";
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
    try {
      authenticateGateway(request, gateway);
      const match = matchRequest(request, registry);
      route = match.route;
      const session = await authenticateRoute(request, route);
      const input = await parseInput(request, route, gateway, match.params);
      const handler = (handlers as Readonly<Record<string, RouteHandler>>)[
        route.id
      ];
      if (!handler) throw new Error(`Missing handler: ${route.id}`);
      const result = await handler({
        request,
        input,
        session,
        operationId: idempotencyKey(request, route),
      });
      const response = successResponse(route, result, requestId);
      writeLog("info", {
        request_id: requestId,
        route_id: route.id,
        status: response.status,
        elapsed_ms: Date.now() - startedAt,
      });
      return response;
    } catch (cause) {
      const error = normalizeError(
        cause,
        route?.errors ?? preRouteErrors(gateway),
      );
      writeLog("error", {
        request_id: requestId,
        route_id: route?.id ?? null,
        code: error.code,
        status: error.status,
        elapsed_ms: Date.now() - startedAt,
      });
      return failureResponse(error, requestId);
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
