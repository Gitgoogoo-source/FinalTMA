// packages/server/src/auth/verifySession.ts

import { timingSafeEqual } from "node:crypto";
import {
  getSupabaseAdminClient,
  type SupabaseAdminClient,
} from "../db/supabaseAdmin";
import {
  SESSION_COOKIE_NAME,
  hashClientFingerprint,
  hashSessionToken,
  parseSessionToken,
} from "./issueSession";

export type SessionVerificationErrorCode =
  | "SESSION_TOKEN_MISSING"
  | "SESSION_TOKEN_INVALID_FORMAT"
  | "SESSION_NOT_FOUND"
  | "SESSION_HASH_MISMATCH"
  | "SESSION_EXPIRED"
  | "SESSION_REVOKED"
  | "SESSION_IP_MISMATCH"
  | "SESSION_USER_AGENT_MISMATCH"
  | "SESSION_DB_ERROR";

export class SessionVerificationError extends Error {
  public readonly code: SessionVerificationErrorCode;
  public readonly statusCode = 401;
  public override readonly cause?: unknown;

  constructor(
    code: SessionVerificationErrorCode,
    message: string,
    cause?: unknown,
  ) {
    super(message);
    this.name = "SessionVerificationError";
    this.code = code;
    this.cause = cause;
  }
}

export interface VerifiedAppSession {
  sessionId: string;
  userId: string;
  telegramUserId?: string | undefined;

  issuedAt?: Date | undefined;
  expiresAt: Date;
  lastSeenAt?: Date | undefined;

  expiresInSeconds: number;
  metadata: Record<string, unknown>;
}

export interface VerifySessionOptions {
  db?: SupabaseAdminClient;

  /**
   * 测试时可传固定时间。
   */
  now?: Date | number;

  /**
   * 请求来源 IP。
   * 默认只用于 strictIp 校验。
   */
  ip?: string | null;

  /**
   * 请求 User-Agent。
   * 默认只用于 strictUserAgent 校验。
   */
  userAgent?: string | null;

  /**
   * 是否强制校验 IP 指纹。
   * Telegram 移动端网络变化频繁，默认 false。
   */
  strictIp?: boolean;

  /**
   * 是否强制校验 UA 指纹。
   * 默认 false。
   */
  strictUserAgent?: boolean;

  /**
   * 是否更新 last_seen_at。
   * 默认 true。
   */
  touch?: boolean;

  /**
   * last_seen_at 最小更新间隔。
   * 默认 60 秒，避免每次 API 请求都写库。
   */
  touchIntervalSeconds?: number;

  /**
   * 从 Cookie 读取 session 时使用的 cookie 名。
   */
  cookieName?: string;

  /**
   * 可选：从自定义 header 读取 session。
   * 默认 x-app-session。
   */
  sessionHeaderName?: string;
}

export interface WebHeadersLike {
  get(name: string): string | null;
}

export type HeadersLike =
  | WebHeadersLike
  | Record<string, string | string[] | undefined>;

export interface RequestLike {
  headers: HeadersLike;
}

interface AppSessionRow {
  id: string;
  user_id: string;

  session_token_hash: string;

  created_at: string | null;
  expires_at: string;
  last_seen_at: string | null;
  revoked_at: string | null;

  ip_hash: string | null;
  user_agent: string | null;
}

interface SessionUserRow {
  telegram_user_id: number | string | null;
}

/**
 * 统一入口：
 * - 可以传 raw token
 * - 可以传 Authorization header 内容
 * - 可以传 Headers
 * - 可以传 { headers }
 */
export async function verifySession(
  input: string | HeadersLike | RequestLike,
  options: VerifySessionOptions = {},
): Promise<VerifiedAppSession> {
  const token =
    typeof input === "string"
      ? normalizePossibleBearerToken(input)
      : isRequestLike(input)
        ? extractSessionTokenFromHeaders(input.headers, options)
        : extractSessionTokenFromHeaders(input, options);

  return verifySessionToken(token, options);
}

export async function verifySessionFromHeaders(
  headers: HeadersLike,
  options: VerifySessionOptions = {},
): Promise<VerifiedAppSession> {
  const token = extractSessionTokenFromHeaders(headers, options);
  return verifySessionToken(token, options);
}

export async function verifySessionToken(
  token: string,
  options: VerifySessionOptions = {},
): Promise<VerifiedAppSession> {
  if (!token || token.trim().length === 0) {
    throw new SessionVerificationError(
      "SESSION_TOKEN_MISSING",
      "缺少 session token。",
    );
  }

  const tokenParts = parseSessionToken(token);

  if (!tokenParts) {
    throw new SessionVerificationError(
      "SESSION_TOKEN_INVALID_FORMAT",
      "session token 格式无效。",
    );
  }

  const db = options.db ?? getSupabaseAdminClient();
  const nowMs = getNowMs(options.now);
  const now = new Date(nowMs);
  const tokenHash = hashSessionToken(token);

  const { data, error } = await db
    .schema("core")
    .from("app_sessions")
    .select(
      [
        "id",
        "user_id",
        "session_token_hash",
        "created_at",
        "expires_at",
        "last_seen_at",
        "revoked_at",
        "ip_hash",
        "user_agent",
      ].join(","),
    )
    .eq("id", tokenParts.sessionId)
    .maybeSingle<AppSessionRow>();

  if (error) {
    throw new SessionVerificationError(
      "SESSION_DB_ERROR",
      "查询 session 失败。",
      error,
    );
  }

  if (!data) {
    throw new SessionVerificationError("SESSION_NOT_FOUND", "session 不存在。");
  }

  if (!safeHexEqual(data.session_token_hash, tokenHash)) {
    throw new SessionVerificationError(
      "SESSION_HASH_MISMATCH",
      "session token 校验失败。",
    );
  }

  if (data.revoked_at) {
    throw new SessionVerificationError("SESSION_REVOKED", "session 已被撤销。");
  }

  const expiresAtMs = Date.parse(data.expires_at);

  if (!Number.isFinite(expiresAtMs) || expiresAtMs <= nowMs) {
    throw new SessionVerificationError("SESSION_EXPIRED", "session 已过期。");
  }

  if (options.strictIp && data.ip_hash && options.ip) {
    const incomingIpHash = hashClientFingerprint(options.ip, "ip");

    if (!safeHexEqual(data.ip_hash, incomingIpHash)) {
      throw new SessionVerificationError(
        "SESSION_IP_MISMATCH",
        "请求 IP 与 session 指纹不匹配。",
      );
    }
  }

  if (options.strictUserAgent && data.user_agent && options.userAgent) {
    const incomingUserAgentHash = hashClientFingerprint(
      options.userAgent,
      "user_agent",
    );

    if (!safeHexEqual(data.user_agent, incomingUserAgentHash)) {
      throw new SessionVerificationError(
        "SESSION_USER_AGENT_MISMATCH",
        "请求 User-Agent 与 session 指纹不匹配。",
      );
    }
  }

  if (options.touch !== false) {
    await touchSessionIfNeeded(db, data, tokenHash, now, options);
  }

  const telegramUserId = await getSessionTelegramUserId(db, data.user_id);

  return {
    sessionId: data.id,
    userId: data.user_id,
    telegramUserId,

    issuedAt: data.created_at ? new Date(data.created_at) : undefined,
    expiresAt: new Date(data.expires_at),
    lastSeenAt: data.last_seen_at ? new Date(data.last_seen_at) : undefined,

    expiresInSeconds: Math.max(0, Math.floor((expiresAtMs - nowMs) / 1000)),
    metadata: {},
  };
}

export function extractSessionTokenFromHeaders(
  headers: HeadersLike,
  options: Pick<VerifySessionOptions, "cookieName" | "sessionHeaderName"> = {},
): string {
  const authorization = getHeader(headers, "authorization");

  if (authorization) {
    const token = normalizePossibleBearerToken(authorization);

    if (token) {
      return token;
    }
  }

  const customHeaderName = options.sessionHeaderName ?? "x-app-session";
  const customHeaderToken = getHeader(headers, customHeaderName);

  if (customHeaderToken && customHeaderToken.trim().length > 0) {
    return customHeaderToken.trim();
  }

  const cookieHeader = getHeader(headers, "cookie");

  if (cookieHeader) {
    const cookies = parseCookieHeader(cookieHeader);
    const cookieName = options.cookieName ?? SESSION_COOKIE_NAME;
    const cookieToken = cookies[cookieName];

    if (cookieToken && cookieToken.trim().length > 0) {
      return cookieToken.trim();
    }
  }

  throw new SessionVerificationError(
    "SESSION_TOKEN_MISSING",
    "请求中缺少 session token。",
  );
}

export function parseCookieHeader(
  cookieHeader: string,
): Record<string, string> {
  const result: Record<string, string> = {};

  for (const part of cookieHeader.split(";")) {
    const trimmed = part.trim();
    if (!trimmed) continue;

    const equalIndex = trimmed.indexOf("=");

    if (equalIndex === -1) {
      continue;
    }

    const key = trimmed.slice(0, equalIndex).trim();
    const value = trimmed.slice(equalIndex + 1).trim();

    if (!key) continue;

    try {
      result[key] = decodeURIComponent(value);
    } catch {
      result[key] = value;
    }
  }

  return result;
}

async function touchSessionIfNeeded(
  db: SupabaseAdminClient,
  session: AppSessionRow,
  tokenHash: string,
  now: Date,
  options: VerifySessionOptions,
): Promise<void> {
  const intervalSeconds = options.touchIntervalSeconds ?? 60;

  if (!shouldTouch(session.last_seen_at, now.getTime(), intervalSeconds)) {
    return;
  }

  await db
    .schema("core")
    .from("app_sessions")
    .update({
      last_seen_at: now.toISOString(),
    })
    .eq("id", session.id)
    .eq("session_token_hash", tokenHash);
}

async function getSessionTelegramUserId(
  db: SupabaseAdminClient,
  userId: string,
): Promise<string | undefined> {
  const { data, error } = await db
    .schema("core")
    .from("users")
    .select("telegram_user_id")
    .eq("id", userId)
    .maybeSingle<SessionUserRow>();

  if (error) {
    throw new SessionVerificationError(
      "SESSION_DB_ERROR",
      "查询 session 用户失败。",
      error,
    );
  }

  if (data?.telegram_user_id === null || data?.telegram_user_id === undefined) {
    return undefined;
  }

  return String(data.telegram_user_id);
}

function shouldTouch(
  lastSeenAt: string | null,
  nowMs: number,
  intervalSeconds: number,
): boolean {
  if (!lastSeenAt) return true;

  const lastSeenMs = Date.parse(lastSeenAt);

  if (!Number.isFinite(lastSeenMs)) return true;

  return nowMs - lastSeenMs >= intervalSeconds * 1000;
}

function normalizePossibleBearerToken(value: string): string {
  const trimmed = value.trim();

  if (/^Bearer\s+/i.test(trimmed)) {
    return trimmed.replace(/^Bearer\s+/i, "").trim();
  }

  return trimmed;
}

function getHeader(headers: HeadersLike, name: string): string | undefined {
  if (typeof (headers as WebHeadersLike).get === "function") {
    return (headers as WebHeadersLike).get(name) ?? undefined;
  }

  const record = headers as Record<string, string | string[] | undefined>;
  const direct = record[name];
  const lower = record[name.toLowerCase()];

  const found = direct ?? lower ?? findHeaderCaseInsensitive(record, name);

  if (Array.isArray(found)) {
    return found[0];
  }

  return found;
}

function findHeaderCaseInsensitive(
  headers: Record<string, string | string[] | undefined>,
  name: string,
): string | string[] | undefined {
  const lowerName = name.toLowerCase();

  for (const [key, value] of Object.entries(headers)) {
    if (key.toLowerCase() === lowerName) {
      return value;
    }
  }

  return undefined;
}

function isRequestLike(value: unknown): value is RequestLike {
  return (
    typeof value === "object" &&
    value !== null &&
    "headers" in value &&
    Boolean((value as RequestLike).headers)
  );
}

function getNowMs(now?: Date | number): number {
  if (typeof now === "number") return now;
  if (now instanceof Date) return now.getTime();
  return Date.now();
}

function safeHexEqual(a: string | null | undefined, b: string): boolean {
  if (!a) return false;

  const left = a.toLowerCase();
  const right = b.toLowerCase();

  if (!/^[a-f0-9]{64}$/.test(left)) return false;
  if (!/^[a-f0-9]{64}$/.test(right)) return false;

  const leftBuffer = Buffer.from(left, "hex");
  const rightBuffer = Buffer.from(right, "hex");

  if (leftBuffer.length !== rightBuffer.length) {
    return false;
  }

  return timingSafeEqual(leftBuffer, rightBuffer);
}
