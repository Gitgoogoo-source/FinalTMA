import { randomUUID } from "node:crypto";

import type { AppRoute, Gateway } from "@pokepets/contracts";

import { handlerFor } from "../modules/index.ts";
import { normalizeError } from "./errors.ts";
import { authenticateGateway, authenticateRoute, idempotencyKey, parseInput } from "./middleware.ts";
import { failureResponse, successResponse } from "./response.ts";
import { matchRequest } from "./router.ts";

export function createGateway(gateway: Gateway): (request: Request) => Promise<Response> {
  return async (request) => {
    const requestId = randomUUID();
    const startedAt = Date.now();
    let route: AppRoute | null = null;
    try {
      authenticateGateway(request, gateway);
      const match = matchRequest(request, gateway);
      route = match.route;
      const [input, session] = await Promise.all([
        parseInput(request, route, gateway, match.params),
        authenticateRoute(request, route),
      ]);
      const result = await handlerFor(route.id)({ request, input, session, operationId: idempotencyKey(request, route) });
      const response = successResponse(route, result, requestId);
      log("info", { request_id: requestId, route_id: route.id, status: response.status, elapsed_ms: Date.now() - startedAt });
      return response;
    } catch (cause) {
      const error = normalizeError(cause);
      log("error", { request_id: requestId, route_id: route?.id ?? null, code: error.code, status: error.status, elapsed_ms: Date.now() - startedAt });
      return failureResponse(error, requestId);
    }
  };
}

function log(level: "info" | "error", value: Record<string, unknown>): void {
  const line = JSON.stringify({ level, ...value });
  if (level === "error") console.error(line); else console.info(line);
}
