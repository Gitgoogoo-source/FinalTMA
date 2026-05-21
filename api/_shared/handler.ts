// api/_shared/handler.ts

import type { VercelRequest, VercelResponse } from '@vercel/node';
import { randomUUID } from 'node:crypto';
import {
  createRateLimiter,
  RateLimitError,
  type RateLimitAction,
  type RateLimitCombinedResult,
} from '../../packages/server/src/security/rateLimit';
import { isAppError } from './errors';

export type HttpMethod =
  | 'GET'
  | 'POST'
  | 'PUT'
  | 'PATCH'
  | 'DELETE'
  | 'OPTIONS'
  | 'HEAD';

export type MaybePromise<T> = T | Promise<T>;

export interface ApiContext {
  requestId: string;
  startedAt: number;
  method: HttpMethod;
  ip: string | null;
  userAgent: string | null;
}

export interface CorsOptions {
  origins?: '*' | string[];
  allowCredentials?: boolean;
  allowedHeaders?: string[];
  exposedHeaders?: string[];
  maxAgeSeconds?: number;
}

export interface ApiHandlerOptions {
  methods?: HttpMethod[];
  cors?: CorsOptions | false;
  cache?: 'no-store' | 'default';
  rateLimit?: false | {
    action: RateLimitAction;
  };
}

export interface ApiSuccessResponse<T = unknown> {
  ok: true;
  success: true;
  data: T;
  meta?: Record<string, unknown>;
  requestId?: string;
  request_id?: string;
}

export interface ApiErrorResponse {
  ok: false;
  success: false;
  error: {
    code: string;
    message: string;
    details?: unknown;
  };
  requestId?: string;
  request_id?: string;
}

export type ApiRouteHandler<T = unknown> = (
  req: VercelRequest,
  res: VercelResponse,
  ctx: ApiContext,
) => MaybePromise<T | void>;

export class ApiError extends Error {
  public readonly statusCode: number;
  public readonly code: string;
  public readonly details?: unknown;
  public readonly expose: boolean;

  constructor(
    statusCode: number,
    code: string,
    message: string,
    options?: {
      details?: unknown;
      expose?: boolean;
      cause?: unknown;
    },
  ) {
    super(message, { cause: options?.cause });

    this.name = 'ApiError';
    this.statusCode = statusCode;
    this.code = code;
    this.details = options?.details;
    this.expose = options?.expose ?? statusCode < 500;
  }

  static badRequest(message = 'Bad request', details?: unknown): ApiError {
    return new ApiError(400, 'BAD_REQUEST', message, { details });
  }

  static unauthorized(message = 'Unauthorized', details?: unknown): ApiError {
    return new ApiError(401, 'UNAUTHORIZED', message, { details });
  }

  static forbidden(message = 'Forbidden', details?: unknown): ApiError {
    return new ApiError(403, 'FORBIDDEN', message, { details });
  }

  static notFound(message = 'Not found', details?: unknown): ApiError {
    return new ApiError(404, 'NOT_FOUND', message, { details });
  }

  static methodNotAllowed(message = 'Method not allowed', details?: unknown): ApiError {
    return new ApiError(405, 'METHOD_NOT_ALLOWED', message, { details });
  }

  static conflict(message = 'Conflict', details?: unknown): ApiError {
    return new ApiError(409, 'CONFLICT', message, { details });
  }

  static tooManyRequests(message = 'Too many requests', details?: unknown): ApiError {
    return new ApiError(429, 'TOO_MANY_REQUESTS', message, { details });
  }

  static internal(message = 'Internal server error', details?: unknown): ApiError {
    return new ApiError(500, 'INTERNAL_SERVER_ERROR', message, {
      details,
      expose: false,
    });
  }
}

const sharedRateLimiter = createRateLimiter();

export function withApiHandler<T = unknown>(
  routeHandler: ApiRouteHandler<T>,
  options: ApiHandlerOptions = {},
) {
  return async function vercelApiHandler(req: VercelRequest, res: VercelResponse) {
    const startedAt = Date.now();
    const requestId = getRequestId(req);
    const method = normalizeMethod(req.method);

    res.setHeader('X-Request-Id', requestId);
    applySecurityHeaders(res);

    if (options.cache !== 'default') {
      res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
    }

    applyCorsHeaders(req, res, options);

    const ctx: ApiContext = {
      requestId,
      startedAt,
      method,
      ip: getClientIp(req),
      userAgent: getHeaderValue(req.headers['user-agent']) ?? null,
    };

    try {
      if (method === 'OPTIONS') {
        res.status(204).end();
        return;
      }

      assertAllowedMethod(method, options.methods, res);
      await assertRateLimit(req, res, ctx, options.rateLimit);

      const result = await routeHandler(req, res, ctx);

      if (isResponseFinished(res)) {
        return;
      }

      if (result === undefined) {
        res.status(204).end();
        return;
      }

      sendSuccess(res, result, {
        requestId,
        elapsedMs: Date.now() - startedAt,
      });
    } catch (error) {
      if (error instanceof RateLimitError) {
        applyResponseHeaders(res, error.headers);
      }

      sendError(res, normalizeError(error), {
        requestId,
        elapsedMs: Date.now() - startedAt,
      });
    }
  };
}

export function sendSuccess<T>(
  res: VercelResponse,
  data: T,
  meta?: Record<string, unknown>,
  statusCode = 200,
): void {
  if (isResponseFinished(res)) {
    return;
  }

  const payload: ApiSuccessResponse<T> = {
    ok: true,
    success: true,
    data,
    ...(meta ? { meta } : {}),
    ...(meta?.requestId ? { requestId: String(meta.requestId) } : {}),
    ...(meta?.requestId ? { request_id: String(meta.requestId) } : {}),
  };

  res.status(statusCode).json(payload);
}

export function sendCreated<T>(
  res: VercelResponse,
  data: T,
  meta?: Record<string, unknown>,
): void {
  sendSuccess(res, data, meta, 201);
}

export function sendNoContent(res: VercelResponse): void {
  if (isResponseFinished(res)) {
    return;
  }

  res.status(204).end();
}

export function getIdempotencyKey(req: VercelRequest): string | null {
  const value = getHeaderValue(req.headers['x-idempotency-key']);

  if (!value) {
    return null;
  }

  const normalized = value.trim();

  if (!normalized) {
    return null;
  }

  if (normalized.length > 128) {
    throw ApiError.badRequest('Idempotency key is too long');
  }

  return normalized;
}

export function getHeaderValue(value: string | string[] | undefined): string | undefined {
  if (Array.isArray(value)) {
    return value[0];
  }

  return value;
}

export function getRequiredEnv(name: string): string {
  const value = process.env[name];

  if (!value) {
    throw new ApiError(500, 'SERVER_CONFIG_ERROR', `Missing required env: ${name}`, {
      expose: false,
    });
  }

  return value;
}

function assertAllowedMethod(
  method: HttpMethod,
  allowedMethods: HttpMethod[] | undefined,
  res: VercelResponse,
): void {
  if (!allowedMethods || allowedMethods.length === 0) {
    return;
  }

  if (!allowedMethods.includes(method)) {
    res.setHeader('Allow', allowedMethods.join(', '));

    throw ApiError.methodNotAllowed(`Method ${method} is not allowed`, {
      allowedMethods,
    });
  }
}

function normalizeMethod(method: string | undefined): HttpMethod {
  const normalized = String(method ?? 'GET').toUpperCase();

  if (
    normalized === 'GET' ||
    normalized === 'POST' ||
    normalized === 'PUT' ||
    normalized === 'PATCH' ||
    normalized === 'DELETE' ||
    normalized === 'OPTIONS' ||
    normalized === 'HEAD'
  ) {
    return normalized;
  }

  return 'GET';
}

function normalizeError(error: unknown): ApiError {
  if (error instanceof ApiError) {
    return error;
  }

  if (error instanceof RateLimitError) {
    return new ApiError(429, 'RATE_LIMITED', error.message, {
      details: normalizeRateLimitDetails(error.result),
      expose: true,
      cause: error,
    });
  }

  if (isAppError(error)) {
    return new ApiError(error.statusCode, error.code, error.message, {
      details: error.details,
      expose: error.expose,
      cause: error,
    });
  }

  const structuralError = normalizeStructuralError(error);

  if (structuralError) {
    return structuralError;
  }

  if (isZodLikeError(error)) {
    return new ApiError(400, 'VALIDATION_ERROR', 'Invalid request parameters', {
      details: getZodLikeDetails(error),
    });
  }

  if (error instanceof Error) {
    return new ApiError(500, 'INTERNAL_SERVER_ERROR', error.message, {
      expose: false,
      cause: error,
    });
  }

  return new ApiError(500, 'INTERNAL_SERVER_ERROR', 'Unknown internal server error', {
    details: error,
    expose: false,
  });
}

function sendError(
  res: VercelResponse,
  error: ApiError,
  meta: {
    requestId: string;
    elapsedMs: number;
  },
): void {
  if (isResponseFinished(res)) {
    return;
  }

  const isProduction = process.env.NODE_ENV === 'production';

  const message =
    error.expose || !isProduction
      ? error.message
      : 'Internal server error';

  const payload: ApiErrorResponse = {
    ok: false,
    success: false,
    error: {
      code: error.code,
      message,
      ...((error.expose || !isProduction) && error.details !== undefined
        ? { details: error.details }
        : {}),
    },
    requestId: meta.requestId,
    request_id: meta.requestId,
  };

  if (error.statusCode >= 500) {
    console.error(`[${meta.requestId}] ${error.code}: ${error.message}`, {
      statusCode: error.statusCode,
      details: error.details,
      elapsedMs: meta.elapsedMs,
      stack: error.stack,
    });
  } else {
    console.warn(`[${meta.requestId}] ${error.code}: ${error.message}`, {
      statusCode: error.statusCode,
      details: error.details,
      elapsedMs: meta.elapsedMs,
    });
  }

  res.status(error.statusCode).json(payload);
}

function applySecurityHeaders(res: VercelResponse): void {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'no-referrer');
}

async function assertRateLimit(
  req: VercelRequest,
  res: VercelResponse,
  ctx: ApiContext,
  option: ApiHandlerOptions['rateLimit'],
): Promise<void> {
  if (option === false) {
    return;
  }

  const action = option?.action ?? '*';
  const result = await sharedRateLimiter.assert({
    action,
    ip: ctx.ip ?? undefined,
    method: ctx.method,
    path: req.url,
    headers: req.headers,
    userAgent: ctx.userAgent ?? undefined,
    metadata: {
      requestId: ctx.requestId,
    },
  });

  applyResponseHeaders(res, result.headers);
}

function applyResponseHeaders(res: VercelResponse, headers: Record<string, string>): void {
  for (const [name, value] of Object.entries(headers)) {
    res.setHeader(name, value);
  }
}

function applyCorsHeaders(
  req: VercelRequest,
  res: VercelResponse,
  options: ApiHandlerOptions,
): void {
  if (options.cors === false) {
    return;
  }

  const cors = options.cors ?? {};
  const origin = getHeaderValue(req.headers.origin);
  const allowedOrigin = resolveAllowedOrigin(origin, cors);

  if (allowedOrigin) {
    res.setHeader('Access-Control-Allow-Origin', allowedOrigin);
  }

  if (cors.allowCredentials ?? true) {
    res.setHeader('Access-Control-Allow-Credentials', 'true');
  }

  res.setHeader(
    'Access-Control-Allow-Methods',
    (options.methods ?? ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS']).join(', '),
  );

  res.setHeader(
    'Access-Control-Allow-Headers',
    (cors.allowedHeaders ?? [
      'Authorization',
      'Content-Type',
      'X-Requested-With',
      'X-Session-Token',
      'X-Idempotency-Key',
      'X-Request-Id',
    ]).join(', '),
  );

  if (cors.exposedHeaders?.length) {
    res.setHeader('Access-Control-Expose-Headers', cors.exposedHeaders.join(', '));
  }

  res.setHeader('Access-Control-Max-Age', String(cors.maxAgeSeconds ?? 86400));
}

function resolveAllowedOrigin(
  requestOrigin: string | undefined,
  cors: CorsOptions,
): string | null {
  if (!requestOrigin) {
    return null;
  }

  if (cors.origins === '*') {
    return cors.allowCredentials === false ? '*' : requestOrigin;
  }

  const explicitOrigins = cors.origins ?? getEnvAllowedOrigins();

  if (explicitOrigins.includes(requestOrigin)) {
    return requestOrigin;
  }

  if (process.env.NODE_ENV !== 'production' && isLocalhostOrigin(requestOrigin)) {
    return requestOrigin;
  }

  return null;
}

function getEnvAllowedOrigins(): string[] {
  const raw =
    process.env.CORS_ALLOWED_ORIGINS ??
    process.env.ALLOWED_ORIGINS ??
    process.env.PUBLIC_WEB_ORIGIN ??
    '';

  return raw
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean);
}

function isLocalhostOrigin(origin: string): boolean {
  return /^https?:\/\/(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/.test(origin);
}

function getRequestId(req: VercelRequest): string {
  return (
    getHeaderValue(req.headers['x-request-id']) ??
    getHeaderValue(req.headers['x-vercel-id']) ??
    randomUUID()
  );
}

function getClientIp(req: VercelRequest): string | null {
  const forwardedFor = getHeaderValue(req.headers['x-forwarded-for']);

  if (forwardedFor) {
    return forwardedFor.split(',')[0]?.trim() || null;
  }

  return (
    getHeaderValue(req.headers['x-real-ip']) ??
    getHeaderValue(req.headers['cf-connecting-ip']) ??
    null
  );
}

function isResponseFinished(res: VercelResponse): boolean {
  return res.headersSent || Boolean((res as unknown as { writableEnded?: boolean }).writableEnded);
}

function isZodLikeError(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'issues' in error &&
    Array.isArray((error as { issues?: unknown }).issues)
  );
}

function getZodLikeDetails(error: unknown): unknown {
  if (!isZodLikeError(error)) {
    return undefined;
  }

  return (error as { issues: unknown[] }).issues;
}

function normalizeRateLimitDetails(result: RateLimitCombinedResult): Record<string, unknown> {
  return {
    action: result.action,
    retryAfterMs: result.retryAfterMs,
    rejected: result.rejected
      ? {
          action: result.rejected.action,
          scope: result.rejected.scope,
          limit: result.rejected.limit,
          remaining: result.rejected.remaining,
          resetAt: result.rejected.resetAt.toISOString(),
          reason: result.rejected.reason,
        }
      : null,
  };
}

function normalizeStructuralError(error: unknown): ApiError | null {
  if (typeof error !== 'object' || error === null) {
    return null;
  }

  const record = error as {
    code?: unknown;
    statusCode?: unknown;
    message?: unknown;
    details?: unknown;
    cause?: unknown;
    expose?: unknown;
  };

  if (typeof record.code !== 'string' || typeof record.message !== 'string') {
    return null;
  }

  const statusCode =
    typeof record.statusCode === 'number' && Number.isFinite(record.statusCode)
      ? record.statusCode
      : 500;

  return new ApiError(statusCode, record.code, record.message, {
    details: record.details,
    expose: typeof record.expose === 'boolean' ? record.expose : statusCode < 500,
    cause: record.cause ?? error,
  });
}
