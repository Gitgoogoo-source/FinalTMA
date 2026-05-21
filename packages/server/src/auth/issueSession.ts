// packages/server/src/auth/issueSession.ts

import { createHmac, randomBytes, randomUUID } from "node:crypto";
import {
  getSupabaseAdminClient,
  type SupabaseAdminClient,
} from "../db/supabaseAdmin.js";

export type IssueSessionErrorCode =
  | "SESSION_SECRET_MISSING"
  | "SESSION_SECRET_WEAK"
  | "USER_ID_MISSING"
  | "SESSION_INSERT_FAILED"
  | "PREVIOUS_SESSION_REVOKE_FAILED";

export class IssueSessionError extends Error {
  public readonly code: IssueSessionErrorCode;
  public readonly statusCode = 500;

  constructor(code: IssueSessionErrorCode, message: string, cause?: unknown) {
    super(message);
    this.name = "IssueSessionError";
    this.code = code;
    defineErrorCause(this, cause);
  }
}

function defineErrorCause(error: Error, cause: unknown): void {
  Object.defineProperty(error, "cause", {
    configurable: true,
    enumerable: false,
    writable: true,
    value: cause,
  });
}

export interface IssueSessionInput {
  /**
   * core.users.id
   */
  userId: string;

  /**
   * Telegram user id。
   * 建议存成 text，避免未来跨语言整数精度问题。
   */
  telegramUserId?: number | string;

  /**
   * verifyTelegramInitData 返回的 authDateUnix。
   */
  initDataAuthDate?: number;

  /**
   * verifyTelegramInitData 返回的 initDataHash。
   */
  initDataHash?: string;

  /**
   * 原始 IP 不入库，只存 HMAC hash。
   */
  ip?: string | null;

  /**
   * 原始 User-Agent 不入库，只存 HMAC hash。
   */
  userAgent?: string | null;

  /**
   * 默认 7 天。
   */
  ttlSeconds?: number;

  /**
   * 测试时可传固定时间。
   */
  now?: Date | number;

  /**
   * 是否签发新 session 时撤销旧 session。
   * 默认 false。
   */
  revokePreviousSessions?: boolean;

  /**
   * 额外审计信息。
   * 只放非敏感数据。
   */
  metadata?: Record<string, unknown>;

  /**
   * 测试注入；生产默认使用 getSupabaseAdminClient()。
   */
  db?: SupabaseAdminClient;
}

export interface IssuedSession {
  token: string;
  tokenType: "Bearer";
  sessionId: string;
  userId: string;
  telegramUserId?: string | undefined;
  issuedAt: Date;
  expiresAt: Date;
  expiresInSeconds: number;
}

export interface SessionTokenParts {
  sessionId: string;
  secret: string;
}

export interface BuildSessionCookieOptions {
  cookieName?: string;
  maxAgeSeconds?: number;
  domain?: string;
  path?: string;
  sameSite?: "Lax" | "Strict" | "None";
  secure?: boolean;
  httpOnly?: boolean;
}

export const SESSION_TOKEN_PREFIX = "tma_sess_v1.";
export const SESSION_COOKIE_NAME = "tma_game_session";

const SESSION_SECRET_BYTES = 32;
const DEFAULT_SESSION_TTL_SECONDS = 7 * 24 * 60 * 60;
const MAX_SESSION_TTL_SECONDS = 30 * 24 * 60 * 60;
const MIN_APP_SESSION_SECRET_LENGTH = 32;

export async function issueSession(
  input: IssueSessionInput,
): Promise<IssuedSession> {
  if (!input.userId || input.userId.trim().length === 0) {
    throw new IssueSessionError(
      "USER_ID_MISSING",
      "签发 session 时缺少 userId。",
    );
  }

  const db = input.db ?? getSupabaseAdminClient();
  const nowMs = getNowMs(input.now);
  const issuedAt = new Date(nowMs);
  const ttlSeconds = normalizeTtlSeconds(input.ttlSeconds);
  const expiresAt = new Date(nowMs + ttlSeconds * 1000);

  const tokenParts = createSessionTokenParts();
  const token = formatSessionToken(tokenParts);
  const tokenHash = hashSessionToken(token);

  if (input.revokePreviousSessions) {
    const { error } = await db
      .schema("core")
      .from("app_sessions")
      .update({
        revoked_at: issuedAt.toISOString(),
      })
      .eq("user_id", input.userId)
      .is("revoked_at", null);

    if (error) {
      throw new IssueSessionError(
        "PREVIOUS_SESSION_REVOKE_FAILED",
        "撤销旧 session 失败。",
        error,
      );
    }
  }

  const row = {
    id: tokenParts.sessionId,
    user_id: input.userId,

    session_token_hash: tokenHash,
    expires_at: expiresAt.toISOString(),
    last_seen_at: issuedAt.toISOString(),
    revoked_at: null,

    ip_hash: input.ip ? hashClientFingerprint(input.ip, "ip") : null,
    user_agent: input.userAgent
      ? hashClientFingerprint(input.userAgent, "user_agent")
      : null,

    telegram_auth_date:
      typeof input.initDataAuthDate === "number"
        ? new Date(input.initDataAuthDate * 1000).toISOString()
        : null,

    init_data_hash: input.initDataHash ?? null,

    created_at: issuedAt.toISOString(),
  };

  const { error } = await db.schema("core").from("app_sessions").insert(row);

  if (error) {
    throw new IssueSessionError(
      "SESSION_INSERT_FAILED",
      "写入 core.app_sessions 失败。",
      error,
    );
  }

  return {
    token,
    tokenType: "Bearer",
    sessionId: tokenParts.sessionId,
    userId: input.userId,
    telegramUserId:
      input.telegramUserId === undefined
        ? undefined
        : String(input.telegramUserId),
    issuedAt,
    expiresAt,
    expiresInSeconds: ttlSeconds,
  };
}

export function createSessionTokenParts(): SessionTokenParts {
  return {
    sessionId: randomUUID(),
    secret: randomBytes(SESSION_SECRET_BYTES).toString("base64url"),
  };
}

export function formatSessionToken(parts: SessionTokenParts): string {
  return `${SESSION_TOKEN_PREFIX}${parts.sessionId}.${parts.secret}`;
}

export function parseSessionToken(token: string): SessionTokenParts | null {
  if (typeof token !== "string") return null;

  const trimmed = token.trim();

  if (!trimmed.startsWith(SESSION_TOKEN_PREFIX)) {
    return null;
  }

  const payload = trimmed.slice(SESSION_TOKEN_PREFIX.length);
  const segments = payload.split(".");

  if (segments.length !== 2) {
    return null;
  }

  const sessionId = segments[0];
  const secret = segments[1];

  if (!sessionId || !secret) {
    return null;
  }

  if (!isUuid(sessionId)) {
    return null;
  }

  if (!/^[A-Za-z0-9_-]{32,}$/.test(secret)) {
    return null;
  }

  return { sessionId, secret };
}

export function hashSessionToken(token: string): string {
  return createHmac("sha256", getAppSessionSecret())
    .update(token)
    .digest("hex");
}

export function hashClientFingerprint(
  value: string,
  namespace = "client",
): string {
  return createHmac("sha256", getAppSessionSecret())
    .update(`${namespace}:${value}`)
    .digest("hex");
}

export function buildSessionCookie(
  token: string,
  options: BuildSessionCookieOptions = {},
): string {
  const cookieName = options.cookieName ?? SESSION_COOKIE_NAME;
  const path = options.path ?? "/";
  const sameSite = options.sameSite ?? "Lax";
  const secure = options.secure ?? true;
  const httpOnly = options.httpOnly ?? true;

  const parts = [`${cookieName}=${encodeURIComponent(token)}`, `Path=${path}`];

  if (typeof options.maxAgeSeconds === "number") {
    parts.push(`Max-Age=${Math.max(0, Math.floor(options.maxAgeSeconds))}`);
  }

  if (options.domain) {
    parts.push(`Domain=${options.domain}`);
  }

  if (httpOnly) {
    parts.push("HttpOnly");
  }

  if (secure) {
    parts.push("Secure");
  }

  parts.push(`SameSite=${sameSite}`);

  return parts.join("; ");
}

export function buildExpiredSessionCookie(
  options: Omit<BuildSessionCookieOptions, "maxAgeSeconds"> = {},
): string {
  return buildSessionCookie("", {
    ...options,
    maxAgeSeconds: 0,
  });
}

export function getAppSessionSecret(): string {
  const secret =
    process.env.APP_SESSION_SECRET ??
    process.env.SESSION_SECRET ??
    process.env.AUTH_SESSION_SECRET;

  if (!secret || secret.trim().length === 0) {
    throw new IssueSessionError(
      "SESSION_SECRET_MISSING",
      "缺少 APP_SESSION_SECRET。生产环境必须配置强随机 session secret。",
    );
  }

  if (secret.length < MIN_APP_SESSION_SECRET_LENGTH) {
    throw new IssueSessionError(
      "SESSION_SECRET_WEAK",
      `APP_SESSION_SECRET 长度不能小于 ${MIN_APP_SESSION_SECRET_LENGTH} 个字符。`,
    );
  }

  return secret;
}

function normalizeTtlSeconds(input?: number): number {
  if (typeof input !== "number" || !Number.isFinite(input)) {
    return DEFAULT_SESSION_TTL_SECONDS;
  }

  const ttl = Math.floor(input);

  if (ttl <= 0) {
    return DEFAULT_SESSION_TTL_SECONDS;
  }

  return Math.min(ttl, MAX_SESSION_TTL_SECONDS);
}

function getNowMs(now?: Date | number): number {
  if (typeof now === "number") return now;
  if (now instanceof Date) return now.getTime();
  return Date.now();
}

function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    value,
  );
}
