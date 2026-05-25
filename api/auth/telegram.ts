import { createHash, randomBytes } from "node:crypto";
import type { VercelRequest } from "@vercel/node";
import {
  AuthTelegramLoginRequestSchema,
  type AuthTelegramLoginRequest,
} from "../../packages/validation/src/auth.schemas.js";
import {
  buildSessionCookie,
  SESSION_COOKIE_NAME,
  type BuildSessionCookieOptions,
} from "../../packages/server/src/auth/issueSession.js";
import {
  TelegramInitDataValidationError,
  verifyTelegramInitData,
} from "../../packages/server/src/auth/verifyTelegramInitData.js";
import { callRpcRaw } from "../../packages/server/src/db/rpc.js";
import {
  ApiError,
  getHeaderValue,
  withApiHandler,
} from "../_shared/handler.js";
import { parseJsonBody } from "../_shared/parseBody.js";
import {
  getSupabaseAdmin,
  hashSessionToken,
} from "../_shared/requireSession.js";
import { validate } from "../_shared/validate.js";

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

type AuthUserRow = {
  status: string;
};

const SESSION_TTL_SECONDS = 7 * 24 * 60 * 60;

export default withApiHandler(
  async (req, res, ctx) => {
    const body = await parseJsonBody<unknown>(req, {
      maxBytes: 16 * 1024,
    });
    const input = validate(AuthTelegramLoginRequestSchema, body);
    const verified = verifyTrustedInitData(input);
    const wasExistingUser = await hasExistingTelegramUser(verified.user.id);

    const userResult = await callRpcRaw<AuthUpsertTelegramUserResult>(
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
          requestId: ctx.requestId,
          telegramUserId: String(verified.user.id),
        },
      },
    );

    const userId = requireStringField(userResult, "user_id");
    const authUser = await loadAuthUser(userId);

    if (authUser.status !== "active") {
      throw ApiError.userBlocked("当前账号已被限制使用。", {
        details: {
          status: authUser.status,
        },
      });
    }

    const token = createOpaqueSessionToken();
    const tokenHash = hashSessionToken(token);
    const expiresAt = new Date(Date.now() + SESSION_TTL_SECONDS * 1000);

    const sessionResult = await callRpcRaw<AuthCreateSessionResult>(
      "auth_create_session",
      {
        p_user_id: userId,
        p_session_token_hash: tokenHash,
        p_expires_at: expiresAt.toISOString(),
        p_telegram_auth_date: verified.authDate.toISOString(),
        p_init_data_hash: verified.initDataHash,
        p_ip_hash: ctx.ip ? hashFingerprint("ip", ctx.ip) : null,
        p_user_agent: hashNullableFingerprint(
          "user_agent",
          getSafeUserAgent(req),
        ),
        p_device_id: null,
        p_platform: input.clientContext?.platform ?? null,
      },
      {
        schema: "api" as never,
        context: {
          requestId: ctx.requestId,
          userId,
        },
      },
    );

    const sessionId = requireStringField(sessionResult, "session_id");
    const sessionExpiresAt = requireStringField(sessionResult, "expires_at");

    const cookieOptions: BuildSessionCookieOptions = {
      cookieName: getSessionCookieName(),
      maxAgeSeconds: SESSION_TTL_SECONDS,
      sameSite: getSessionCookieSameSite(),
      secure: getSessionCookieSecure(),
    };
    const cookieDomain = getSessionCookieDomain();

    if (cookieDomain !== undefined) {
      cookieOptions.domain = cookieDomain;
    }

    res.setHeader("Set-Cookie", buildSessionCookie(token, cookieOptions));

    return {
      status: "ok",
      isNewUser: !wasExistingUser,
      user: {
        id: userId,
        telegramUserId: String(verified.user.id),
        username: verified.user.username ?? null,
        firstName: verified.user.first_name,
        lastName: verified.user.last_name ?? null,
        languageCode: verified.user.language_code ?? null,
        avatarUrl: verified.user.photo_url ?? null,
        inviteCode: userResult.invite_code ?? null,
      },
      session: {
        sessionId,
        expiresAt: sessionExpiresAt,
        expiresInSeconds: SESSION_TTL_SECONDS,
        cookieBased: true,
      },
    };
  },
  {
    methods: ["POST"],
    rateLimit: {
      action: "auth.telegram",
    },
  },
);

function verifyTrustedInitData(input: AuthTelegramLoginRequest) {
  try {
    return verifyTelegramInitData(input.initData);
  } catch (error) {
    if (error instanceof TelegramInitDataValidationError) {
      throw new ApiError(
        401,
        "AUTH_INIT_DATA_INVALID",
        "Telegram 登录校验失败。",
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

function createOpaqueSessionToken(): string {
  return `tma_sess_v1.${randomBytes(48).toString("base64url")}`;
}

function getSessionCookieName(): string {
  return process.env.SESSION_COOKIE_NAME?.trim() || SESSION_COOKIE_NAME;
}

function getSessionCookieDomain(): string | undefined {
  const domain = process.env.SESSION_COOKIE_DOMAIN?.trim();
  return domain || undefined;
}

function getSessionCookieSameSite(): "Lax" | "Strict" | "None" {
  const raw = process.env.SESSION_COOKIE_SAMESITE?.trim().toLowerCase();

  if (raw === "strict") {
    return "Strict";
  }

  if (raw === "none") {
    return "None";
  }

  return "Lax";
}

function getSessionCookieSecure(): boolean {
  const raw = process.env.SESSION_COOKIE_SECURE?.trim().toLowerCase();

  if (raw === "true" || raw === "1" || raw === "yes") {
    return true;
  }

  if (raw === "false" || raw === "0" || raw === "no") {
    return false;
  }

  return isProductionLikeRuntime();
}

function isProductionLikeRuntime(): boolean {
  return (
    process.env.APP_ENV === "production" ||
    process.env.NODE_ENV === "production" ||
    process.env.VERCEL_ENV === "production"
  );
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
  return createHash("sha256")
    .update(`${namespace}:${value}`, "utf8")
    .digest("hex");
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
