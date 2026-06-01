// api/_shared/requireSession.ts

import type { VercelRequest } from "@vercel/node";
import { hashSessionToken } from "../../packages/server/src/auth/issueSession.js";
import {
  getSupabaseAdminClient,
  type SupabaseAdminClient,
} from "../../packages/server/src/db/supabaseAdmin.js";
import { ApiError, getHeaderValue } from "./handler.js";

export { hashSessionToken };

export interface RequireSessionOptions {
  /**
   * 默认要求用户状态为 active。
   * 如果某些接口允许 banned / suspended 用户读取公开数据，可以设为 false。
   */
  requireActiveUser?: boolean;

  /**
   * 是否更新 app_sessions.last_seen_at。
   * 默认 true。
   */
  touchLastSeen?: boolean;
}

export interface SessionContext {
  sessionId: string;
  userId: string;
  telegramUserId: number | null;
  userStatus: string;
  expiresAt: string;
  sessionTokenHash: string;
  createdAt: string;
  telegramAuthDate: string | null;
}

interface AppSessionRow {
  id: string;
  user_id: string;
  session_token_hash: string;
  expires_at: string;
  revoked_at: string | null;
  last_seen_at?: string | null;
  created_at: string;
  telegram_auth_date: string | null;
}

interface UserRow {
  id: string;
  telegram_user_id: number | null;
  status: string;
}

/**
 * 后端 Supabase Admin Client。
 *
 * 注意：
 * - 必须只在 Vercel Functions 后端使用。
 * - 绝不能暴露 SUPABASE_SERVICE_ROLE_KEY 到前端。
 */
export function getSupabaseAdmin(): SupabaseAdminClient {
  return getSupabaseAdminClient();
}

/**
 * 校验 TMA app session。
 *
 * 约定：
 * - 登录接口签发一个 opaque session token，并写入 HttpOnly Cookie。
 * - 数据库存 hash，不存明文 token。
 * - 浏览器前端默认依赖 Cookie 携带 session；后端/测试客户端可用 Bearer。
 * - API 永远从 session 中取 user_id，不信任 body 里的 user_id。
 */
export async function requireSession(
  req: VercelRequest,
  options: RequireSessionOptions = {},
): Promise<SessionContext> {
  const token = extractSessionToken(req);

  if (!token) {
    throw ApiError.authSessionExpired("登录状态缺失，请重新进入应用。");
  }

  if (!isSafeSessionToken(token)) {
    throw ApiError.authSessionExpired("登录状态无效，请重新进入应用。");
  }

  const sessionTokenHash = hashSessionToken(token);
  const db = getSupabaseAdmin();

  const { data: session, error: sessionError } = await db
    .schema("core")
    .from("app_sessions")
    .select(
      "id,user_id,session_token_hash,expires_at,revoked_at,last_seen_at,created_at,telegram_auth_date",
    )
    .eq("session_token_hash", sessionTokenHash)
    .maybeSingle<AppSessionRow>();

  if (sessionError) {
    throw new ApiError(
      500,
      "SESSION_LOOKUP_FAILED",
      "Failed to lookup app session",
      {
        details: sessionError,
        expose: false,
      },
    );
  }

  if (!session) {
    throw ApiError.authSessionExpired("登录状态无效，请重新进入应用。");
  }

  if (session.revoked_at) {
    throw ApiError.authSessionExpired("登录状态已失效，请重新进入应用。");
  }

  if (isExpired(session.expires_at)) {
    throw ApiError.authSessionExpired("登录状态已过期，请重新进入应用。");
  }

  const { data: user, error: userError } = await db
    .schema("core")
    .from("users")
    .select("id,telegram_user_id,status")
    .eq("id", session.user_id)
    .maybeSingle<UserRow>();

  if (userError) {
    throw new ApiError(
      500,
      "USER_LOOKUP_FAILED",
      "Failed to lookup session user",
      {
        details: userError,
        expose: false,
      },
    );
  }

  if (!user) {
    throw ApiError.authSessionExpired("登录用户不存在，请重新进入应用。");
  }

  if (options.requireActiveUser !== false && user.status !== "active") {
    throw ApiError.userBlocked("当前账号已被限制使用。", {
      status: user.status,
    });
  }

  if (options.touchLastSeen !== false) {
    await touchSessionLastSeen(db, session.id);
  }

  return {
    sessionId: session.id,
    userId: user.id,
    telegramUserId: user.telegram_user_id,
    userStatus: user.status,
    expiresAt: session.expires_at,
    sessionTokenHash,
    createdAt: session.created_at,
    telegramAuthDate: session.telegram_auth_date,
  };
}

export function extractSessionToken(req: VercelRequest): string | null {
  const cookieHeader = getHeaderValue(req.headers.cookie);

  if (cookieHeader) {
    const cookies = parseCookieHeader(cookieHeader);

    for (const cookieName of getSessionCookieNames()) {
      const value = cookies[cookieName];

      if (value?.trim()) {
        return value.trim();
      }
    }
  }

  return extractBearerSessionToken(getHeaderValue(req.headers.authorization));
}

function extractBearerSessionToken(
  authorizationHeader: string | undefined,
): string | null {
  if (!authorizationHeader) {
    return null;
  }

  const match = /^bearer\s+(.+)$/i.exec(authorizationHeader.trim());

  if (!match) {
    return null;
  }

  const token = match[1]?.trim();

  return token || null;
}

function getSessionCookieNames(): string[] {
  return [
    process.env.SESSION_COOKIE_NAME,
    "tma_game_session",
    "__Host-tma_session",
    "tma_session",
    "app_session",
  ].filter(Boolean) as string[];
}

function parseCookieHeader(cookieHeader: string): Record<string, string> {
  const result: Record<string, string> = {};

  for (const part of cookieHeader.split(";")) {
    const [rawKey, ...rawValueParts] = part.split("=");

    const key = rawKey?.trim();
    const rawValue = rawValueParts.join("=").trim();

    if (!key) {
      continue;
    }

    try {
      result[key] = decodeURIComponent(rawValue);
    } catch {
      result[key] = rawValue;
    }
  }

  return result;
}

function isSafeSessionToken(token: string): boolean {
  /**
   * token 是登录接口发行的 opaque token。
   * 这里不要求固定格式，只限制长度和危险字符。
   */
  if (token.length < 32) {
    return false;
  }

  if (token.length > 4096) {
    return false;
  }

  if (/[\s<>"']/.test(token)) {
    return false;
  }

  return true;
}

function isExpired(expiresAt: string): boolean {
  const expiresAtMs = new Date(expiresAt).getTime();

  if (!Number.isFinite(expiresAtMs)) {
    return true;
  }

  return expiresAtMs <= Date.now();
}

async function touchSessionLastSeen(
  db: SupabaseAdminClient,
  sessionId: string,
): Promise<void> {
  const { error } = await db
    .schema("core")
    .from("app_sessions")
    .update({
      last_seen_at: new Date().toISOString(),
    })
    .eq("id", sessionId);

  if (error) {
    /**
     * last_seen_at 失败不应该阻断用户请求。
     * 但需要打日志，便于发现数据库字段或权限配置问题。
     */
    console.warn("Failed to touch session last_seen_at", {
      sessionId,
      error,
    });
  }
}
