import type { AppRoute } from "@pokepets/contracts";

import type { HandlerResult } from "../modules/types.ts";
import type { ApiError } from "./errors.ts";

export function successResponse(route: AppRoute, result: HandlerResult, requestId: string): Response {
  const data = route.output.parse(result.data);
  const headers = responseHeaders(requestId);
  if (route.rawResponse) {
    if (route.id === "mint.metadata") headers.set("cache-control", "public, max-age=31536000, immutable");
    return Response.json(data, { status: result.status ?? 200, headers });
  }
  return Response.json({ data, request_id: requestId, operation_id: result.operationId ?? null }, { status: result.status ?? 200, headers });
}

export function failureResponse(error: ApiError, requestId: string): Response {
  return Response.json({
    error: { code: error.code, message: error.status >= 500 ? "服务暂时不可用" : error.message, retryable: error.retryable },
    request_id: requestId,
    operation_id: error.operationId,
  }, { status: error.status, headers: responseHeaders(requestId) });
}

function responseHeaders(requestId: string): Headers {
  return new Headers({
    "content-type": "application/json; charset=utf-8",
    "x-request-id": requestId,
    "x-content-type-options": "nosniff",
    "referrer-policy": "no-referrer",
    "cache-control": "no-store",
    "content-security-policy": "default-src 'none'; frame-ancestors 'none'",
  });
}
