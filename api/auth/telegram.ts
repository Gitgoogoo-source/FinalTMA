import type { VercelRequest } from "@vercel/node";
import {
  getAuthSessionConfig,
  secondsUntil,
  type AuthSessionConfig,
} from "../../packages/server/src/auth/sessionConfig.js";
import {
  AuthTelegramLoginRequestSchema,
  type AuthTelegramLoginRequest,
} from "../../packages/validation/src/auth.schemas.js";
import {
  createOpaqueSessionToken,
  hashClientFingerprint,
  hashSessionToken,
} from "../../packages/server/src/auth/issueSession.js";
import {
  TelegramInitDataValidationError,
  verifyTelegramInitData,
} from "../../packages/server/src/auth/verifyTelegramInitData.js";
import { callRpcRaw } from "../../packages/server/src/db/rpc.js";
import {
  type ApiContext,
  ApiError,
  getHeaderValue,
  withApiHandler,
} from "../_shared/handler.js";
import { parseJsonBody } from "../_shared/parseBody.js";
import {
  extractSessionToken,
  getSupabaseAdmin,
} from "../_shared/requireSession.js";
import { DEFAULT_RATE_LIMIT_RULES } from "../../packages/server/src/security/rateLimit.js";
import { createApiRateLimiter } from "../_shared/rateLimiter.js";
import { recordRiskEventSafely } from "../_shared/riskEvents.js";
import { validate } from "../_shared/validate.js";
import { buildAuthSessionCookie } from "./_sessionCookies.js";

type AuthUpsertTelegramUserResult = {
  user_id: string;
  telegram_user_id: number | string;
  invite_code?: string | null;
};

type AuthCreateSessionResult = {
  session_id: string;
  expires_at: string;
};

type ExistingUserRow = {
  id: string;
};

type ExistingSessionRow = {
  id: string;
  user_id: string;
  expires_at: string;
  revoked_at: string | null;
  init_data_hash: string | null;
};

type ReusableSessionUserRow = {
  id: string;
  telegram_user_id: number | string;
  invite_code: string | null;
  status: string;
};

type AuthUserRow = {
  status: string;
};

type ReferralSignalRow = {
  id: string;
  inviter_user_id: string;
  invitee_user_id: string;
  invite_code: string | null;
  status: string | null;
};

type ReferralInviterRow = {
  id: string;
  invite_code: string;
};

type AppSessionSignalRow = {
  id: string;
  ip_hash: string | null;
  user_agent: string | null;
  device_id: string | null;
  platform: string | null;
  created_at: string;
};

const verifiedAuthRateLimiter = createApiRateLimiter({
  rules: DEFAULT_RATE_LIMIT_RULES.filter(
    (rule) =>
      rule.action === "auth.telegram" &&
      (rule.scope === "telegram_user" || rule.scope === "custom"),
  ),
});

export default withApiHandler(
  async (req, res, ctx) => {
    const sessionConfig = getAuthSessionConfig();
    const body = await parseJsonBody<unknown>(req, {
      maxBytes: 16 * 1024,
    });
    const input = validate(AuthTelegramLoginRequestSchema, body);
    const verified = verifyTrustedInitData(input, sessionConfig);
    await assertVerifiedAuthRateLimit(req, ctx, verified);

    const reusableSession = await loadReusableSessionForVerifiedInitData(
      req,
      verified,
    );

    if (reusableSession) {
      const expiresInSeconds = secondsUntil(reusableSession.expiresAt);

      res.setHeader(
        "Set-Cookie",
        buildAuthSessionCookie(reusableSession.token, expiresInSeconds),
      );

      return buildLoginResponse({
        isNewUser: false,
        userId: reusableSession.userResult.user_id,
        userResult: reusableSession.userResult,
        verified,
        sessionId: reusableSession.sessionId,
        expiresAt: reusableSession.expiresAt,
        expiresInSeconds,
      });
    }

    const wasExistingUser = await hasExistingTelegramUser(verified.user.id);

    const userResult = await upsertTelegramUser(verified, ctx.requestId);

    const userId = requireStringField(userResult, "user_id");
    const authUser = await loadAuthUser(userId);

    if (authUser.status !== "active") {
      throw ApiError.userBlocked("当前账号已被限制使用。", {
        status: authUser.status,
      });
    }

    const token = createOpaqueSessionToken();
    const tokenHash = hashSessionToken(token);
    const expiresAt = new Date(Date.now() + sessionConfig.ttlSeconds * 1000);
    const ipHash = ctx.ip ? hashFingerprint("ip", ctx.ip) : null;
    const userAgentHash = hashNullableFingerprint(
      "user_agent",
      getSafeUserAgent(req),
    );
    const platform = input.clientContext?.platform ?? null;
    const deviceId = buildServerDeviceId({
      ipHash,
      userAgentHash,
      platform,
    });

    const sessionResult = await createSession({
      userId,
      tokenHash,
      expiresAt,
      verified,
      ipHash,
      userAgentHash,
      deviceId,
      platform,
      requestId: ctx.requestId,
    });

    const sessionId = requireStringField(sessionResult, "session_id");
    const sessionExpiresAt = requireStringField(sessionResult, "expires_at");
    const expiresInSeconds = secondsUntil(sessionExpiresAt);
    await recordReferralStartParamRiskSignalsSafely({
      db: getSupabaseAdmin(),
      userId,
      startParam: verified.startParam ?? null,
      requestId: ctx.requestId,
      sessionId,
      deviceId,
      ipHash,
      userAgentHash,
      platform,
    });

    res.setHeader(
      "Set-Cookie",
      buildAuthSessionCookie(token, expiresInSeconds),
    );

    return buildLoginResponse({
      isNewUser: !wasExistingUser,
      userId,
      userResult,
      verified,
      sessionId,
      expiresAt: sessionExpiresAt,
      expiresInSeconds,
    });
  },
  {
    methods: ["POST"],
    rateLimit: {
      action: "auth.telegram",
    },
  },
);

function verifyTrustedInitData(
  input: AuthTelegramLoginRequest,
  sessionConfig: AuthSessionConfig,
) {
  try {
    return verifyTelegramInitData(input.initData, {
      maxAgeSeconds: sessionConfig.telegramInitDataMaxAgeSeconds,
      allowedClockSkewSeconds:
        sessionConfig.telegramInitDataClockToleranceSeconds,
    });
  } catch (error) {
    if (error instanceof TelegramInitDataValidationError) {
      throw new ApiError(
        401,
        mapTelegramInitDataErrorCode(error.code),
        mapTelegramInitDataErrorMessage(error.code),
        {
          details: {
            reason: error.code,
          },
        },
      );
    }

    throw error;
  }
}

async function assertVerifiedAuthRateLimit(
  req: VercelRequest,
  ctx: ApiContext,
  verified: ReturnType<typeof verifyTelegramInitData>,
): Promise<void> {
  await verifiedAuthRateLimiter.assert({
    action: "auth.telegram",
    method: ctx.method,
    path: req.url,
    headers: req.headers,
    ip: ctx.ip ?? undefined,
    userAgent: ctx.userAgent ?? undefined,
    telegramUserId: verified.user.id,
    custom: `init_data:${verified.initDataHash}`,
    metadata: {
      stage: "verified_init_data",
    },
  });
}

function mapTelegramInitDataErrorCode(code: string): string {
  if (code === "AUTH_DATE_EXPIRED") {
    return "AUTH_INIT_DATA_EXPIRED";
  }

  if (code === "AUTH_DATE_FROM_FUTURE") {
    return "AUTH_INIT_DATA_FROM_FUTURE";
  }

  return "AUTH_INIT_DATA_INVALID";
}

function mapTelegramInitDataErrorMessage(code: string): string {
  if (code === "AUTH_DATE_EXPIRED") {
    return "Telegram 登录凭证已过期，请重新进入应用。";
  }

  if (code === "AUTH_DATE_FROM_FUTURE") {
    return "Telegram 登录凭证时间无效，请重新进入应用。";
  }

  return "Telegram 登录校验失败。";
}

async function upsertTelegramUser(
  verified: ReturnType<typeof verifyTelegramInitData>,
  requestId: string,
): Promise<AuthUpsertTelegramUserResult> {
  try {
    return await callRpcRaw<AuthUpsertTelegramUserResult>(
      "auth_upsert_telegram_user",
      {
        p_telegram_user_id: verified.user.id,
        p_username: verified.user.username ?? null,
        p_first_name: verified.user.first_name ?? null,
        p_last_name: verified.user.last_name ?? null,
        p_language_code: verified.user.language_code ?? null,
        p_is_premium: verified.user.is_premium ?? false,
        p_photo_url: verified.user.photo_url ?? null,
        p_start_param: verified.startParam ?? null,
        p_metadata: {
          source: "telegram-mini-app",
          query_id: verified.queryId ?? null,
        },
      },
      {
        schema: "api" as never,
        context: {
          requestId,
          telegramUserId: String(verified.user.id),
        },
      },
    );
  } catch (error) {
    throw mapAuthUpsertTelegramUserError(error);
  }
}

async function createSession(input: {
  userId: string;
  tokenHash: string;
  expiresAt: Date;
  verified: ReturnType<typeof verifyTelegramInitData>;
  ipHash: string | null;
  userAgentHash: string | null;
  deviceId: string | null;
  platform: string | null;
  requestId: string;
}): Promise<AuthCreateSessionResult> {
  try {
    return await callRpcRaw<AuthCreateSessionResult>(
      "auth_create_session",
      {
        p_user_id: input.userId,
        p_session_token_hash: input.tokenHash,
        p_expires_at: input.expiresAt.toISOString(),
        p_telegram_auth_date: input.verified.authDate.toISOString(),
        p_init_data_hash: input.verified.initDataHash,
        p_ip_hash: input.ipHash,
        p_user_agent: input.userAgentHash,
        p_device_id: input.deviceId,
        p_platform: input.platform,
      },
      {
        schema: "api" as never,
        context: {
          requestId: input.requestId,
          userId: input.userId,
        },
      },
    );
  } catch (error) {
    throw mapAuthCreateSessionError(error);
  }
}

function mapAuthCreateSessionError(error: unknown): unknown {
  const message = error instanceof Error ? error.message.toLowerCase() : "";

  if (message.includes("auth_init_data_replayed")) {
    return new ApiError(
      409,
      "AUTH_INIT_DATA_REPLAYED",
      "Telegram 登录凭证已被使用，请重新进入应用。",
    );
  }

  return error;
}

async function loadReusableSessionForVerifiedInitData(
  req: VercelRequest,
  verified: ReturnType<typeof verifyTelegramInitData>,
): Promise<{
  token: string;
  sessionId: string;
  expiresAt: string;
  userResult: AuthUpsertTelegramUserResult;
} | null> {
  const token = extractSessionToken(req);

  if (!token) {
    return null;
  }

  const tokenHash = hashSessionToken(token);
  const db = getSupabaseAdmin();
  const { data, error } = await db
    .schema("core")
    .from("app_sessions")
    .select("id,user_id,expires_at,revoked_at,init_data_hash")
    .eq("session_token_hash", tokenHash)
    .eq("init_data_hash", verified.initDataHash)
    .maybeSingle<ExistingSessionRow>();

  if (error) {
    throw new ApiError(500, "SESSION_LOOKUP_FAILED", "查询当前登录状态失败。", {
      cause: error,
      expose: false,
    });
  }

  if (!data || data.revoked_at || secondsUntil(data.expires_at) <= 0) {
    return null;
  }

  const user = await loadReusableSessionUser(db, data.user_id);

  if (!user) {
    return null;
  }

  if (String(user.telegram_user_id) !== String(verified.user.id)) {
    return null;
  }

  if (user.status !== "active") {
    throw ApiError.userBlocked("当前账号已被限制使用。", {
      status: user.status,
    });
  }

  return {
    token,
    sessionId: data.id,
    expiresAt: data.expires_at,
    userResult: {
      user_id: user.id,
      telegram_user_id: user.telegram_user_id,
      invite_code: user.invite_code,
    },
  };
}

async function loadReusableSessionUser(
  db: ReturnType<typeof getSupabaseAdmin>,
  userId: string,
): Promise<ReusableSessionUserRow | null> {
  const { data, error } = await db
    .schema("core")
    .from("users")
    .select("id,telegram_user_id,invite_code,status")
    .eq("id", userId)
    .maybeSingle<ReusableSessionUserRow>();

  if (error) {
    throw new ApiError(500, "USER_LOOKUP_FAILED", "查询用户状态失败。", {
      details: error,
      expose: false,
    });
  }

  return data ?? null;
}

function buildLoginResponse(input: {
  isNewUser: boolean;
  userId: string;
  userResult: AuthUpsertTelegramUserResult;
  verified: ReturnType<typeof verifyTelegramInitData>;
  sessionId: string;
  expiresAt: string;
  expiresInSeconds: number;
}) {
  return {
    status: "ok",
    isNewUser: input.isNewUser,
    user: {
      id: input.userId,
      telegramUserId: String(input.verified.user.id),
      username: input.verified.user.username ?? null,
      firstName: input.verified.user.first_name,
      lastName: input.verified.user.last_name ?? null,
      languageCode: input.verified.user.language_code ?? null,
      avatarUrl: input.verified.user.photo_url ?? null,
      inviteCode: input.userResult.invite_code ?? null,
    },
    session: {
      sessionId: input.sessionId,
      expiresAt: input.expiresAt,
      expiresInSeconds: input.expiresInSeconds,
      cookieBased: true,
    },
  };
}

function mapAuthUpsertTelegramUserError(error: unknown): unknown {
  const message = error instanceof Error ? error.message.toLowerCase() : "";

  if (message.includes("auth_user_not_active")) {
    const [, rawStatus] = message.match(/auth_user_not_active:([a-z_]+)/) ?? [];

    return ApiError.userBlocked("当前账号已被限制使用。", {
      status: rawStatus ?? "restricted",
    });
  }

  return error;
}

async function hasExistingTelegramUser(
  telegramUserId: number,
): Promise<boolean> {
  const db = getSupabaseAdmin();
  const { data, error } = await db
    .schema("core")
    .from("users")
    .select("id")
    .eq("telegram_user_id", telegramUserId)
    .maybeSingle<ExistingUserRow>();

  if (error) {
    throw new ApiError(500, "USER_LOOKUP_FAILED", "查询 Telegram 用户失败。", {
      details: error,
      expose: false,
    });
  }

  return Boolean(data);
}

async function loadAuthUser(userId: string): Promise<AuthUserRow> {
  const db = getSupabaseAdmin();
  const { data, error } = await db
    .schema("core")
    .from("users")
    .select("status")
    .eq("id", userId)
    .maybeSingle<AuthUserRow>();

  if (error) {
    throw new ApiError(500, "USER_LOOKUP_FAILED", "查询用户状态失败。", {
      details: error,
      expose: false,
    });
  }

  if (!data) {
    throw new ApiError(500, "USER_LOOKUP_FAILED", "登录用户不存在。", {
      expose: false,
    });
  }

  return data;
}

async function recordReferralStartParamRiskSignalsSafely(input: {
  db: ReturnType<typeof getSupabaseAdmin>;
  userId: string;
  startParam: string | null;
  requestId: string;
  sessionId: string;
  deviceId: string | null;
  ipHash: string | null;
  userAgentHash: string | null;
  platform: string | null;
}): Promise<void> {
  const startParam = input.startParam;

  if (!startParam) {
    return;
  }

  try {
    await recordReferralStartParamRiskSignals({
      ...input,
      startParam,
    });
  } catch (error) {
    console.error("[risk-event:referral-start-param-check-failed]", {
      requestId: input.requestId,
      userId: input.userId,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

async function recordReferralStartParamRiskSignals(input: {
  db: ReturnType<typeof getSupabaseAdmin>;
  userId: string;
  startParam: string;
  requestId: string;
  sessionId: string;
  deviceId: string | null;
  ipHash: string | null;
  userAgentHash: string | null;
  platform: string | null;
}): Promise<void> {
  const inviteCode = input.startParam.trim().toUpperCase();
  if (!inviteCode) {
    return;
  }

  const attemptedInviter = await loadReferralInviter(input.db, inviteCode);
  const currentReferral = await loadCurrentReferral(input.db, input.userId);

  if (attemptedInviter?.id === input.userId) {
    await recordRiskEventSafely({
      userId: input.userId,
      eventType: "referral_self_loop",
      sourceType: "referral_start_param",
      sourceId: null,
      detail: {
        request_id: input.requestId,
        action: "auth.telegram",
        reason: "self_invite_not_allowed",
        session_id: input.sessionId,
        invite_code: inviteCode,
      },
      idempotencyKey: `risk:referral_self_loop:auth:${input.userId}:${sha256Short(inviteCode)}`,
      context: {
        requestId: input.requestId,
        userId: input.userId,
      },
    });
    return;
  }

  if (
    currentReferral &&
    attemptedInviter &&
    currentReferral.inviter_user_id !== attemptedInviter.id
  ) {
    await recordRiskEventSafely({
      userId: input.userId,
      eventType: "referral_abuse",
      sourceType: "referral",
      sourceId: currentReferral.id,
      detail: {
        request_id: input.requestId,
        action: "auth.telegram",
        reason: "start_param_rebind_attempt",
        session_id: input.sessionId,
        referral_id: currentReferral.id,
        existing_inviter_user_id: currentReferral.inviter_user_id,
        attempted_inviter_user_id: attemptedInviter.id,
        attempted_invite_code: inviteCode,
        existing_invite_code: currentReferral.invite_code,
        referral_status: currentReferral.status,
      },
      idempotencyKey: `risk:referral_abuse:auth_rebind:${currentReferral.id}:${sha256Short(inviteCode)}`,
      context: {
        requestId: input.requestId,
        userId: input.userId,
        referralId: currentReferral.id,
      },
    });
  }

  if (!currentReferral) {
    return;
  }

  const inviterSessions = await loadRecentInviterSessions(
    input.db,
    currentReferral.inviter_user_id,
  );
  const match = findMatchingInviterSession(inviterSessions, input);

  if (!match) {
    return;
  }

  await recordRiskEventSafely({
    userId: input.userId,
    eventType: "referral_multi_account",
    sourceType: "referral",
    sourceId: currentReferral.id,
    detail: {
      request_id: input.requestId,
      action: "auth.telegram",
      reason: "same_server_device_fingerprint",
      session_id: input.sessionId,
      inviter_session_id: match.session.id,
      referral_id: currentReferral.id,
      inviter_user_id: currentReferral.inviter_user_id,
      invitee_user_id: currentReferral.invitee_user_id,
      matched_signals: match.signals,
      device_id: input.deviceId,
      ip_hash: input.ipHash,
      user_agent_hash: input.userAgentHash,
      platform: input.platform,
      inviter_platform: match.session.platform,
    },
    idempotencyKey: `risk:referral_multi_account:${currentReferral.id}:${sha256Short(
      [
        input.deviceId,
        input.ipHash,
        input.userAgentHash,
        match.session.id,
      ].join(":"),
    )}`,
    context: {
      requestId: input.requestId,
      userId: input.userId,
      referralId: currentReferral.id,
    },
  });
}

async function loadReferralInviter(
  db: ReturnType<typeof getSupabaseAdmin>,
  inviteCode: string,
): Promise<ReferralInviterRow | null> {
  const { data, error } = await db
    .schema("core")
    .from("users")
    .select("id,invite_code")
    .eq("invite_code", inviteCode)
    .maybeSingle<ReferralInviterRow>();

  if (error) {
    throw new ApiError(
      500,
      "REFERRAL_INVITER_LOOKUP_FAILED",
      "查询邀请人失败。",
      {
        expose: false,
        cause: error,
      },
    );
  }

  return data ?? null;
}

async function loadCurrentReferral(
  db: ReturnType<typeof getSupabaseAdmin>,
  userId: string,
): Promise<ReferralSignalRow | null> {
  const { data, error } = await db
    .schema("tasks")
    .from("referrals")
    .select("id,inviter_user_id,invitee_user_id,invite_code,status")
    .eq("invitee_user_id", userId)
    .maybeSingle<ReferralSignalRow>();

  if (error) {
    throw new ApiError(500, "REFERRAL_LOOKUP_FAILED", "查询邀请关系失败。", {
      expose: false,
      cause: error,
    });
  }

  return data ?? null;
}

async function loadRecentInviterSessions(
  db: ReturnType<typeof getSupabaseAdmin>,
  inviterUserId: string,
): Promise<AppSessionSignalRow[]> {
  const { data, error } = await db
    .schema("core")
    .from("app_sessions")
    .select("id,ip_hash,user_agent,device_id,platform,created_at")
    .eq("user_id", inviterUserId)
    .order("created_at", { ascending: false })
    .limit(20);

  if (error) {
    throw new ApiError(
      500,
      "REFERRAL_INVITER_SESSION_LOOKUP_FAILED",
      "查询邀请人会话失败。",
      {
        expose: false,
        cause: error,
      },
    );
  }

  return Array.isArray(data) ? (data as unknown as AppSessionSignalRow[]) : [];
}

function findMatchingInviterSession(
  sessions: AppSessionSignalRow[],
  input: {
    deviceId: string | null;
    ipHash: string | null;
    userAgentHash: string | null;
  },
): { session: AppSessionSignalRow; signals: string[] } | null {
  for (const session of sessions) {
    const signals: string[] = [];

    if (input.deviceId && session.device_id === input.deviceId) {
      signals.push("device_id");
    }

    if (
      input.ipHash &&
      input.userAgentHash &&
      session.ip_hash === input.ipHash &&
      session.user_agent === input.userAgentHash
    ) {
      signals.push("ip_hash", "user_agent_hash");
    }

    if (signals.length > 0) {
      return {
        session,
        signals,
      };
    }
  }

  return null;
}

function getSafeUserAgent(req: VercelRequest): string | null {
  const value = getHeaderValue(req.headers["user-agent"]);

  if (!value) {
    return null;
  }

  return value.slice(0, 1024);
}

function hashNullableFingerprint(
  namespace: string,
  value: string | null,
): string | null {
  return value ? hashFingerprint(namespace, value) : null;
}

function hashFingerprint(namespace: string, value: string): string {
  return hashClientFingerprint(value, namespace);
}

function buildServerDeviceId(input: {
  ipHash: string | null;
  userAgentHash: string | null;
  platform: string | null;
}): string | null {
  if (!input.ipHash || !input.userAgentHash) {
    return null;
  }

  return hashFingerprint(
    "device",
    [input.ipHash, input.userAgentHash, input.platform ?? "unknown"].join(":"),
  );
}

function sha256Short(value: string): string {
  return hashFingerprint("risk", value).slice(0, 24);
}

function requireStringField<T extends Record<string, unknown>>(
  value: T,
  field: keyof T,
): string {
  const fieldValue = value[field];

  if (typeof fieldValue !== "string" || fieldValue.trim().length === 0) {
    throw new ApiError(
      500,
      "RPC_RESULT_INVALID",
      `RPC 返回缺少字段 ${String(field)}。`,
      {
        details: {
          field: String(field),
        },
        expose: false,
      },
    );
  }

  return fieldValue;
}
