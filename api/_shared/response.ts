// api/shared/response.ts

import type { VercelRequest, VercelResponse } from "@vercel/node";
import {
  AppError,
  isAppError,
  methodNotAllowed,
  normalizeError,
  type PublicErrorPayload,
} from "./errors.js";

export type ApiSuccessResponse<T> = {
  ok: true;
  success: true;
  data: T;
  meta?: Record<string, unknown> | undefined;
  requestId?: string | undefined;
  request_id?: string | undefined;
};

export type ApiErrorResponse = {
  ok: false;
  success: false;
  error: PublicErrorPayload;
  requestId?: string | undefined;
  request_id?: string | undefined;
};

export type ApiResponse<T> = ApiSuccessResponse<T> | ApiErrorResponse;

export type HttpMethod =
  | "GET"
  | "POST"
  | "PUT"
  | "PATCH"
  | "DELETE"
  | "OPTIONS"
  | "HEAD";

export type SendSuccessOptions = {
  statusCode?: number | undefined;
  meta?: Record<string, unknown> | undefined;
  requestId?: string | undefined;
};

export type SendErrorOptions = {
  requestId?: string | undefined;
  log?: boolean | undefined;
};

export function getRequestId(req: VercelRequest): string {
  const headerValue = req.headers["x-request-id"];

  if (typeof headerValue === "string" && headerValue.trim().length > 0) {
    return headerValue;
  }

  if (Array.isArray(headerValue) && typeof headerValue[0] === "string") {
    return headerValue[0];
  }

  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }

  return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

export function setSecurityHeaders(res: VercelResponse): void {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("X-Frame-Options", "DENY");
  res.setHeader("Referrer-Policy", "no-referrer");
}

export function setJsonHeaders(res: VercelResponse): void {
  res.setHeader("Content-Type", "application/json; charset=utf-8");
}

export function setCorsHeaders(
  res: VercelResponse,
  options?: {
    origin?: string;
    methods?: HttpMethod[];
    allowCredentials?: boolean;
  },
): void {
  const origin = options?.origin ?? process.env.CORS_ORIGIN ?? "*";
  const methods = options?.methods ?? [
    "GET",
    "POST",
    "PUT",
    "PATCH",
    "DELETE",
    "OPTIONS",
  ];

  res.setHeader("Access-Control-Allow-Origin", origin);
  res.setHeader("Access-Control-Allow-Methods", methods.join(", "));
  res.setHeader(
    "Access-Control-Allow-Headers",
    [
      "Content-Type",
      "X-Request-Id",
      "X-Idempotency-Key",
      "Idempotency-Key",
      "X-Telegram-Init-Data",
    ].join(", "),
  );

  if (
    options?.allowCredentials ??
    process.env.CORS_ALLOW_CREDENTIALS === "true"
  ) {
    res.setHeader("Access-Control-Allow-Credentials", "true");
  }
}

export function handleOptions(
  req: VercelRequest,
  res: VercelResponse,
): boolean {
  if (req.method !== "OPTIONS") {
    return false;
  }

  setSecurityHeaders(res);
  setCorsHeaders(res);

  res.status(204).end();
  return true;
}

export function assertMethod(
  req: VercelRequest,
  allowedMethods: HttpMethod[],
): void {
  const method = req.method?.toUpperCase() as HttpMethod | undefined;

  if (!method || !allowedMethods.includes(method)) {
    throw methodNotAllowed(`Method ${req.method ?? "UNKNOWN"} is not allowed`, {
      allowedMethods,
      receivedMethod: req.method ?? null,
    });
  }
}

export function sendSuccess<T>(
  res: VercelResponse,
  data: T,
  options: SendSuccessOptions = {},
): void {
  setSecurityHeaders(res);
  setJsonHeaders(res);

  const payload: ApiSuccessResponse<T> = {
    ok: true,
    success: true,
    data,
    ...(options.meta ? { meta: options.meta } : {}),
    ...(options.requestId
      ? { requestId: options.requestId, request_id: options.requestId }
      : {}),
  };

  res.status(options.statusCode ?? 200).json(payload);
}

export function sendCreated<T>(
  res: VercelResponse,
  data: T,
  meta?: Record<string, unknown>,
): void {
  sendSuccess(res, data, {
    statusCode: 201,
    meta,
  });
}

export function sendNoContent(res: VercelResponse): void {
  setSecurityHeaders(res);
  res.status(204).end();
}

export function sendError(
  res: VercelResponse,
  error: unknown,
  options: SendErrorOptions = {},
): void {
  const appError = normalizeError(error);
  const requestId = options.requestId;
  const shouldLog = options.log ?? true;

  setSecurityHeaders(res);
  setJsonHeaders(res);

  if (shouldLog && appError.statusCode >= 500) {
    console.error("[api:error]", {
      requestId,
      code: appError.code,
      statusCode: appError.statusCode,
      message: appError.message,
      details: appError.details,
      cause: appError.cause,
      stack: appError.stack,
    });
  }

  const payload: ApiErrorResponse = {
    ok: false,
    success: false,
    error: appError.toPublicPayload(requestId),
    ...(requestId ? { requestId, request_id: requestId } : {}),
  };

  res.status(appError.statusCode).json(payload);
}

export async function withApiHandler(
  req: VercelRequest,
  res: VercelResponse,
  options: {
    methods: HttpMethod[];
    handler: (ctx: {
      req: VercelRequest;
      res: VercelResponse;
      requestId: string;
    }) => Promise<void> | void;
    cors?: boolean;
  },
): Promise<void> {
  const requestId = getRequestId(req);

  try {
    setSecurityHeaders(res);

    if (options.cors ?? true) {
      setCorsHeaders(res);
    }

    if (handleOptions(req, res)) {
      return;
    }

    assertMethod(req, options.methods);

    await options.handler({
      req,
      res,
      requestId,
    });
  } catch (error) {
    sendError(res, error, { requestId });
  }
}

export function toAppError(error: unknown): AppError {
  return isAppError(error) ? error : normalizeError(error);
}
