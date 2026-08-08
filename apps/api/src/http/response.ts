import type { RouteDefinition } from "@pokepets/api-contracts/common";

import type { HandlerResult } from "./handlers.ts";
import { ApiError } from "./errors.ts";

export function successResponse(
  route: RouteDefinition,
  result: HandlerResult,
  requestId: string,
): Response {
  const parsed = route.output.safeParse(result.data);
  if (!parsed.success)
    throw new ApiError(
      502,
      "RESPONSE_INVALID",
      "服务响应格式无效",
      true,
      { issues: parsed.error.issues },
      result.operationId ?? null,
    );
  const data = parsed.data;
  const headers = responseHeaders(requestId, route.cachePolicy);
  if ("rawResponse" in route && route.rawResponse) {
    return Response.json(data, { status: result.status ?? 200, headers });
  }
  return Response.json(
    { data, request_id: requestId, operation_id: result.operationId ?? null },
    { status: result.status ?? 200, headers },
  );
}

export function failureResponse(error: ApiError, requestId: string): Response {
  return Response.json(
    {
      error: {
        code: error.code,
        message: error.status >= 500 ? "服务暂时不可用" : error.message,
        retryable: error.retryable,
      },
      request_id: requestId,
      operation_id: error.operationId,
    },
    { status: error.status, headers: responseHeaders(requestId) },
  );
}

function responseHeaders(
  requestId: string,
  cachePolicy?: RouteDefinition["cachePolicy"],
): Headers {
  const headers = new Headers({
    "content-type": "application/json; charset=utf-8",
    "x-content-type-options": "nosniff",
    "referrer-policy": "no-referrer",
    "content-security-policy": "default-src 'none'; frame-ancestors 'none'",
  });
  if (cachePolicy === "public-immutable") {
    headers.set("cache-control", "public, max-age=31536000, immutable");
    headers.set("vercel-cdn-cache-control", "public, s-maxage=31536000");
  } else {
    headers.set("x-request-id", requestId);
    headers.set("cache-control", "no-store");
  }
  return headers;
}
