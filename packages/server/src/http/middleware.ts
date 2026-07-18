import { z } from "zod";

import type { AppRoute, Gateway } from "@pokepets/contracts";

import { resolveSession, type Session } from "../platform/session.ts";
import { getEnv } from "../platform/env/index.ts";
import { ApiError } from "./errors.ts";

export function authenticateGateway(request: Request, gateway: Gateway): void {
  if (gateway === "jobs" && request.headers.get("authorization") !== `Bearer ${getEnv().CRON_SECRET}`) {
    throw new ApiError(401, "CRON_UNAUTHORIZED", "后台任务认证失败");
  }
  if (gateway === "integrations" && request.headers.get("x-telegram-bot-api-secret-token") !== getEnv().TELEGRAM_WEBHOOK_SECRET) {
    throw new ApiError(401, "WEBHOOK_UNAUTHORIZED", "Webhook 认证失败");
  }
}

export async function authenticateRoute(request: Request, route: AppRoute): Promise<Session | null> {
  return route.auth ? resolveSession(request) : null;
}

export function idempotencyKey(request: Request, route: AppRoute): string | null {
  if (!route.idempotent) return null;
  const value = request.headers.get("idempotency-key");
  if (!value) throw new ApiError(400, "IDEMPOTENCY_KEY_REQUIRED", "缺少幂等键");
  if (!z.string().uuid().safeParse(value).success) throw new ApiError(400, "IDEMPOTENCY_KEY_INVALID", "幂等键必须是 UUID");
  return value;
}

export async function parseInput(
  request: Request,
  route: AppRoute,
  gateway: Gateway,
  params: Record<string, string>,
): Promise<Record<string, unknown>> {
  const url = new URL(request.url);
  if (request.method === "GET") {
    if (request.body || Number(request.headers.get("content-length") ?? 0) > 0) throw new ApiError(400, "REQUEST_BODY_NOT_ALLOWED", "GET 请求不能携带请求体");
    return validate(route, { ...Object.fromEntries([...url.searchParams.entries()].filter(([key]) => key !== "__route")), ...params });
  }
  const contentType = request.headers.get("content-type")?.split(";", 1)[0]?.trim().toLowerCase();
  if (contentType !== "application/json") throw new ApiError(415, "CONTENT_TYPE_INVALID", "请求体必须使用 application/json");
  const limit = gateway === "integrations" ? 256 * 1024 : 32 * 1024;
  const declared = Number(request.headers.get("content-length") ?? 0);
  if (declared > limit) throw new ApiError(413, "REQUEST_TOO_LARGE", "请求体过大");
  const text = await readLimitedText(request, limit);
  let body: unknown = {};
  try { body = text ? JSON.parse(text) : {}; } catch { throw new ApiError(400, "REQUEST_INVALID", "请求体不是有效 JSON"); }
  if (!body || typeof body !== "object" || Array.isArray(body)) throw new ApiError(400, "REQUEST_INVALID", "请求体必须是 JSON 对象");
  return validate(route, { ...(body as Record<string, unknown>), ...params });
}

function validate(route: AppRoute, input: unknown): Record<string, unknown> {
  const result = route.input.safeParse(input);
  if (!result.success) throw new ApiError(400, "REQUEST_INVALID", "请求参数无效", false, { issues: result.error.issues });
  return result.data as Record<string, unknown>;
}

async function readLimitedText(request: Request, limit: number): Promise<string> {
  if (!request.body) return "";
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > limit) { await reader.cancel(); throw new ApiError(413, "REQUEST_TOO_LARGE", "请求体过大"); }
    chunks.push(value);
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  return new TextDecoder().decode(bytes);
}
