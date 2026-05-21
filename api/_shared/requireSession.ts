// api/_shared/requireSession.ts

import type { VercelRequest } from '@vercel/node';
import { createHash } from 'node:crypto';
import {
  getSupabaseAdminClient,
  type SupabaseAdminClient,
} from '../../packages/server/src/db/supabaseAdmin';
import { ApiError, getHeaderValue } from './handler';

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
}

interface AppSessionRow {
  id: string;
  user_id: string;
  session_token_hash: string;
  expires_at: string;
  revoked_at: string | null;
  last_seen_at?: string | null;
}

interface UserRow {
  id: string;
  telegram_user_id: number | null;
  status: string;
  deleted_at?: string | null;
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
 * - 前端登录后拿到一个 opaque session token。
 * - 数据库存 hash，不存明文 token。
 * - 前端请求时通过 Authorization: Bearer <token> 或 cookie 携带。
 * - API 永远从 session 中取 user_id，不信任 body 里的 user_id。
 */
export async function requireSession(
  req: VercelRequest,
  options: RequireSessionOptions = {},
): Promise<SessionContext> {
  const token = extractSessionToken(req);

  if (!token) {
    throw ApiError.unauthorized('Missing session token');
  }

  if (!isSafeSessionToken(token)) {
    throw ApiError.unauthorized('Invalid session token format');
  }

  const sessionTokenHash = hashSessionToken(token);
  const db = getSupabaseAdmin();

  const { data: session, error: sessionError } = await db
    .schema('core')
    .from('app_sessions')
    .select('id,user_id,session_token_hash,expires_at,revoked_at,last_seen_at')
    .eq('session_token_hash', sessionTokenHash)
    .maybeSingle<AppSessionRow>();

  if (sessionError) {
    throw new ApiError(500, 'SESSION_LOOKUP_FAILED', 'Failed to lookup app session', {
      details: sessionError,
      expose: false,
    });
  }

  if (!session) {
    throw ApiError.unauthorized('Invalid session');
  }

  if (session.revoked_at) {
    throw ApiError.unauthorized('Session has been revoked');
  }

  if (isExpired(session.expires_at)) {
    throw ApiError.unauthorized('Session has expired');
  }

  const { data: user, error: userError } = await db
    .schema('core')
    .from('users')
    .select('id,telegram_user_id,status,deleted_at')
    .eq('id', session.user_id)
    .maybeSingle<UserRow>();

  if (userError) {
    throw new ApiError(500, 'USER_LOOKUP_FAILED', 'Failed to lookup session user', {
      details: userError,
      expose: false,
    });
  }

  if (!user) {
    throw ApiError.unauthorized('Session user does not exist');
  }

  if (user.deleted_at) {
    throw ApiError.forbidden('User has been deleted');
  }

  if (options.requireActiveUser !== false && user.status !== 'active') {
    throw ApiError.forbidden('User is not active', {
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
  };
}

export function hashSessionToken(token: string): string {
  return createHash('sha256').update(token, 'utf8').digest('hex');
}

export function extractSessionToken(req: VercelRequest): string | null {
  const authorization = getHeaderValue(req.headers.authorization);

  if (authorization) {
    const match = authorization.match(/^Bearer\s+(.+)$/i);

    if (match?.[1]) {
      return match[1].trim();
    }
  }

  const xSessionToken = getHeaderValue(req.headers['x-session-token']);

  if (xSessionToken?.trim()) {
    return xSessionToken.trim();
  }

  const cookieHeader = getHeaderValue(req.headers.cookie);

  if (!cookieHeader) {
    return null;
  }

  const cookies = parseCookieHeader(cookieHeader);

  const cookieNames = [
    process.env.TMA_SESSION_COOKIE_NAME,
    process.env.SESSION_COOKIE_NAME,
    'tma_game_session',
    '__Host-tma_session',
    'tma_session',
    'app_session',
  ].filter(Boolean) as string[];

  for (const cookieName of cookieNames) {
    const value = cookies[cookieName];

    if (value?.trim()) {
      return value.trim();
    }
  }

  return null;
}

function parseCookieHeader(cookieHeader: string): Record<string, string> {
  const result: Record<string, string> = {};

  for (const part of cookieHeader.split(';')) {
    const [rawKey, ...rawValueParts] = part.split('=');

    const key = rawKey?.trim();
    const rawValue = rawValueParts.join('=').trim();

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

async function touchSessionLastSeen(db: SupabaseAdminClient, sessionId: string): Promise<void> {
  const { error } = await db
    .schema('core')
    .from('app_sessions')
    .update({
      last_seen_at: new Date().toISOString(),
    })
    .eq('id', sessionId);

  if (error) {
    /**
     * last_seen_at 失败不应该阻断用户请求。
     * 但需要打日志，便于发现数据库字段或权限配置问题。
     */
    console.warn('Failed to touch session last_seen_at', {
      sessionId,
      error,
    });
  }
}
