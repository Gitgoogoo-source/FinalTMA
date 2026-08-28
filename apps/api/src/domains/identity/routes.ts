import { rpc } from "../../platform/db/index.ts";
import { getEnv } from "../../platform/env/index.ts";
import { errorDefinition } from "@evomypet/api-contracts/common";
import {
  parseRouteOutput,
  type RouteOutput,
} from "@evomypet/api-contracts/app";
import {
  hashToken,
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

const TG_APP_LISTING_START_PARAM = "listed_on_tg_app";

export const identityHandlers = {
  "identity.authenticate": async (context) => {
    const initData = String(context.input.init_data);
    const operationId = requireOperationId(context);
    await rpc("identity_consume_login_source_rate_limit", {
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
    const entry = classifyEntry(verified.startParam ?? null);
    const issued = issueToken(operationId);
    const result = await rpc<IdentityAuthenticationResult>(
      "identity_authenticate",
      {
        p_operation_id: operationId,
        p_request_hash: identityFingerprint(
          "login-request",
          verified.initDataHash,
        ),
        p_user_key_hash: identityFingerprint(
          "login-user",
          String(verified.user.id),
        ),
        p_init_data_key_hash: identityFingerprint(
          "login-init-data",
          verified.initDataHash,
        ),
        p_telegram_id: verified.user.id,
        p_username: verified.user.username ?? null,
        p_first_name: verified.user.first_name,
        p_last_name: verified.user.last_name ?? null,
        p_language_code: verified.user.language_code ?? null,
        p_referral_code: referralCode(verified.user.id),
        p_session_id: issued.sessionId,
        p_token_hash: issued.hash,
        p_auth_date: verified.authDate.toISOString(),
        p_entry_kind: entry.kind,
        p_entry_referral_code: entry.referralCode,
        p_battle_invite_token_hash: entry.battleInviteTokenHash,
      },
    );
    if ("error_code" in result) throw loginResultError(result.error_code);
    if (result.account_status === "banned")
      return { data: { account_status: "banned" as const } };
    if (
      result.session_id !== issued.sessionId ||
      !result.user_id ||
      !result.preferred_language ||
      !result.expires_at ||
      !result.entry_handoff_state ||
      !result.entry_kind
    )
      throw new ApiError(500, "INTERNAL_ERROR", "登录结果不完整", true);
    let initialState: RouteOutput<"identity.initial"> | null = null;
    if (result.entry_handoff_state === "complete") {
      try {
        const initial = await rpc<unknown>("identity_initial", {
          p_session_id: issued.sessionId,
        });
        initialState = parseRouteOutput("identity.initial", initial);
      } catch (cause) {
        if (isStableInitialStateFailure(cause)) throw cause;
      }
    }
    return {
      data: {
        account_status: "normal" as const,
        access_token: issued.token,
        user_id: result.user_id,
        preferred_language: result.preferred_language,
        expires_at: result.expires_at,
        entry_kind: result.entry_kind,
        entry_handoff_state: result.entry_handoff_state,
        entry_handoff_code: result.entry_handoff_code ?? null,
        entry_handoff_result: result.entry_handoff_result ?? null,
        initial_state: initialState,
      },
    };
  },
  "identity.initial": async (context) => ({
    data: await rpc("identity_initial", {
      p_session_id: requireSession(context).session_id,
    }),
  }),
  "identity.summary": async (context) => ({
    data: await rpc("identity_summary", {
      p_session_id: requireSession(context).session_id,
    }),
  }),
  "identity.language.update": async (context) => ({
    data: await rpc("identity_set_preferred_language", {
      p_session_id: requireSession(context).session_id,
      p_preferred_language: context.input.preferred_language,
    }),
  }),
} satisfies HandlerMap;

function classifyEntry(startParam: string | null): {
  kind: "direct" | "referral" | "battle" | "invalid";
  referralCode: string | null;
  battleInviteTokenHash: string | null;
} {
  if (startParam === null || startParam === TG_APP_LISTING_START_PARAM)
    return {
      kind: "direct",
      referralCode: null,
      battleInviteTokenHash: null,
    };
  if (/^TMA[A-F0-9]{20}$/.test(startParam))
    return {
      kind: "referral",
      referralCode: startParam,
      battleInviteTokenHash: null,
    };
  if (/^BTL_[A-Za-z0-9_-]{32}$/.test(startParam))
    return {
      kind: "battle",
      referralCode: null,
      battleInviteTokenHash: hashToken(startParam),
    };
  return {
    kind: "invalid",
    referralCode: null,
    battleInviteTokenHash: null,
  };
}

type IdentityAuthenticationResult =
  | {
      error_code:
        | "RATE_LIMITED"
        | "IDEMPOTENCY_KEY_REUSED"
        | "TELEGRAM_START_PARAM_INVALID";
    }
  | { account_status: "banned" }
  | {
      account_status: "normal";
      session_id: string;
      user_id: string;
      preferred_language: "en" | "zh-CN";
      expires_at: string;
      entry_kind: "direct" | "referral" | "battle";
      entry_handoff_state: "pending" | "complete";
      entry_handoff_code: string | null;
      entry_handoff_result:
        | "REFERRAL_BOUND"
        | "REFERRAL_ALREADY_BOUND"
        | "REFERRAL_ALREADY_RECHARGED"
        | "REFERRAL_CANDIDATE_EXPIRED"
        | "REFERRAL_CODE_INVALID"
        | "REFERRAL_INELIGIBLE"
        | "REFERRAL_INVITER_UNAVAILABLE"
        | "REFERRAL_OLD_USER"
        | "REFERRAL_SELF_BIND"
        | null;
    };

const stableInitialStateErrors = new Set([
  "SESSION_REQUIRED",
  "SESSION_EXPIRED",
  "SESSION_REPLACED",
  "ACCOUNT_RESTRICTED",
  "ENTRY_HANDOFF_PENDING",
]);

function isStableInitialStateFailure(cause: unknown): boolean {
  return cause instanceof ApiError && stableInitialStateErrors.has(cause.code);
}

function loginResultError(
  code:
    | "RATE_LIMITED"
    | "IDEMPOTENCY_KEY_REUSED"
    | "TELEGRAM_START_PARAM_INVALID",
): ApiError {
  const definition = errorDefinition(code);
  return new ApiError(
    definition.status,
    code,
    definition.message,
    definition.retryable,
  );
}

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
