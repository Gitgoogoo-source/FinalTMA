// packages/server/src/auth/verifyTelegramInitData.ts

import { createHmac, timingSafeEqual } from "node:crypto";

export type TelegramInitDataErrorCode =
  | "INIT_DATA_EMPTY"
  | "INIT_DATA_INVALID_QUERY"
  | "INIT_DATA_DUPLICATE_KEY"
  | "BOT_TOKEN_MISSING"
  | "HASH_MISSING"
  | "HASH_INVALID_FORMAT"
  | "HASH_MISMATCH"
  | "AUTH_DATE_MISSING"
  | "AUTH_DATE_INVALID"
  | "AUTH_DATE_EXPIRED"
  | "AUTH_DATE_FROM_FUTURE"
  | "USER_MISSING"
  | "USER_INVALID"
  | "JSON_FIELD_INVALID";

export class TelegramInitDataValidationError extends Error {
  public readonly code: TelegramInitDataErrorCode;
  public readonly statusCode = 401;
  public readonly cause?: unknown;

  constructor(
    code: TelegramInitDataErrorCode,
    message: string,
    cause?: unknown,
  ) {
    super(message);
    this.name = "TelegramInitDataValidationError";
    this.code = code;
    this.cause = cause;
  }
}

export interface TelegramWebAppUser {
  id: number;
  is_bot?: boolean | undefined;
  first_name: string;
  last_name?: string | undefined;
  username?: string | undefined;
  language_code?: string | undefined;
  is_premium?: boolean | undefined;
  added_to_attachment_menu?: boolean | undefined;
  allows_write_to_pm?: boolean | undefined;
  photo_url?: string | undefined;
}

export interface TelegramWebAppChat {
  id: number;
  type: "group" | "supergroup" | "channel" | string;
  title: string;
  username?: string | undefined;
  photo_url?: string | undefined;
}

export interface VerifiedTelegramInitData {
  raw: string;
  params: Record<string, string>;

  hash: string;
  authDateUnix: number;
  authDate: Date;

  queryId?: string | undefined;
  user: TelegramWebAppUser;
  receiver?: TelegramWebAppUser | undefined;
  chat?: TelegramWebAppChat | undefined;

  chatType?: string | undefined;
  chatInstance?: string | undefined;
  startParam?: string | undefined;
  canSendAfter?: number | undefined;

  /**
   * 用于后续写入 core.app_sessions.init_hash，方便审计。
   */
  initDataHash: string;
}

export interface VerifyTelegramInitDataOptions {
  /**
   * Telegram Bot Token。
   * 默认读取 process.env.TELEGRAM_BOT_TOKEN。
   */
  botToken?: string;

  /**
   * initData 最大有效期。
   * 默认 86400 秒，也就是 24 小时。
   * 设置为 0 或负数表示不检查过期，不建议生产环境这样做。
   */
  maxAgeSeconds?: number;

  /**
   * 允许的服务器与 Telegram 客户端时间偏差。
   * 默认 300 秒。
   */
  allowedClockSkewSeconds?: number;

  /**
   * 测试时可传入固定时间。
   */
  now?: Date | number;

  /**
   * 默认 true。
   * 游戏业务必须有 user；如果后续你要兼容特殊场景，可以设为 false。
   */
  requireUser?: boolean;

  /**
   * 默认 false。
   *
   * 当前实现按 Telegram Bot Token 校验的常规逻辑：
   * data-check-string 排除 hash，但保留其它字段。
   *
   * 第三方 Ed25519 校验时才明确排除 hash 和 signature；
   * 本函数不做第三方校验。
   */
  excludeSignatureFromDataCheckString?: boolean;
}

const DEFAULT_MAX_AGE_SECONDS = 24 * 60 * 60;
const DEFAULT_CLOCK_SKEW_SECONDS = 5 * 60;
const TELEGRAM_WEBAPP_SECRET_KEY = "WebAppData";

export function verifyTelegramInitData(
  initData: string,
  options: VerifyTelegramInitDataOptions = {},
): VerifiedTelegramInitData {
  const botToken = getBotToken(options.botToken);
  const raw = normalizeRawInitData(initData);
  const paramsMap = parseInitDataToMap(raw);

  const hash = paramsMap.get("hash");
  if (!hash) {
    throw new TelegramInitDataValidationError(
      "HASH_MISSING",
      "Telegram initData 缺少 hash 字段。",
    );
  }

  const normalizedHash = hash.toLowerCase();
  if (!isValidSha256Hex(normalizedHash)) {
    throw new TelegramInitDataValidationError(
      "HASH_INVALID_FORMAT",
      "Telegram initData hash 格式无效。",
    );
  }

  const dataCheckString = buildDataCheckString(
    paramsMap,
    Boolean(options.excludeSignatureFromDataCheckString),
  );

  const expectedHash = computeTelegramInitDataHash(dataCheckString, botToken);

  if (!timingSafeHexEqual(normalizedHash, expectedHash)) {
    throw new TelegramInitDataValidationError(
      "HASH_MISMATCH",
      "Telegram initData hash 校验失败。",
    );
  }

  const authDateUnix = parseAuthDate(paramsMap);
  validateAuthDate(authDateUnix, options);

  const user = parseJsonField<TelegramWebAppUser>(paramsMap, "user");

  if (!user && options.requireUser !== false) {
    throw new TelegramInitDataValidationError(
      "USER_MISSING",
      "Telegram initData 缺少 user 字段。",
    );
  }

  if (user && !isTelegramWebAppUser(user)) {
    throw new TelegramInitDataValidationError(
      "USER_INVALID",
      "Telegram initData user 字段格式无效。",
    );
  }

  const receiver = parseJsonField<TelegramWebAppUser>(paramsMap, "receiver");
  const chat = parseJsonField<TelegramWebAppChat>(paramsMap, "chat");

  const canSendAfter = parseOptionalInteger(paramsMap.get("can_send_after"));

  return {
    raw,
    params: mapToObject(paramsMap),

    hash: normalizedHash,
    authDateUnix,
    authDate: new Date(authDateUnix * 1000),

    queryId: optionalString(paramsMap.get("query_id")),
    user: user as TelegramWebAppUser,
    receiver,
    chat,

    chatType: optionalString(paramsMap.get("chat_type")),
    chatInstance: optionalString(paramsMap.get("chat_instance")),
    startParam: optionalString(paramsMap.get("start_param")),
    canSendAfter,

    initDataHash: normalizedHash,
  };
}

export function buildDataCheckString(
  params: Map<string, string>,
  excludeSignature = false,
): string {
  const entries = Array.from(params.entries())
    .filter(([key]) => {
      if (key === "hash") return false;
      if (excludeSignature && key === "signature") return false;
      return true;
    })
    .sort(([a], [b]) => {
      if (a < b) return -1;
      if (a > b) return 1;
      return 0;
    });

  return entries.map(([key, value]) => `${key}=${value}`).join("\n");
}

export function computeTelegramInitDataHash(
  dataCheckString: string,
  botToken: string,
): string {
  const secretKey = createHmac("sha256", TELEGRAM_WEBAPP_SECRET_KEY)
    .update(botToken)
    .digest();

  return createHmac("sha256", secretKey).update(dataCheckString).digest("hex");
}

function normalizeRawInitData(initData: string): string {
  if (typeof initData !== "string" || initData.trim().length === 0) {
    throw new TelegramInitDataValidationError(
      "INIT_DATA_EMPTY",
      "Telegram initData 不能为空。",
    );
  }

  const trimmed = initData.trim();

  return trimmed.startsWith("?") ? trimmed.slice(1) : trimmed;
}

function parseInitDataToMap(raw: string): Map<string, string> {
  let searchParams: URLSearchParams;

  try {
    searchParams = new URLSearchParams(raw);
  } catch (error) {
    throw new TelegramInitDataValidationError(
      "INIT_DATA_INVALID_QUERY",
      "Telegram initData 不是有效的 query string。",
      error,
    );
  }

  const result = new Map<string, string>();

  for (const [key, value] of searchParams.entries()) {
    if (!key) {
      throw new TelegramInitDataValidationError(
        "INIT_DATA_INVALID_QUERY",
        "Telegram initData 存在空字段名。",
      );
    }

    if (result.has(key)) {
      throw new TelegramInitDataValidationError(
        "INIT_DATA_DUPLICATE_KEY",
        `Telegram initData 存在重复字段：${key}。`,
      );
    }

    result.set(key, value);
  }

  if (result.size === 0) {
    throw new TelegramInitDataValidationError(
      "INIT_DATA_EMPTY",
      "Telegram initData 没有任何字段。",
    );
  }

  return result;
}

function getBotToken(input?: string): string {
  const token = input ?? process.env.TELEGRAM_BOT_TOKEN;

  if (!token || token.trim().length === 0) {
    throw new TelegramInitDataValidationError(
      "BOT_TOKEN_MISSING",
      "缺少 TELEGRAM_BOT_TOKEN。",
    );
  }

  return token.trim();
}

function parseAuthDate(params: Map<string, string>): number {
  const rawAuthDate = params.get("auth_date");

  if (!rawAuthDate) {
    throw new TelegramInitDataValidationError(
      "AUTH_DATE_MISSING",
      "Telegram initData 缺少 auth_date 字段。",
    );
  }

  if (!/^\d+$/.test(rawAuthDate)) {
    throw new TelegramInitDataValidationError(
      "AUTH_DATE_INVALID",
      "Telegram initData auth_date 不是有效 Unix 时间戳。",
    );
  }

  const authDate = Number(rawAuthDate);

  if (!Number.isSafeInteger(authDate) || authDate <= 0) {
    throw new TelegramInitDataValidationError(
      "AUTH_DATE_INVALID",
      "Telegram initData auth_date 超出有效范围。",
    );
  }

  return authDate;
}

function validateAuthDate(
  authDateUnix: number,
  options: VerifyTelegramInitDataOptions,
): void {
  const nowMs =
    typeof options.now === "number"
      ? options.now
      : options.now instanceof Date
        ? options.now.getTime()
        : Date.now();

  const nowUnix = Math.floor(nowMs / 1000);
  const clockSkewSeconds =
    options.allowedClockSkewSeconds ?? DEFAULT_CLOCK_SKEW_SECONDS;

  if (authDateUnix > nowUnix + clockSkewSeconds) {
    throw new TelegramInitDataValidationError(
      "AUTH_DATE_FROM_FUTURE",
      "Telegram initData auth_date 来自未来时间。",
    );
  }

  const maxAgeSeconds = options.maxAgeSeconds ?? DEFAULT_MAX_AGE_SECONDS;

  if (maxAgeSeconds > 0 && nowUnix - authDateUnix > maxAgeSeconds) {
    throw new TelegramInitDataValidationError(
      "AUTH_DATE_EXPIRED",
      "Telegram initData 已过期。",
    );
  }
}

function parseJsonField<T>(
  params: Map<string, string>,
  key: string,
): T | undefined {
  const rawValue = params.get(key);

  if (rawValue === undefined || rawValue === "") {
    return undefined;
  }

  try {
    return JSON.parse(rawValue) as T;
  } catch (error) {
    throw new TelegramInitDataValidationError(
      "JSON_FIELD_INVALID",
      `Telegram initData 字段 ${key} 不是有效 JSON。`,
      error,
    );
  }
}

function parseOptionalInteger(value: string | undefined): number | undefined {
  if (value === undefined || value === "") return undefined;
  if (!/^\d+$/.test(value)) return undefined;

  const parsed = Number(value);

  return Number.isSafeInteger(parsed) ? parsed : undefined;
}

function optionalString(value: string | undefined): string | undefined {
  if (value === undefined || value.length === 0) return undefined;
  return value;
}

function isTelegramWebAppUser(value: unknown): value is TelegramWebAppUser {
  if (!isRecord(value)) return false;

  return (
    Number.isSafeInteger(value.id) &&
    typeof value.first_name === "string" &&
    value.first_name.length > 0
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isValidSha256Hex(value: string): boolean {
  return /^[a-f0-9]{64}$/.test(value);
}

function timingSafeHexEqual(a: string, b: string): boolean {
  if (!isValidSha256Hex(a) || !isValidSha256Hex(b)) {
    return false;
  }

  const left = Buffer.from(a, "hex");
  const right = Buffer.from(b, "hex");

  if (left.length !== right.length) {
    return false;
  }

  return timingSafeEqual(left, right);
}

function mapToObject(map: Map<string, string>): Record<string, string> {
  const result: Record<string, string> = {};

  for (const [key, value] of map.entries()) {
    result[key] = value;
  }

  return result;
}
