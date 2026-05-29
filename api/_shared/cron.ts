import { timingSafeEqual } from "node:crypto";
import type { VercelRequest } from "@vercel/node";

import { ApiError } from "./handler.js";

export function assertCronRequest(req: VercelRequest): void {
  if (isCronApiDisabled()) {
    throw new ApiError(404, "CRON_DISABLED", "定时任务入口未启用。");
  }

  const expectedSecret = readEnv("CRON_SECRET");

  if (!expectedSecret && !isCronSecretOptional()) {
    throw new ApiError(500, "CRON_SECRET_MISSING", "定时任务密钥未配置。", {
      expose: false,
    });
  }

  if (!expectedSecret) {
    return;
  }

  const providedSecret = readBearerToken(req.headers.authorization);

  if (!providedSecret || !safeEqual(providedSecret, expectedSecret)) {
    throw new ApiError(401, "CRON_UNAUTHORIZED", "定时任务密钥无效。");
  }
}

function isCronApiDisabled(): boolean {
  const value = process.env.ENABLE_CRON_API;

  return typeof value === "string" && value.trim().toLowerCase() === "false";
}

function isCronSecretOptional(): boolean {
  return process.env.NODE_ENV === "test" || process.env.APP_ENV === "local";
}

function readEnv(name: string): string | null {
  const value = process.env[name];

  if (typeof value !== "string") {
    return null;
  }

  const trimmed = value.trim();

  return trimmed.length > 0 ? trimmed : null;
}

function readBearerToken(value: string | string[] | undefined): string | null {
  const header = readHeader(value);

  if (!header) {
    return null;
  }

  const match = /^bearer\s+(.+)$/i.exec(header);

  return match?.[1]?.trim() ?? null;
}

function readHeader(
  value: string | string[] | number | undefined,
): string | null {
  if (Array.isArray(value)) {
    return value[0] ? String(value[0]) : null;
  }

  if (typeof value === "number") {
    return String(value);
  }

  if (typeof value !== "string") {
    return null;
  }

  const trimmed = value.trim();

  return trimmed.length > 0 ? trimmed : null;
}

function safeEqual(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);

  return left.length === right.length && timingSafeEqual(left, right);
}
