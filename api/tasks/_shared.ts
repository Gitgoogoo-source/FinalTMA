import type { VercelRequest, VercelResponse } from "@vercel/node";

import {
  callRpcRaw,
  RpcError,
  type RpcArgsObject,
  type RpcCallOptions,
} from "../../packages/server/src/db/rpc.js";
import {
  ApiError,
  assertApiRateLimit,
  getIdempotencyKey,
  withApiHandler,
  type ApiContext,
  type ApiHandlerOptions,
  type MaybePromise,
} from "../_shared/handler.js";
import { parseJsonBody } from "../_shared/parseBody.js";
import {
  requireSession,
  type SessionContext,
} from "../_shared/requireSession.js";
import { validate, type SchemaLike } from "../_shared/validate.js";

export type JsonRecord = Record<string, unknown>;

export type TaskApiContext = ApiContext & {
  session: SessionContext;
};

export type TaskApiRouteHandler<T = unknown> = (
  req: VercelRequest,
  res: VercelResponse,
  ctx: TaskApiContext,
) => MaybePromise<T | void>;

export type ParseTaskJsonBodyOptions = {
  maxBytes?: number;
  normalize?: (body: unknown, idempotencyKey: unknown) => unknown;
  requireIdempotencyKey?: boolean;
};

export type TaskRpcContext = {
  requestId: string;
  userId: string;
  idempotencyKey?: string | null;
  [key: string]: unknown;
};

export type TaskRpcCallerContext = {
  requestId: string;
  idempotencyKey?: string | null;
  [key: string]: unknown;
};

export function withTaskApiHandler<T = unknown>(
  routeHandler: TaskApiRouteHandler<T>,
  options: ApiHandlerOptions = {},
) {
  return withApiHandler<T>(async (req, res, ctx) => {
    const session = await requireSession(req);
    await assertTaskUserRateLimit(req, res, ctx, session, options.rateLimit);

    return routeHandler(req, res, {
      ...ctx,
      session,
    });
  }, options);
}

async function assertTaskUserRateLimit(
  req: VercelRequest,
  res: VercelResponse,
  ctx: ApiContext,
  session: SessionContext,
  option: ApiHandlerOptions["rateLimit"],
): Promise<void> {
  await assertApiRateLimit(req, res, ctx, option, {
    scopes: ["user", "session", "telegram_user"],
    userId: session.userId,
    sessionId: session.sessionId,
    ...(session.telegramUserId !== null
      ? { telegramUserId: session.telegramUserId }
      : {}),
    metadata: {
      phase: "post_session",
    },
  });
}

export async function parseTaskJsonBodyInput<T>(
  req: VercelRequest,
  schema: SchemaLike<T>,
  options: ParseTaskJsonBodyOptions = {},
): Promise<T> {
  const body = await parseJsonBody<unknown>(req, {
    maxBytes: options.maxBytes ?? 16 * 1024,
  });
  const idempotencyKey = getTaskIdempotencyKeyCandidate(req, body);

  if (
    options.requireIdempotencyKey === true &&
    isMissingIdempotencyKeyCandidate(idempotencyKey)
  ) {
    throw new ApiError(400, "IDEMPOTENCY_KEY_REQUIRED", "缺少幂等键。");
  }

  const input = options.normalize
    ? options.normalize(body, idempotencyKey)
    : normalizeTaskBodyInput(body, idempotencyKey);

  return validate(schema, input);
}

function isMissingIdempotencyKeyCandidate(value: unknown): boolean {
  if (value === undefined || value === null) {
    return true;
  }

  return typeof value === "string" && value.trim().length === 0;
}

export function normalizeTaskBodyInput(
  body: unknown,
  idempotencyKey: unknown,
): JsonRecord {
  if (!isRecord(body)) {
    return {
      idempotencyKey,
    };
  }

  return {
    ...body,
    idempotencyKey,
  };
}

export function getTaskIdempotencyKey(
  req: VercelRequest,
  body?: unknown,
): string | null {
  const candidate = getTaskIdempotencyKeyCandidate(req, body);

  if (typeof candidate !== "string") {
    return null;
  }

  const trimmed = candidate.trim();
  return trimmed.length > 0 ? trimmed : null;
}

export function getTaskIdempotencyKeyCandidate(
  req: VercelRequest,
  body?: unknown,
): unknown {
  const headerIdempotencyKey = getIdempotencyKey(req);

  if (headerIdempotencyKey) {
    return headerIdempotencyKey;
  }

  if (!isRecord(body)) {
    return undefined;
  }

  if (body.idempotencyKey !== undefined) {
    return body.idempotencyKey;
  }

  return body.idempotency_key;
}

export async function callTaskUserRpcRaw<
  TResult = unknown,
  TArgs extends RpcArgsObject = RpcArgsObject,
>(
  rpcName: string,
  session: Pick<SessionContext, "userId">,
  args: TArgs,
  context: TaskRpcCallerContext,
  options: Omit<RpcCallOptions, "schema" | "context"> = {},
): Promise<TResult> {
  return callTaskRpcRaw<TResult, TArgs & { p_user_id: string }>(
    rpcName,
    {
      ...args,
      p_user_id: session.userId,
    },
    {
      ...context,
      userId: session.userId,
    },
    options,
  );
}

export async function callTaskRpcRaw<
  TResult = unknown,
  TArgs extends RpcArgsObject = RpcArgsObject,
>(
  rpcName: string,
  args: TArgs,
  context: TaskRpcContext,
  options: Omit<RpcCallOptions, "schema" | "context"> = {},
): Promise<TResult> {
  return callRpcRaw<TResult, TArgs>(rpcName, args, {
    ...options,
    schema: "api" as never,
    context,
  });
}

export function mapTaskRpcError(
  error: unknown,
  fallbackCode: string,
  fallbackMessage: string,
): ApiError {
  if (error instanceof ApiError) {
    return error;
  }

  if (!(error instanceof RpcError)) {
    return ApiError.internal(fallbackMessage, {
      cause: getErrorMessage(error),
    });
  }

  const message = getRpcErrorText(error);

  if (
    message.includes("idempotency key is required") ||
    message.includes("idempotency_key is required")
  ) {
    return new ApiError(400, "IDEMPOTENCY_KEY_REQUIRED", "缺少幂等键。");
  }

  if (
    message.includes("idempotency conflict") ||
    message.includes("idempotency request is still in progress")
  ) {
    return new ApiError(
      409,
      "IDEMPOTENCY_CONFLICT",
      "幂等键已被其他任务请求使用。",
    );
  }

  if (message.includes("user is not active")) {
    return ApiError.userBlocked("当前账号已被限制使用。");
  }

  if (message.includes("user not found")) {
    return ApiError.authSessionExpired("登录用户不存在，请重新进入应用。");
  }

  if (message.includes("task not found")) {
    return new ApiError(404, "TASK_NOT_FOUND", "任务不存在。");
  }

  if (
    message.includes("task progress not found") ||
    message.includes("task is not completed")
  ) {
    return new ApiError(400, "TASK_NOT_COMPLETED", "任务尚未完成。");
  }

  if (
    message.includes("already claimed") ||
    message.includes("task_claims") ||
    message.includes("task claim integrity violation")
  ) {
    return new ApiError(409, "TASK_ALREADY_CLAIMED", "该任务奖励已领取。");
  }

  if (message.includes("signin date out of range")) {
    return new ApiError(400, "SIGNIN_DATE_INVALID", "签到日期无效。");
  }

  if (message.includes("active sign-in campaign not found")) {
    return new ApiError(404, "SIGNIN_CAMPAIGN_NOT_FOUND", "签到活动不存在。");
  }

  if (message.includes("signin reward config invalid")) {
    return new ApiError(
      500,
      "SIGNIN_REWARD_CONFIG_INVALID",
      "签到奖励配置无效。",
      {
        cause: error,
        expose: false,
      },
    );
  }

  if (
    message.includes("self_invite_not_allowed") ||
    message.includes("self invite")
  ) {
    return new ApiError(
      400,
      "REFERRAL_SELF_INVITE_NOT_ALLOWED",
      "不能邀请自己。",
    );
  }

  if (
    message.includes("referral_already_bound") ||
    message.includes("already bound")
  ) {
    return new ApiError(409, "REFERRAL_ALREADY_BOUND", "邀请关系已绑定。");
  }

  if (
    message.includes("inviter not found") ||
    message.includes("invite code not found")
  ) {
    return new ApiError(404, "REFERRAL_INVITER_NOT_FOUND", "邀请人不存在。");
  }

  if (message.includes("invalid commission status")) {
    return new ApiError(
      400,
      "REFERRAL_COMMISSION_STATUS_INVALID",
      "分红状态无效。",
    );
  }

  if (message.includes("commission not found or not pending")) {
    return new ApiError(
      409,
      "REFERRAL_COMMISSION_NOT_CLAIMABLE",
      "分红不存在或不可领取。",
    );
  }

  return new ApiError(500, fallbackCode, fallbackMessage, {
    cause: error,
    expose: false,
  });
}

export function assertTaskRecordPayload(
  payload: unknown,
  code: string,
  message: string,
): JsonRecord {
  if (!isRecord(payload)) {
    throw new ApiError(500, code, message, {
      details: { payloadType: typeof payload },
      expose: false,
    });
  }

  return payload;
}

export function assertNoClientControlledTaskFields(
  body: JsonRecord,
  message = "任务请求不能携带客户端控制的业务事实字段。",
): void {
  const forbiddenFields = [
    "user_id",
    "userId",
    "telegram_user_id",
    "telegramUserId",
    "wallet_address",
    "walletAddress",
    "role",
    "is_admin",
    "isAdmin",
    "balance",
    "reward",
    "rewards",
    "progress",
    "task_completed",
    "taskCompleted",
  ].filter((field) => body[field] !== undefined);

  if (forbiddenFields.length === 0) {
    return;
  }

  throw new ApiError(400, "VALIDATION_ERROR", "请求参数校验失败。", {
    details: forbiddenFields.map((field) => ({
      path: field,
      message,
    })),
  });
}

export function assertNoSensitiveMetadata(
  value: unknown,
  path = "metadata",
): void {
  if (!isRecord(value)) {
    return;
  }

  const forbiddenPaths = collectSensitiveMetadataPaths(value, path);
  if (forbiddenPaths.length === 0) {
    return;
  }

  throw new ApiError(400, "VALIDATION_ERROR", "请求参数校验失败。", {
    details: forbiddenPaths.map((fieldPath) => ({
      path: fieldPath,
      message: "metadata 不能携带用户身份、原始 chat id 或敏感字段。",
    })),
  });
}

export function firstQueryValue(value: unknown): unknown {
  return Array.isArray(value) ? value[0] : value;
}

export function readString(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0
    ? value.trim()
    : null;
}

export function readNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }

  if (typeof value === "string" && value.trim().length > 0) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }

  return null;
}

export function readBoolean(value: unknown): boolean | null {
  if (typeof value === "boolean") {
    return value;
  }

  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    if (normalized === "true" || normalized === "1") return true;
    if (normalized === "false" || normalized === "0") return false;
  }

  return null;
}

export function readIsoDateString(value: unknown): string | null {
  const text = readString(value);
  if (!text) {
    return null;
  }

  const parsed = new Date(text);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
}

export function compactRecord(
  value: Record<string, unknown>,
): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(value).filter(([, item]) => item !== undefined),
  );
}

function collectSensitiveMetadataPaths(
  value: JsonRecord,
  basePath: string,
  depth = 0,
): string[] {
  if (depth > 4) {
    return [];
  }

  const paths: string[] = [];

  for (const [key, item] of Object.entries(value)) {
    const itemPath = `${basePath}.${key}`;

    if (isSensitiveMetadataKey(key)) {
      paths.push(itemPath);
      continue;
    }

    if (isRecord(item)) {
      paths.push(...collectSensitiveMetadataPaths(item, itemPath, depth + 1));
    }
  }

  return paths;
}

function isSensitiveMetadataKey(key: string): boolean {
  return [
    "user_id",
    "userId",
    "telegram_user_id",
    "telegramUserId",
    "wallet_address",
    "walletAddress",
    "target_chat_id",
    "targetChatId",
    "chat_id",
    "chatId",
    "authorization",
    "cookie",
    "token",
    "secret",
    "service_role",
    "private_key",
    "seed",
    "mnemonic",
  ].includes(key);
}

export function getRpcErrorText(error: RpcError): string {
  return [error.message, error.details, error.hint, error.code]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
}

export function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function isRecord(value: unknown): value is JsonRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
