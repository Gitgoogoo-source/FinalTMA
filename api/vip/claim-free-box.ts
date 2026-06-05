import {
  VipFreeBoxClaimRequestSchema,
  type VipFreeBoxClaimRequest,
} from "../../packages/validation/src/vip.schemas.js";
import { callRpcRaw, RpcError } from "../../packages/server/src/db/rpc.js";
import {
  ApiError,
  getIdempotencyKey,
  withApiHandler,
} from "../_shared/handler.js";
import { parseOptionalJsonBody } from "../_shared/parseBody.js";
import { requireSession } from "../_shared/requireSession.js";
import { assertUserRiskAllowed } from "../_shared/riskGuards.js";
import { validate } from "../_shared/validate.js";

type ClaimFreeBoxRpcResult = {
  claim_id?: unknown;
  subscription_id?: unknown;
  claim_date?: unknown;
  free_box_count?: unknown;
  free_box_used_count?: unknown;
  remaining_free_box_count?: unknown;
  free_box_available?: unknown;
  free_box_claimed?: unknown;
  free_box_claimed_at?: unknown;
  fgems_claimed?: unknown;
  already_claimed?: unknown;
  idempotent?: unknown;
};

type ClaimFreeBoxResponse = {
  claim_id: string;
  claimId: string;
  subscription_id: string | null;
  subscriptionId: string | null;
  claim_date: string | null;
  claimDate: string | null;
  free_box_count: number;
  freeBoxCount: number;
  free_box_used_count: number;
  freeBoxUsedCount: number;
  remaining_free_box_count: number;
  remainingFreeBoxCount: number;
  free_box_available: boolean;
  freeBoxAvailable: boolean;
  free_box_claimed: boolean;
  freeBoxClaimed: boolean;
  free_box_claimed_at: string | null;
  freeBoxClaimedAt: string | null;
  fgems_claimed: boolean;
  fgemsClaimed: boolean;
  already_claimed: boolean;
  alreadyClaimed: boolean;
  idempotent: boolean;
};

export default withApiHandler(
  async (req, _res, ctx) => {
    const session = await requireSession(req);
    const body = await parseOptionalJsonBody<unknown>(req, {
      maxBytes: 16 * 1024,
    });
    const input = validate(
      VipFreeBoxClaimRequestSchema,
      normalizeVipFreeBoxClaimInput(body, getIdempotencyKey(req)),
    );

    await assertUserRiskAllowed({
      req,
      ctx,
      session,
      action: "vip.claim_daily_free_box",
      idempotencyKey: input.idempotencyKey,
      metadata: {
        benefit: "daily_free_box",
      },
    });

    const claim = await callVipClaimFreeBox(
      input,
      session.userId,
      ctx.requestId,
    );

    return buildClaimFreeBoxResponse(claim);
  },
  {
    methods: ["POST"],
    rateLimit: {
      action: "vip.claim_daily_free_box",
    },
  },
);

export function normalizeVipFreeBoxClaimInput(
  body: unknown,
  headerIdempotencyKey: string | null,
): Record<string, unknown> {
  if (!isRecord(body)) {
    return {
      idempotencyKey: headerIdempotencyKey,
    };
  }

  return {
    idempotencyKey:
      body.idempotencyKey ?? body.idempotency_key ?? headerIdempotencyKey,
    ...(body.user_id !== undefined ? { user_id: body.user_id } : {}),
    ...(body.telegram_user_id !== undefined
      ? { telegram_user_id: body.telegram_user_id }
      : {}),
    ...(body.userId !== undefined ? { userId: body.userId } : {}),
    ...(body.telegramUserId !== undefined
      ? { telegramUserId: body.telegramUserId }
      : {}),
  };
}

export function buildClaimFreeBoxResponse(
  claim: ClaimFreeBoxRpcResult,
): ClaimFreeBoxResponse {
  const claimId = getRequiredString(claim, "claim_id");
  const freeBoxCount = numberOrZero(claim.free_box_count);
  const freeBoxUsedCount = numberOrZero(claim.free_box_used_count);
  const freeBoxClaimed = readBoolean(claim.free_box_claimed) ?? true;
  const remainingFreeBoxCount = Math.max(
    numberOrNull(claim.remaining_free_box_count) ??
      freeBoxCount - freeBoxUsedCount,
    0,
  );
  const freeBoxAvailable =
    readBoolean(claim.free_box_available) ??
    (freeBoxClaimed && remainingFreeBoxCount > 0);
  const fgemsClaimed = readBoolean(claim.fgems_claimed) ?? false;
  const freeBoxClaimedAt = stringOrNull(claim.free_box_claimed_at);

  return {
    claim_id: claimId,
    claimId,
    subscription_id: stringOrNull(claim.subscription_id),
    subscriptionId: stringOrNull(claim.subscription_id),
    claim_date: stringOrNull(claim.claim_date),
    claimDate: stringOrNull(claim.claim_date),
    free_box_count: freeBoxCount,
    freeBoxCount,
    free_box_used_count: freeBoxUsedCount,
    freeBoxUsedCount,
    remaining_free_box_count: remainingFreeBoxCount,
    remainingFreeBoxCount,
    free_box_available: freeBoxAvailable,
    freeBoxAvailable,
    free_box_claimed: freeBoxClaimed,
    freeBoxClaimed,
    free_box_claimed_at: freeBoxClaimedAt,
    freeBoxClaimedAt,
    fgems_claimed: fgemsClaimed,
    fgemsClaimed,
    already_claimed: Boolean(claim.already_claimed),
    alreadyClaimed: Boolean(claim.already_claimed),
    idempotent: Boolean(claim.idempotent),
  };
}

async function callVipClaimFreeBox(
  input: VipFreeBoxClaimRequest,
  userId: string,
  requestId: string,
): Promise<ClaimFreeBoxRpcResult> {
  try {
    return await callRpcRaw<ClaimFreeBoxRpcResult>(
      "vip_claim_daily_free_box",
      {
        p_user_id: userId,
        p_idempotency_key: input.idempotencyKey,
      },
      {
        schema: "api" as never,
        context: {
          requestId,
          userId,
          idempotencyKey: input.idempotencyKey,
        },
      },
    );
  } catch (error) {
    throw mapVipClaimFreeBoxRpcError(error);
  }
}

function mapVipClaimFreeBoxRpcError(error: unknown): ApiError {
  if (error instanceof ApiError) {
    return error;
  }

  if (!(error instanceof RpcError)) {
    return ApiError.internal("领取月卡免费盲盒失败。", {
      cause: getErrorMessage(error),
    });
  }

  const message = getRpcErrorText(error);

  if (message.includes("idempotency_key is required")) {
    return new ApiError(400, "IDEMPOTENCY_KEY_REQUIRED", "缺少幂等键。");
  }

  if (message.includes("idempotency key conflict")) {
    return new ApiError(
      409,
      "IDEMPOTENCY_CONFLICT",
      "幂等键已被其他月卡免费盲盒请求使用。",
    );
  }

  if (message.includes("vip_expired")) {
    return new ApiError(403, "VIP_REQUIRED", "月卡未生效或已过期。");
  }

  if (message.includes("vip_free_box_not_available")) {
    return new ApiError(
      409,
      "VIP_FREE_BOX_NOT_AVAILABLE",
      "今日没有可领取的月卡免费盲盒。",
    );
  }

  if (message.includes("user not found")) {
    return new ApiError(404, "USER_NOT_FOUND", "登录用户不存在。");
  }

  if (message.includes("user is not active")) {
    return ApiError.userBlocked("当前账号已被限制使用。");
  }

  if (
    message.includes("function api.vip_claim_daily_free_box") ||
    (message.includes("vip_claim_daily_free_box") &&
      message.includes("could not find")) ||
    message.includes('schema "vip" does not exist') ||
    message.includes('relation "vip.')
  ) {
    return new ApiError(
      503,
      "VIP_DATABASE_NOT_READY",
      "月卡免费盲盒数据库尚未初始化。",
      {
        expose: false,
        cause: error,
      },
    );
  }

  return new ApiError(
    500,
    "VIP_FREE_BOX_CLAIM_FAILED",
    "领取月卡免费盲盒失败。",
    {
      expose: false,
      cause: error,
    },
  );
}

function getRequiredString(
  value: ClaimFreeBoxRpcResult,
  key: keyof ClaimFreeBoxRpcResult,
): string {
  const fieldValue = value[key];

  if (typeof fieldValue === "string" && fieldValue.trim().length > 0) {
    return fieldValue;
  }

  throw new ApiError(
    500,
    "RPC_RESULT_INVALID",
    `RPC 返回缺少字段 ${String(key)}。`,
    {
      expose: false,
    },
  );
}

function stringOrNull(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0
    ? value.trim()
    : null;
}

function numberOrZero(value: unknown): number {
  return numberOrNull(value) ?? 0;
}

function numberOrNull(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) {
    return Math.trunc(value);
  }

  if (typeof value === "string" && value.trim().length > 0) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? Math.trunc(parsed) : null;
  }

  return null;
}

function readBoolean(value: unknown): boolean | null {
  return typeof value === "boolean" ? value : null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function getRpcErrorText(error: RpcError): string {
  return [error.message, error.details, error.hint]
    .filter((item): item is string => typeof item === "string")
    .join(" ")
    .toLowerCase();
}

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
