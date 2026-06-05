import { callRpcRaw, RpcError } from "../../packages/server/src/db/rpc.js";
import {
  readVipMonthlyPriceXtr,
  VipPriceConfigError,
} from "../../packages/server/src/vip/vipPrice.js";
import { ApiError, withApiHandler } from "../_shared/handler.js";
import { requireSession } from "../_shared/requireSession.js";

type VipStatusRpcResult = Record<string, unknown>;

type VipStatusResponse = {
  is_vip: boolean;
  isVip: boolean;
  subscription_id: string | null;
  subscriptionId: string | null;
  current_period_start: string | null;
  currentPeriodStart: string | null;
  current_period_end: string | null;
  currentPeriodEnd: string | null;
  auto_renew_enabled: boolean;
  autoRenewEnabled: boolean;
  today_claimed: boolean;
  todayClaimed: boolean;
  today: Record<string, unknown> | null;
  plan: Record<string, unknown> | null;
  server_time: string | null;
  serverTime: string | null;
};

export default withApiHandler(
  async (req, _res, ctx) => {
    const session = await requireSession(req);
    const priceXtr = readVipMonthlyPriceXtrForApi();
    const status = await callVipGetStatus(session.userId, ctx.requestId);

    return normalizeVipStatusPayload(status, { priceXtr });
  },
  {
    methods: ["GET"],
    rateLimit: {
      action: "vip.status",
    },
  },
);

async function callVipGetStatus(
  userId: string,
  requestId: string,
): Promise<VipStatusRpcResult> {
  try {
    return await callRpcRaw<VipStatusRpcResult>(
      "vip_get_status",
      {
        p_user_id: userId,
      },
      {
        schema: "api" as never,
        context: {
          requestId,
          userId,
        },
      },
    );
  } catch (error) {
    throw mapVipStatusRpcError(error);
  }
}

export function normalizeVipStatusPayload(
  payload: unknown,
  options: { priceXtr?: number | undefined } = {},
): VipStatusResponse {
  if (!isRecord(payload)) {
    throw new ApiError(500, "VIP_STATUS_RESULT_INVALID", "月卡状态格式无效。", {
      expose: false,
    });
  }

  const today = normalizeVipToday(payload.today);
  const plan = isRecord(payload.plan)
    ? normalizeVipPlan(payload.plan, options.priceXtr)
    : null;
  const isVip = readBoolean(payload.is_vip ?? payload.isVip) ?? false;
  const subscriptionId = readString(
    payload.subscription_id ?? payload.subscriptionId,
  );
  const currentPeriodStart = readString(
    payload.current_period_start ?? payload.currentPeriodStart,
  );
  const currentPeriodEnd = readString(
    payload.current_period_end ?? payload.currentPeriodEnd,
  );
  const autoRenewEnabled =
    readBoolean(payload.auto_renew_enabled ?? payload.autoRenewEnabled) ??
    false;
  const todayClaimed =
    readBoolean(
      payload.today_claimed ?? payload.todayClaimed ?? today?.claimed,
    ) ?? false;
  const serverTime = readString(payload.server_time ?? payload.serverTime);

  return {
    is_vip: isVip,
    isVip,
    subscription_id: subscriptionId,
    subscriptionId,
    current_period_start: currentPeriodStart,
    currentPeriodStart,
    current_period_end: currentPeriodEnd,
    currentPeriodEnd,
    auto_renew_enabled: autoRenewEnabled,
    autoRenewEnabled,
    today_claimed: todayClaimed,
    todayClaimed,
    today,
    plan,
    server_time: serverTime,
    serverTime,
  };
}

function normalizeVipToday(value: unknown): Record<string, unknown> | null {
  if (!isRecord(value)) {
    return null;
  }

  const businessDateUtc = readString(
    value.business_date_utc ?? value.businessDateUtc,
  );
  const claimId = readString(value.claim_id ?? value.claimId);
  const claimed = readBoolean(value.claimed) ?? false;
  const canClaim = readBoolean(value.can_claim ?? value.canClaim) ?? false;
  const fgemsAmount = readNumber(value.fgems_amount ?? value.fgemsAmount) ?? 0;
  const freeBoxCount =
    readNumber(value.free_box_count ?? value.freeBoxCount) ?? 0;
  const freeBoxUsedCount =
    readNumber(value.free_box_used_count ?? value.freeBoxUsedCount) ?? 0;
  const remainingFreeBoxCount = Math.max(
    readNumber(value.remaining_free_box_count ?? value.remainingFreeBoxCount) ??
      freeBoxCount - freeBoxUsedCount,
    0,
  );
  const freeBoxAvailable =
    readBoolean(value.free_box_available ?? value.freeBoxAvailable) ??
    remainingFreeBoxCount > 0;

  return {
    ...value,
    business_date_utc: businessDateUtc,
    businessDateUtc,
    claim_id: claimId,
    claimId,
    claimed,
    can_claim: canClaim,
    canClaim,
    fgems_amount: fgemsAmount,
    fgemsAmount,
    free_box_count: freeBoxCount,
    freeBoxCount,
    free_box_used_count: freeBoxUsedCount,
    freeBoxUsedCount,
    remaining_free_box_count: remainingFreeBoxCount,
    remainingFreeBoxCount,
    free_box_available: freeBoxAvailable,
    freeBoxAvailable,
  };
}

function normalizeVipPlan(
  plan: Record<string, unknown>,
  priceXtrOverride?: number | undefined,
): Record<string, unknown> {
  const id = readString(plan.id ?? plan.plan_id);

  if (!id) {
    return {};
  }

  const code = readString(plan.code ?? plan.plan_code);
  const displayName =
    readString(plan.display_name ?? plan.displayName ?? plan.name) ??
    "VIP 月卡";
  const priceXtr =
    priceXtrOverride ?? readNumber(plan.price_xtr ?? plan.priceXtr) ?? 0;
  const durationDays = readNumber(plan.duration_days ?? plan.durationDays);
  const dailyFgems = readNumber(plan.daily_fgems ?? plan.dailyFgems) ?? 0;
  const dailyFreeBoxCount =
    readNumber(plan.daily_free_box_count ?? plan.dailyFreeBoxCount) ?? 0;
  const feeRebateBps =
    readNumber(plan.fee_rebate_bps ?? plan.feeRebateBps) ?? 0;

  return {
    ...plan,
    id,
    code,
    display_name: displayName,
    displayName,
    price_xtr: priceXtr,
    priceXtr,
    duration_days: durationDays,
    durationDays,
    daily_fgems: dailyFgems,
    dailyFgems,
    daily_free_box_count: dailyFreeBoxCount,
    dailyFreeBoxCount,
    fee_rebate_bps: feeRebateBps,
    feeRebateBps,
  };
}

function readVipMonthlyPriceXtrForApi(): number {
  try {
    return readVipMonthlyPriceXtr();
  } catch (error) {
    if (error instanceof VipPriceConfigError) {
      throw new ApiError(error.statusCode, error.code, "月卡价格配置无效。", {
        expose: error.expose,
        cause: error,
      });
    }

    throw error;
  }
}

function mapVipStatusRpcError(error: unknown): ApiError {
  if (error instanceof ApiError) {
    return error;
  }

  if (!(error instanceof RpcError)) {
    return ApiError.internal("获取月卡状态失败。", {
      cause: getErrorMessage(error),
    });
  }

  const message = getRpcErrorText(error);

  if (message.includes("user not found")) {
    return new ApiError(404, "USER_NOT_FOUND", "登录用户不存在。");
  }

  if (
    message.includes("function api.vip_get_status") ||
    (message.includes("vip_get_status") &&
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

  return new ApiError(500, "VIP_STATUS_RPC_FAILED", "获取月卡状态失败。", {
    expose: false,
    cause: error,
  });
}

function readString(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0
    ? value.trim()
    : null;
}

function readNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }

  if (typeof value === "string" && value.trim().length > 0) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
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
