import {
  VipDailyClaimRequestSchema,
  type VipDailyClaimRequest,
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

type ClaimDailyRpcResult = {
  claim_id?: unknown;
  subscription_id?: unknown;
  claim_date?: unknown;
  fgems_amount?: unknown;
  fgems_ledger_id?: unknown;
  free_box_count?: unknown;
  free_box_used_count?: unknown;
  already_claimed?: unknown;
  idempotent?: unknown;
};

type ClaimDailyResponse = {
  claim_id: string;
  claimId: string;
  subscription_id: string | null;
  subscriptionId: string | null;
  claim_date: string | null;
  claimDate: string | null;
  fgems_amount: number;
  fgemsAmount: number;
  fgems_ledger_id: string | null;
  fgemsLedgerId: string | null;
  free_box_count: number;
  freeBoxCount: number;
  free_box_used_count: number;
  freeBoxUsedCount: number;
  remaining_free_box_count: number;
  remainingFreeBoxCount: number;
  free_box_available: boolean;
  freeBoxAvailable: boolean;
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
      VipDailyClaimRequestSchema,
      normalizeVipDailyClaimInput(body, getIdempotencyKey(req)),
    );

    await assertUserRiskAllowed({
      req,
      ctx,
      session,
      action: "vip.claim_daily_benefit",
      idempotencyKey: input.idempotencyKey,
      metadata: {
        benefit: "daily",
      },
    });

    const claim = await callVipClaimDaily(input, session.userId, ctx.requestId);

    return buildClaimDailyResponse(claim);
  },
  {
    methods: ["POST"],
    rateLimit: {
      action: "vip.claim_daily_benefit",
    },
  },
);

export function normalizeVipDailyClaimInput(
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

export function buildClaimDailyResponse(
  claim: ClaimDailyRpcResult,
): ClaimDailyResponse {
  const claimId = getRequiredString(claim, "claim_id");
  const freeBoxCount = numberOrZero(claim.free_box_count);
  const freeBoxUsedCount = numberOrZero(claim.free_box_used_count);
  const remainingFreeBoxCount = Math.max(freeBoxCount - freeBoxUsedCount, 0);

  return {
    claim_id: claimId,
    claimId,
    subscription_id: stringOrNull(claim.subscription_id),
    subscriptionId: stringOrNull(claim.subscription_id),
    claim_date: stringOrNull(claim.claim_date),
    claimDate: stringOrNull(claim.claim_date),
    fgems_amount: numberOrZero(claim.fgems_amount),
    fgemsAmount: numberOrZero(claim.fgems_amount),
    fgems_ledger_id: stringOrNull(claim.fgems_ledger_id),
    fgemsLedgerId: stringOrNull(claim.fgems_ledger_id),
    free_box_count: freeBoxCount,
    freeBoxCount,
    free_box_used_count: freeBoxUsedCount,
    freeBoxUsedCount,
    remaining_free_box_count: remainingFreeBoxCount,
    remainingFreeBoxCount,
    free_box_available: remainingFreeBoxCount > 0,
    freeBoxAvailable: remainingFreeBoxCount > 0,
    already_claimed: Boolean(claim.already_claimed),
    alreadyClaimed: Boolean(claim.already_claimed),
    idempotent: Boolean(claim.idempotent),
  };
}

async function callVipClaimDaily(
  input: VipDailyClaimRequest,
  userId: string,
  requestId: string,
): Promise<ClaimDailyRpcResult> {
  try {
    return await callRpcRaw<ClaimDailyRpcResult>(
      "vip_claim_daily_benefit",
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
    throw mapVipClaimDailyRpcError(error);
  }
}

function mapVipClaimDailyRpcError(error: unknown): ApiError {
  if (error instanceof ApiError) {
    return error;
  }

  if (!(error instanceof RpcError)) {
    return ApiError.internal("领取月卡每日福利失败。", {
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
      "幂等键已被其他月卡福利请求使用。",
    );
  }

  if (message.includes("vip_expired")) {
    return new ApiError(403, "VIP_REQUIRED", "月卡未生效或已过期。");
  }

  if (message.includes("user not found")) {
    return new ApiError(404, "USER_NOT_FOUND", "登录用户不存在。");
  }

  if (message.includes("user is not active")) {
    return ApiError.userBlocked("当前账号已被限制使用。");
  }

  if (
    message.includes("function api.vip_claim_daily_benefit") ||
    (message.includes("vip_claim_daily_benefit") &&
      message.includes("could not find")) ||
    message.includes('schema "vip" does not exist') ||
    message.includes('relation "vip.')
  ) {
    return new ApiError(
      503,
      "VIP_DATABASE_NOT_READY",
      "月卡数据库尚未初始化。",
      {
        expose: false,
        cause: error,
      },
    );
  }

  return new ApiError(500, "VIP_DAILY_CLAIM_FAILED", "领取月卡每日福利失败。", {
    expose: false,
    cause: error,
  });
}

function getRequiredString(
  value: ClaimDailyRpcResult,
  key: keyof ClaimDailyRpcResult,
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
  if (typeof value === "number" && Number.isFinite(value)) {
    return Math.trunc(value);
  }

  if (typeof value === "string" && value.trim().length > 0) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? Math.trunc(parsed) : 0;
  }

  return 0;
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
