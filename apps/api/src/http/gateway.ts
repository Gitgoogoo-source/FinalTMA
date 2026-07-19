import { randomUUID } from "node:crypto";

import type { AppRoute, Gateway } from "@pokepets/api-contracts";

import { handlerFor } from "../domains/index.ts";
import { writeLog } from "../platform/logging/index.ts";
import { normalizeError } from "./errors.ts";
import {
  authenticateGateway,
  authenticateRoute,
  idempotencyKey,
  parseInput,
} from "./middleware.ts";
import { failureResponse, successResponse } from "./response.ts";
import { matchRequest } from "./router.ts";

export function createGateway(
  gateway: Gateway,
): (request: Request) => Promise<Response> {
  return async (request) => {
    const requestId = randomUUID();
    const startedAt = Date.now();
    let route: AppRoute | null = null;
    try {
      authenticateGateway(request, gateway);
      const match = matchRequest(request, gateway);
      route = match.route;
      const session = await authenticateRoute(request, route);
      const input = await parseInput(request, route, gateway, match.params);
      const result = await handlerFor(route.id)({
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

function preRouteErrors(gateway: Gateway) {
  return [
    "API_ROUTE_NOT_FOUND",
    "METHOD_NOT_ALLOWED",
    "INTERNAL_ERROR",
    ...(gateway === "jobs" ? (["CRON_UNAUTHORIZED"] as const) : []),
    ...(gateway === "integrations" ? (["WEBHOOK_UNAUTHORIZED"] as const) : []),
  ] as const;
}
