import {
  OpenVipDailyBoxRequestSchema,
  type OpenVipDailyBoxRequest,
} from "../../packages/validation/src/box.schemas.js";
import { callRpcRaw, RpcError } from "../../packages/server/src/db/rpc.js";
import {
  ApiError,
  getIdempotencyKey,
  withApiHandler,
} from "../_shared/handler.js";
import { parseOptionalJsonBody } from "../_shared/parseBody.js";
import { requireSession } from "../_shared/requireSession.js";
import { recordRiskEventSafely } from "../_shared/riskEvents.js";
import { assertUserRiskAllowed } from "../_shared/riskGuards.js";
import { validate } from "../_shared/validate.js";

type OpenVipDailyBoxRpcResult = {
  draw_order_id?: unknown;
  status?: unknown;
  payment_status?: unknown;
  draw_count?: unknown;
  quantity?: unknown;
  xtr_amount?: unknown;
  total_price_stars?: unknown;
  claim_id?: unknown;
  free_box_count?: unknown;
  free_box_used_count?: unknown;
  consume_ledger_id?: unknown;
  idempotent?: unknown;
  result_ready?: unknown;
};

type OpenVipDailyBoxResponse = {
  order_id: string;
  star_order_id: null;
  invoice_payload: null;
  xtr_amount: number;
  draw_count: 1;
  order_status: string;
  payment_status: string;
  payment_order_status: string;
  invoice_link: null;
  invoice_open_mode: null;
  expires_at: null;
  dev_payment_processed: false;
  idempotent: boolean;
  result_ready: boolean;
  vip_daily_claim_id: string | null;
  vipDailyClaimId: string | null;
  free_box_count: number;
  freeBoxCount: number;
  free_box_used_count: number;
  freeBoxUsedCount: number;
  consume_ledger_id: string | null;
  consumeLedgerId: string | null;
};

export default withApiHandler(
  async (req, _res, ctx) => {
    const session = await requireSession(req);
    const body = await parseOptionalJsonBody<unknown>(req, {
      maxBytes: 16 * 1024,
    });
    const input = validate(
      OpenVipDailyBoxRequestSchema,
      normalizeOpenVipDailyBoxInput(body, getIdempotencyKey(req)),
    );

    await assertUserRiskAllowed({
      req,
      ctx,
      session,
      action: "box.open_vip_daily_free",
      idempotencyKey: input.idempotencyKey,
      metadata: {
        boxSlug: "premium_egg",
        drawCount: 1,
      },
    });

    const order = await callOpenVipDailyBox(
      input,
      session.userId,
      ctx.requestId,
    );
    const orderId = getRequiredString(order, "draw_order_id");

    await recordRiskEventSafely({
      userId: session.userId,
      eventType: "vip_daily_free_box_open",
      sourceType: "gacha_order",
      sourceId: orderId,
      detail: {
        request_id: ctx.requestId,
        action: "boxes.open_vip_daily",
        box_slug: "premium_egg",
        draw_count: 1,
        free_box_count: numberOrZero(order.free_box_count),
        free_box_used_count: numberOrZero(order.free_box_used_count),
      },
      idempotencyKey: `risk:vip_daily_free_box_open:${orderId}:${input.idempotencyKey}`,
      context: {
        requestId: ctx.requestId,
        userId: session.userId,
        orderId,
        idempotencyKey: input.idempotencyKey,
      },
    });

    return buildOpenVipDailyBoxResponse(order);
  },
  {
    methods: ["POST"],
    rateLimit: {
      action: "boxes.open_vip_daily",
    },
  },
);

export function normalizeOpenVipDailyBoxInput(
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
    ...(body.box_slug !== undefined ? { box_slug: body.box_slug } : {}),
    ...(body.boxSlug !== undefined ? { boxSlug: body.boxSlug } : {}),
    ...(body.draw_count !== undefined ? { draw_count: body.draw_count } : {}),
    ...(body.drawCount !== undefined ? { drawCount: body.drawCount } : {}),
    ...(body.quantity !== undefined ? { quantity: body.quantity } : {}),
    ...(body.price !== undefined ? { price: body.price } : {}),
    ...(body.xtr_amount !== undefined ? { xtr_amount: body.xtr_amount } : {}),
    ...(body.xtrAmount !== undefined ? { xtrAmount: body.xtrAmount } : {}),
  };
}

export function buildOpenVipDailyBoxResponse(
  order: OpenVipDailyBoxRpcResult,
): OpenVipDailyBoxResponse {
  const orderId = getRequiredString(order, "draw_order_id");
  const claimId = stringOrNull(order.claim_id);
  const consumeLedgerId = stringOrNull(order.consume_ledger_id);

  return {
    order_id: orderId,
    star_order_id: null,
    invoice_payload: null,
    xtr_amount: 0,
    draw_count: 1,
    order_status: stringOrNull(order.status) ?? "completed",
    payment_status: "fulfilled",
    payment_order_status: "fulfilled",
    invoice_link: null,
    invoice_open_mode: null,
    expires_at: null,
    dev_payment_processed: false,
    idempotent: Boolean(order.idempotent),
    result_ready: readBoolean(order.result_ready) ?? true,
    vip_daily_claim_id: claimId,
    vipDailyClaimId: claimId,
    free_box_count: numberOrZero(order.free_box_count),
    freeBoxCount: numberOrZero(order.free_box_count),
    free_box_used_count: numberOrZero(order.free_box_used_count),
    freeBoxUsedCount: numberOrZero(order.free_box_used_count),
    consume_ledger_id: consumeLedgerId,
    consumeLedgerId,
  };
}

async function callOpenVipDailyBox(
  input: OpenVipDailyBoxRequest,
  userId: string,
  requestId: string,
): Promise<OpenVipDailyBoxRpcResult> {
  try {
    return await callRpcRaw<OpenVipDailyBoxRpcResult>(
      "vip_open_daily_free_premium_egg",
      {
        p_user_id: userId,
        p_idempotency_key: input.idempotencyKey,
      },
      {
        schema: "api" as never,
        context: {
          requestId,
          userId,
          boxSlug: "premium_egg",
          quantity: 1,
          idempotencyKey: input.idempotencyKey,
        },
      },
    );
  } catch (error) {
    throw mapOpenVipDailyBoxRpcError(error);
  }
}

function mapOpenVipDailyBoxRpcError(error: unknown): ApiError {
  if (error instanceof ApiError) {
    return error;
  }

  if (!(error instanceof RpcError)) {
    return ApiError.internal("开启福利蛋失败。", {
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
      "幂等键已被其他福利蛋请求使用。",
    );
  }

  if (message.includes("vip_expired")) {
    return new ApiError(403, "VIP_REQUIRED", "月卡未生效或已过期。");
  }

  if (message.includes("vip_daily_free_box_not_claimed")) {
    return new ApiError(
      409,
      "VIP_DAILY_FREE_BOX_NOT_CLAIMED",
      "请先领取今日免费盲盒。",
    );
  }

  if (message.includes("vip_daily_benefit_not_claimed")) {
    return new ApiError(
      409,
      "VIP_DAILY_BENEFIT_NOT_CLAIMED",
      "请先领取今日月卡福利。",
    );
  }

  if (message.includes("vip_free_box_already_used")) {
    return new ApiError(
      409,
      "VIP_FREE_BOX_ALREADY_USED",
      "今日福利蛋已经用完。",
    );
  }

  if (message.includes("vip_free_box_not_available")) {
    return new ApiError(
      409,
      "VIP_FREE_BOX_NOT_AVAILABLE",
      "今日没有可用的福利蛋次数。",
    );
  }

  if (message.includes("blind box not found")) {
    return new ApiError(404, "BOX_NOT_FOUND", "稀有蛋不存在。");
  }

  if (
    message.includes("not active") ||
    message.includes("has not started") ||
    message.includes("has ended")
  ) {
    return new ApiError(400, "BOX_NOT_ACTIVE", "当前稀有蛋不可开启。");
  }

  if (message.includes("stock is insufficient")) {
    return new ApiError(
      409,
      "BOX_STOCK_NOT_ENOUGH",
      "当前稀有蛋暂时不可开启，请刷新后重试。",
    );
  }

  if (
    message.includes("active drop pool not found") ||
    message.includes("drop pool has no available rewards") ||
    message.includes("failed to select reward")
  ) {
    return new ApiError(
      409,
      "DROP_POOL_EMPTY",
      "当前奖励池为空，暂时无法开福利蛋。",
    );
  }

  if (message.includes("user not found")) {
    return new ApiError(404, "USER_NOT_FOUND", "登录用户不存在。");
  }

  if (message.includes("user is not active")) {
    return ApiError.userBlocked("当前账号已被限制使用。");
  }

  if (
    message.includes("function api.vip_open_daily_free_premium_egg") ||
    (message.includes("vip_open_daily_free_premium_egg") &&
      message.includes("could not find")) ||
    message.includes('schema "vip" does not exist') ||
    message.includes('relation "vip.')
  ) {
    return new ApiError(
      503,
      "VIP_DATABASE_NOT_READY",
      "月卡福利蛋数据库尚未初始化。",
      {
        expose: false,
        cause: error,
      },
    );
  }

  return new ApiError(500, "VIP_FREE_BOX_OPEN_FAILED", "开启福利蛋失败。", {
    expose: false,
    cause: error,
  });
}

function getRequiredString(
  value: OpenVipDailyBoxRpcResult,
  key: keyof OpenVipDailyBoxRpcResult,
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
