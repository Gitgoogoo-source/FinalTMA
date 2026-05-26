import type { VercelRequest, VercelResponse } from "@vercel/node";

import {
  callRpcRaw,
  RpcError,
  type RpcArgsObject,
  type RpcCallOptions,
} from "../../packages/server/src/db/rpc.js";
import {
  ApiError,
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

    return routeHandler(req, res, {
      ...ctx,
      session,
    });
  }, options);
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
  const input = options.normalize
    ? options.normalize(body, idempotencyKey)
    : normalizeTaskBodyInput(body, idempotencyKey);

  return validate(schema, input);
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
