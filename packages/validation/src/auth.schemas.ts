import { z } from "zod";

/**
 * auth.schemas.ts
 *
 * 责任：
 * 1. 校验 Telegram Mini App 登录请求。
 * 2. 校验 Telegram initDataUnsafe 的前端辅助结构。
 * 3. 校验 session refresh / logout / admin login 请求。
 * 4. 定义 auth API 返回结构。
 *
 * 安全原则：
 * - initDataUnsafe 只允许用于前端展示或辅助排错，不能作为可信身份来源。
 * - 后端必须使用原始 initData + Bot Token 做签名验证。
 * - user_id、telegram_user_id、wallet address 等敏感身份字段不能从前端 body 信任。
 */

const TELEGRAM_START_PARAM_RE = /^[A-Za-z0-9_-]{1,512}$/;
const TELEGRAM_USERNAME_RE = /^@?[A-Za-z0-9_]{5,32}$/;
const REFERRAL_CODE_RE = /^[A-Za-z0-9_-]{1,64}$/;
const SESSION_TOKEN_RE = /^[-A-Za-z0-9._~:]{24,512}$/;
const ISO_DATE_TIME_RE =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?(?:Z|[+-]\d{2}:\d{2})$/;

const blankToUndefined = (value: unknown): unknown => {
  if (value === "" || value === null) return undefined;
  return value;
};

const AuthIsoDateTimeSchema = z
  .string()
  .trim()
  .regex(ISO_DATE_TIME_RE, "Expected ISO 8601 datetime with timezone.");

const AuthUuidSchema = z.string().uuid();

const AuthOptionalUrlSchema = z.preprocess(
  blankToUndefined,
  z.string().trim().url().max(2048).optional(),
);

const AuthUnixSecondsSchema = z.preprocess(
  blankToUndefined,
  z.coerce.number().int().min(0).max(4102444800).optional(),
);

const AuthTelegramIdSchema = z
  .union([
    z.number().int().positive(),
    z.string().trim().regex(/^\d{1,20}$/, "Telegram id must be a numeric string."),
  ])
  .transform((value) => String(value));

const AuthSafeTextSchema = z
  .string()
  .trim()
  .min(1)
  .max(256);

const AuthOptionalSafeTextSchema = z.preprocess(
  blankToUndefined,
  z.string().trim().min(1).max(256).optional(),
);

export const AuthTelegramUsernameSchema = z
  .string()
  .trim()
  .regex(
    TELEGRAM_USERNAME_RE,
    "Telegram username must be 5-32 characters and may contain letters, numbers and underscore.",
  )
  .transform((value) => (value.startsWith("@") ? value.slice(1) : value));

export const AuthReferralCodeSchema = z
  .string()
  .trim()
  .regex(REFERRAL_CODE_RE, "Invalid referral code.");

export const AuthStartParamSchema = z
  .string()
  .trim()
  .regex(TELEGRAM_START_PARAM_RE, "Invalid Telegram start_param.");

export const AuthSessionTokenSchema = z
  .string()
  .trim()
  .regex(SESSION_TOKEN_RE, "Invalid session token.");

export const AuthTelegramChatTypeSchema = z.enum([
  "sender",
  "private",
  "group",
  "supergroup",
  "channel",
]);

export const AuthUserStatusSchema = z.enum([
  "active",
  "blocked",
  "deleted",
  "risk_limited",
]);

export const AuthSessionStatusSchema = z.enum([
  "active",
  "expired",
  "revoked",
]);

export const AuthClientThemeSchema = z.enum([
  "light",
  "dark",
]);

export const AuthLaunchSourceSchema = z.enum([
  "direct",
  "start_param",
  "referral",
  "group",
  "unknown",
]);

export const AuthTelegramUserSchema = z
  .object({
    id: AuthTelegramIdSchema,
    is_bot: z.boolean().optional(),
    first_name: z.string().trim().min(1).max(128),
    last_name: z.preprocess(
      blankToUndefined,
      z.string().trim().min(1).max(128).optional(),
    ),
    username: z.preprocess(
      blankToUndefined,
      AuthTelegramUsernameSchema.optional(),
    ),
    language_code: z.preprocess(
      blankToUndefined,
      z
        .string()
        .trim()
        .min(2)
        .max(32)
        .regex(/^[A-Za-z0-9_-]+$/, "Invalid language code.")
        .optional(),
    ),
    is_premium: z.boolean().optional(),
    allows_write_to_pm: z.boolean().optional(),
    added_to_attachment_menu: z.boolean().optional(),
    photo_url: AuthOptionalUrlSchema,
  })
  .passthrough();

export const AuthTelegramChatSchema = z
  .object({
    id: AuthTelegramIdSchema,
    type: AuthTelegramChatTypeSchema,
    title: AuthOptionalSafeTextSchema,
    username: z.preprocess(
      blankToUndefined,
      AuthTelegramUsernameSchema.optional(),
    ),
    photo_url: AuthOptionalUrlSchema,
  })
  .passthrough();

/**
 * 前端传来的 initDataUnsafe 只能辅助展示，不能用于最终鉴权。
 * 后端必须验证原始 initData 的 hash / signature。
 */
export const AuthTelegramInitDataUnsafeSchema = z
  .object({
    query_id: z.preprocess(
      blankToUndefined,
      z.string().trim().min(1).max(256).optional(),
    ),
    user: AuthTelegramUserSchema.optional(),
    receiver: AuthTelegramUserSchema.optional(),
    chat: AuthTelegramChatSchema.optional(),
    chat_type: AuthTelegramChatTypeSchema.optional(),
    chat_instance: z.preprocess(
      blankToUndefined,
      z.string().trim().min(1).max(256).optional(),
    ),
    start_param: z.preprocess(
      blankToUndefined,
      AuthStartParamSchema.optional(),
    ),
    can_send_after: AuthUnixSecondsSchema,
    auth_date: AuthUnixSecondsSchema,
    hash: z.preprocess(
      blankToUndefined,
      z.string().trim().min(32).max(256).optional(),
    ),
    signature: z.preprocess(
      blankToUndefined,
      z.string().trim().min(16).max(512).optional(),
    ),
  })
  .passthrough();

export const AuthClientContextSchema = z
  .object({
    platform: z.preprocess(
      blankToUndefined,
      z
        .string()
        .trim()
        .min(1)
        .max(32)
        .regex(/^[A-Za-z0-9_-]+$/, "Invalid platform.")
        .optional(),
    ),
    theme: AuthClientThemeSchema.optional(),
    appVersion: z.preprocess(
      blankToUndefined,
      z.string().trim().min(1).max(64).optional(),
    ),
    launchSource: AuthLaunchSourceSchema.optional(),
    viewportHeight: z.number().int().positive().max(5000).optional(),
    viewportStableHeight: z.number().int().positive().max(5000).optional(),
    colorScheme: AuthClientThemeSchema.optional(),
    userAgent: z.preprocess(
      blankToUndefined,
      z.string().trim().min(1).max(1024).optional(),
    ),
    ipHash: z.preprocess(
      blankToUndefined,
      z.string().trim().min(16).max(128).optional(),
    ),
  })
  .strict();

export const AuthTelegramLoginRequestSchema = z
  .object({
    /**
     * Telegram WebApp.initData 原始字符串。
     * 后端用它做签名验证。
     */
    initData: z.string().trim().min(1).max(12000),

    /**
     * 仅用于前端调试、辅助展示、日志排查。
     * 不能作为可信身份来源。
     */
    initDataUnsafe: AuthTelegramInitDataUnsafeSchema.optional(),

    /**
     * Telegram deep link 进入时的 start_param。
     */
    startParam: z.preprocess(
      blankToUndefined,
      AuthStartParamSchema.optional(),
    ),

    /**
     * 业务邀请 code。
     * 可以从 startParam 中解析，也可以由前端显式传入。
     */
    referralCode: z.preprocess(
      blankToUndefined,
      AuthReferralCodeSchema.optional(),
    ),

    clientContext: AuthClientContextSchema.optional(),
  })
  .strict();

export const AuthRefreshSessionRequestSchema = z
  .object({
    /**
     * 如果使用 HttpOnly Cookie，可以不传 sessionToken。
     * 如果使用 Authorization Bearer，可以传入 sessionToken。
     */
    sessionToken: z.preprocess(
      blankToUndefined,
      AuthSessionTokenSchema.optional(),
    ),
    clientContext: AuthClientContextSchema.optional(),
  })
  .strict();

export const AuthLogoutRequestSchema = z
  .object({
    sessionToken: z.preprocess(
      blankToUndefined,
      AuthSessionTokenSchema.optional(),
    ),
    allDevices: z.boolean().optional().default(false),
  })
  .strict();

export const AuthVerifySessionRequestSchema = z
  .object({
    sessionToken: AuthSessionTokenSchema,
  })
  .strict();

export const AuthAdminLoginRequestSchema = z
  .object({
    email: z
      .string()
      .trim()
      .min(3)
      .max(254)
      .email()
      .transform((value) => value.toLowerCase()),
    password: z.string().min(8).max(256),
    otpCode: z.preprocess(
      blankToUndefined,
      z
        .string()
        .trim()
        .regex(/^\d{6}$/, "OTP code must be 6 digits.")
        .optional(),
    ),
    rememberMe: z.boolean().optional().default(false),
  })
  .strict();

export const AuthTelegramStartPayloadRequestSchema = z
  .object({
    telegramUserId: AuthTelegramIdSchema,
    startParam: z.preprocess(
      blankToUndefined,
      AuthStartParamSchema.optional(),
    ),
    referralCode: z.preprocess(
      blankToUndefined,
      AuthReferralCodeSchema.optional(),
    ),
  })
  .strict();

export const AuthSessionUserSchema = z
  .object({
    userId: AuthUuidSchema,
    telegramUserId: z.string().trim().regex(/^\d{1,20}$/),
    status: AuthUserStatusSchema,
    firstName: AuthSafeTextSchema,
    lastName: AuthOptionalSafeTextSchema,
    username: z.preprocess(
      blankToUndefined,
      AuthTelegramUsernameSchema.optional(),
    ),
    languageCode: z.preprocess(
      blankToUndefined,
      z.string().trim().min(2).max(32).optional(),
    ),
    photoUrl: AuthOptionalUrlSchema,
    isPremium: z.boolean().optional().default(false),
    createdAt: AuthIsoDateTimeSchema,
    updatedAt: AuthIsoDateTimeSchema,
  })
  .strict();

export const AuthSessionSchema = z
  .object({
    sessionId: AuthUuidSchema,
    status: AuthSessionStatusSchema,
    issuedAt: AuthIsoDateTimeSchema,
    expiresAt: AuthIsoDateTimeSchema,

    /**
     * 使用 HttpOnly Cookie 时，后端可以不返回 accessToken。
     * 使用 Bearer Token 时，后端可以返回 accessToken。
     */
    accessToken: z.preprocess(
      blankToUndefined,
      AuthSessionTokenSchema.optional(),
    ),

    cookieBased: z.boolean().default(true),
  })
  .strict();

export const AuthReferralBindingSchema = z
  .object({
    referralCode: z.preprocess(
      blankToUndefined,
      AuthReferralCodeSchema.optional(),
    ),
    inviterUserId: z.preprocess(
      blankToUndefined,
      AuthUuidSchema.optional(),
    ),
    status: z.enum([
      "none",
      "pending",
      "bound",
      "invalid",
      "self_referral_rejected",
    ]),
  })
  .strict();

export const AuthTelegramLoginResponseSchema = z
  .object({
    status: z.literal("ok"),
    isNewUser: z.boolean(),
    user: AuthSessionUserSchema,
    session: AuthSessionSchema,
    referral: AuthReferralBindingSchema.optional(),
  })
  .strict();

export const AuthRefreshSessionResponseSchema = z
  .object({
    status: z.literal("ok"),
    user: AuthSessionUserSchema,
    session: AuthSessionSchema,
  })
  .strict();

export const AuthLogoutResponseSchema = z
  .object({
    status: z.literal("ok"),
    revokedSessionCount: z.number().int().nonnegative(),
  })
  .strict();

export const AuthAdminUserSchema = z
  .object({
    adminUserId: AuthUuidSchema,
    email: z.string().trim().email(),
    displayName: z.string().trim().min(1).max(128),
    roles: z.array(z.string().trim().min(1).max(64)).max(32),
    permissions: z.array(z.string().trim().min(1).max(128)).max(256),
    createdAt: AuthIsoDateTimeSchema,
    updatedAt: AuthIsoDateTimeSchema,
  })
  .strict();

export const AuthAdminLoginResponseSchema = z
  .object({
    status: z.literal("ok"),
    adminUser: AuthAdminUserSchema,
    session: AuthSessionSchema,
  })
  .strict();

export const AuthErrorCodeSchema = z.enum([
  "AUTH_INIT_DATA_REQUIRED",
  "AUTH_INIT_DATA_INVALID",
  "AUTH_INIT_DATA_EXPIRED",
  "AUTH_SESSION_REQUIRED",
  "AUTH_SESSION_INVALID",
  "AUTH_SESSION_EXPIRED",
  "AUTH_USER_BLOCKED",
  "AUTH_USER_RISK_LIMITED",
  "AUTH_ADMIN_REQUIRED",
  "AUTH_ADMIN_PERMISSION_DENIED",
]);

export const AuthErrorResponseSchema = z
  .object({
    status: z.literal("error"),
    code: AuthErrorCodeSchema,
    message: z.string().trim().min(1).max(512),
    requestId: z.string().trim().min(1).max(128).optional(),
  })
  .strict();

export const parseAuthTelegramLoginRequest = (input: unknown) =>
  AuthTelegramLoginRequestSchema.parse(input);

export const parseAuthRefreshSessionRequest = (input: unknown) =>
  AuthRefreshSessionRequestSchema.parse(input);

export const parseAuthLogoutRequest = (input: unknown) =>
  AuthLogoutRequestSchema.parse(input);

export const parseAuthAdminLoginRequest = (input: unknown) =>
  AuthAdminLoginRequestSchema.parse(input);

export type AuthTelegramUsername = z.infer<typeof AuthTelegramUsernameSchema>;
export type AuthReferralCode = z.infer<typeof AuthReferralCodeSchema>;
export type AuthStartParam = z.infer<typeof AuthStartParamSchema>;
export type AuthSessionToken = z.infer<typeof AuthSessionTokenSchema>;
export type AuthTelegramUser = z.infer<typeof AuthTelegramUserSchema>;
export type AuthTelegramChat = z.infer<typeof AuthTelegramChatSchema>;
export type AuthTelegramInitDataUnsafe = z.infer<
  typeof AuthTelegramInitDataUnsafeSchema
>;
export type AuthClientContext = z.infer<typeof AuthClientContextSchema>;
export type AuthTelegramLoginRequest = z.infer<
  typeof AuthTelegramLoginRequestSchema
>;
export type AuthRefreshSessionRequest = z.infer<
  typeof AuthRefreshSessionRequestSchema
>;
export type AuthLogoutRequest = z.infer<typeof AuthLogoutRequestSchema>;
export type AuthVerifySessionRequest = z.infer<
  typeof AuthVerifySessionRequestSchema
>;
export type AuthAdminLoginRequest = z.infer<typeof AuthAdminLoginRequestSchema>;
export type AuthTelegramStartPayloadRequest = z.infer<
  typeof AuthTelegramStartPayloadRequestSchema
>;
export type AuthSessionUser = z.infer<typeof AuthSessionUserSchema>;
export type AuthSession = z.infer<typeof AuthSessionSchema>;
export type AuthReferralBinding = z.infer<typeof AuthReferralBindingSchema>;
export type AuthTelegramLoginResponse = z.infer<
  typeof AuthTelegramLoginResponseSchema
>;
export type AuthRefreshSessionResponse = z.infer<
  typeof AuthRefreshSessionResponseSchema
>;
export type AuthLogoutResponse = z.infer<typeof AuthLogoutResponseSchema>;
export type AuthAdminUser = z.infer<typeof AuthAdminUserSchema>;
export type AuthAdminLoginResponse = z.infer<
  typeof AuthAdminLoginResponseSchema
>;
export type AuthErrorCode = z.infer<typeof AuthErrorCodeSchema>;
export type AuthErrorResponse = z.infer<typeof AuthErrorResponseSchema>;