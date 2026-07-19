import { rpc } from "../../platform/db/index.ts";
import { getEnv } from "../../platform/env/index.ts";
import {
  identityFingerprint,
  issueToken,
  referralCode,
} from "../../platform/session.ts";
import {
  TelegramInitDataValidationError,
  verifyTelegramInitData,
} from "../../platform/telegram/initData.ts";
import { ApiError } from "../../http/errors.ts";
import {
  requireOperationId,
  requireSession,
  type HandlerMap,
} from "../../http/handlers.ts";

export const identityHandlers = {
  "identity.authenticate": async (context) => {
    const initData = String(context.input.init_data);
    const operationId = requireOperationId(context);
    await rpc("identity_consume_login_rate_limit", {
      p_scope: "source",
      p_key_hash: identityFingerprint(
        "login-source",
        requestSource(context.request),
      ),
    });
    let verified;
    try {
      verified = verifyTelegramInitData(initData, {
        botToken: getEnv().TELEGRAM_BOT_TOKEN,
      });
    } catch (cause) {
      throw telegramValidationError(cause);
    }
    if (verified.user.is_bot)
      throw new ApiError(
        401,
        "TELEGRAM_INIT_DATA_INVALID",
        "Telegram 登录信息无效",
      );
    await rpc("identity_consume_login_rate_limit", {
      p_scope: "user",
      p_key_hash: identityFingerprint("login-user", String(verified.user.id)),
    });
    await rpc("identity_consume_login_rate_limit", {
      p_scope: "init_data",
      p_key_hash: identityFingerprint("login-init-data", verified.initDataHash),
    });
    const startParam = verified.startParam ?? null;
    if (startParam !== null && !/^TMA[A-F0-9]{20}$/.test(startParam))
      throw new ApiError(
        400,
        "TELEGRAM_START_PARAM_INVALID",
        "入口参数无效，请重新从 Telegram 进入应用",
      );
    const issued = issueToken(operationId);
    const session = await rpc<{
      account_status: "normal" | "banned";
      user_id?: string;
      expires_at?: string;
      start_param?: string | null;
    }>("identity_authenticate", {
      p_operation_id: operationId,
      p_request_hash: identityFingerprint(
        "login-request",
        verified.initDataHash,
      ),
      p_telegram_id: verified.user.id,
      p_username: verified.user.username ?? null,
      p_first_name: verified.user.first_name,
      p_last_name: verified.user.last_name ?? null,
      p_language_code: verified.user.language_code ?? null,
      p_photo_url: verified.user.photo_url ?? null,
      p_referral_code: referralCode(verified.user.id),
      p_token_hash: issued.hash,
      p_auth_date: verified.authDate.toISOString(),
      p_start_param: startParam,
    });
    if (session.account_status === "banned")
      return { data: { account_status: "banned" as const } };
    if (!session.user_id || !session.expires_at)
      throw new ApiError(500, "INTERNAL_ERROR", "登录结果不完整", true);
    return {
      data: {
        account_status: "normal" as const,
        access_token: issued.token,
        user_id: session.user_id,
        expires_at: session.expires_at,
        start_param: session.start_param ?? null,
      },
    };
  },
  "identity.bootstrap": async (context) => ({
    data: await rpc("identity_bootstrap", {
      p_session_id: requireSession(context).session_id,
    }),
  }),
} satisfies HandlerMap;

function requestSource(request: Request): string {
  const vercel = firstForwardedValue(
    request.headers.get("x-vercel-forwarded-for"),
  );
  if (vercel) return vercel;
  if (getEnv().APP_ENV === "production") return "missing-vercel-source";
  return (
    firstForwardedValue(request.headers.get("x-forwarded-for")) ??
    request.headers.get("x-real-ip")?.trim() ??
    "unknown-source"
  );
}

function firstForwardedValue(value: string | null): string | null {
  return value?.split(",", 1)[0]?.trim() || null;
}

function telegramValidationError(cause: unknown): ApiError {
  if (!(cause instanceof TelegramInitDataValidationError))
    return new ApiError(500, "INTERNAL_ERROR", "服务暂时不可用", true);
  if (cause.code === "BOT_TOKEN_MISSING")
    return new ApiError(500, "INTERNAL_ERROR", "服务暂时不可用", true);
  if (cause.code === "AUTH_DATE_EXPIRED")
    return new ApiError(
      401,
      "TELEGRAM_INIT_DATA_EXPIRED",
      "Telegram 登录信息已过期",
    );
  if (
    [
      "AUTH_DATE_MISSING",
      "AUTH_DATE_INVALID",
      "AUTH_DATE_FROM_FUTURE",
    ].includes(cause.code)
  )
    return new ApiError(
      401,
      "TELEGRAM_INIT_DATA_TIME_INVALID",
      "Telegram 登录凭证时间无效，请重新进入应用",
    );
  return new ApiError(
    401,
    "TELEGRAM_INIT_DATA_INVALID",
    "Telegram 登录信息无效",
  );
}
