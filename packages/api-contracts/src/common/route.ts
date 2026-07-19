import { z } from "zod";

import type { ErrorCode, RefreshScope } from "./errors.ts";

export type HttpMethod = "GET" | "POST";
export type Gateway = "app" | "integrations" | "jobs";

export type RouteDefinition<
  Id extends string = string,
  Input extends z.ZodType = z.ZodType,
  Output extends z.ZodType = z.ZodType,
> = {
  id: Id;
  method: HttpMethod;
  path: string;
  gateway: Gateway;
  auth: boolean;
  idempotent: boolean;
  refreshScopes?: readonly RefreshScope[];
  rawResponse?: boolean;
  input: Input;
  output: Output;
  errors: readonly ErrorCode[];
};

export function defineRoute<const Route extends RouteDefinition>(
  route: Route,
): Route & { errors: readonly ErrorCode[] } {
  const errors: ErrorCode[] = [
    "DATABASE_RPC_FAILED",
    "INTERNAL_ERROR",
    "REQUEST_INVALID",
    "RESPONSE_INVALID",
  ];
  if (route.method === "GET") errors.push("REQUEST_BODY_NOT_ALLOWED");
  else errors.push("CONTENT_TYPE_INVALID", "REQUEST_TOO_LARGE");
  if (route.auth)
    errors.push(
      "ACCOUNT_RESTRICTED",
      "SESSION_EXPIRED",
      "SESSION_REPLACED",
      "SESSION_REQUIRED",
    );
  if (route.idempotent)
    errors.push("IDEMPOTENCY_KEY_INVALID", "IDEMPOTENCY_KEY_REQUIRED");
  if (route.gateway === "jobs") errors.push("CRON_UNAUTHORIZED");
  if (route.gateway === "integrations") errors.push("WEBHOOK_UNAUTHORIZED");
  return { ...route, errors: [...new Set([...errors, ...route.errors])] };
}
