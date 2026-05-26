import {
  ClaimCommissionBodySchema,
  type ClaimCommissionBody,
} from "../../packages/validation/src/task.schemas.js";
import { ApiError } from "../_shared/handler.js";
import {
  assertNoClientControlledTaskFields,
  assertTaskRecordPayload,
  callTaskUserRpcRaw,
  compactRecord,
  isRecord,
  mapTaskRpcError,
  parseTaskJsonBodyInput,
  readBoolean,
  readNumber,
  readString,
  withTaskApiHandler,
} from "./_shared.js";

export default withTaskApiHandler(
  async (req, _res, ctx) => {
    const input = await parseTaskJsonBodyInput(req, ClaimCommissionBodySchema, {
      maxBytes: 8 * 1024,
      normalize: normalizeClaimCommissionInput,
    });
    const payload = await callClaimCommissionRpc(
      input,
      ctx.session,
      ctx.requestId,
    );

    return normalizeClaimCommissionPayload(payload);
  },
  {
    methods: ["POST"],
    rateLimit: {
      action: "tasks.claim_commission",
    },
  },
);

export function normalizeClaimCommissionInput(
  body: unknown,
  idempotencyKey: unknown,
): Record<string, unknown> {
  if (!isRecord(body)) {
    return {
      idempotencyKey,
    };
  }

  assertNoClientControlledTaskFields(
    body,
    "领取分红请求不能携带用户身份、奖励或余额字段。",
  );
  assertNoClientControlledCommissionFields(body);

  return {
    commissionIds: body.commissionIds ?? body.commission_ids,
    idempotencyKey,
  };
}

async function callClaimCommissionRpc(
  input: ClaimCommissionBody,
  session: { userId: string },
  requestId: string,
): Promise<unknown> {
  try {
    return await callTaskUserRpcRaw(
      "referral_claim_commission",
      session,
      {
        p_commission_ids: input.commissionIds ?? null,
        p_idempotency_key: input.idempotencyKey,
      },
      {
        requestId,
        idempotencyKey: input.idempotencyKey,
        commissionCount: input.commissionIds?.length ?? null,
      },
    );
  } catch (error) {
    throw mapTaskRpcError(
      error,
      "REFERRAL_CLAIM_COMMISSION_RPC_FAILED",
      "领取分红失败，请稍后重试。",
    );
  }
}

export function normalizeClaimCommissionPayload(payload: unknown) {
  const result = assertTaskRecordPayload(
    payload,
    "REFERRAL_CLAIM_COMMISSION_RESULT_INVALID",
    "领取分红结果格式无效。",
  );

  const processed = readBoolean(result.processed);
  const claimedCount = readInteger(result.claimed_count);
  const claimedAmount =
    readInteger(result.claimed_amount_kcoin) ??
    readInteger(result.amount_kcoin);
  const kcoinBalanceBefore =
    readInteger(result.kcoin_balance_before) ??
    readInteger(result.balance_before) ??
    readInteger(result.available_before);
  const kcoinBalanceAfter =
    readInteger(result.kcoin_balance_after) ??
    readInteger(result.balance_after) ??
    readInteger(result.available_after);
  const balanceChange =
    readInteger(result.balance_change) ??
    readInteger(result.balance_delta) ??
    (kcoinBalanceBefore !== null && kcoinBalanceAfter !== null
      ? kcoinBalanceAfter - kcoinBalanceBefore
      : null);

  if (processed === null || claimedCount === null || claimedAmount === null) {
    throw new ApiError(
      500,
      "REFERRAL_CLAIM_COMMISSION_RESULT_INVALID",
      "领取分红结果缺少必要字段。",
      {
        details: {
          processed: result.processed,
          claimed_count: result.claimed_count,
          claimed_amount_kcoin: result.claimed_amount_kcoin,
          amount_kcoin: result.amount_kcoin,
        },
        expose: false,
      },
    );
  }

  return compactRecord({
    processed,
    claimed: readBoolean(result.claimed) ?? claimedCount > 0,
    claimed_count: claimedCount,
    claimed_amount_kcoin: claimedAmount,
    amount_kcoin: readInteger(result.amount_kcoin) ?? claimedAmount,
    commission_ids: normalizeUuidList(result.commission_ids),
    ledger_id: readString(result.ledger_id),
    kcoin_balance_before: kcoinBalanceBefore,
    kcoin_balance_after: kcoinBalanceAfter,
    kcoin_locked_after:
      readInteger(result.kcoin_locked_after) ??
      readInteger(result.locked_after),
    balance_change: balanceChange,
    status:
      readString(result.status) ??
      (claimedCount > 0 ? "granted" : "no_pending"),
    idempotent: readBoolean(result.idempotent) ?? false,
  });
}

function assertNoClientControlledCommissionFields(
  body: Record<string, unknown>,
): void {
  const forbiddenFields = [
    "inviter_user_id",
    "inviterUserId",
    "invitee_user_id",
    "inviteeUserId",
    "commission_amount",
    "commissionAmount",
    "commission_amount_kcoin",
    "commissionAmountKcoin",
    "base_amount_kcoin",
    "baseAmountKcoin",
    "commission_bps",
    "commissionBps",
    "ledger_id",
    "ledgerId",
    "status",
  ].filter((field) => body[field] !== undefined);

  if (forbiddenFields.length === 0) {
    return;
  }

  throw new ApiError(400, "VALIDATION_ERROR", "请求参数校验失败。", {
    details: forbiddenFields.map((field) => ({
      path: field,
      message: "领取分红请求不能携带客户端控制的分红事实字段。",
    })),
  });
}

function normalizeUuidList(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .map((item) => readString(item))
    .filter((item): item is string => item !== null);
}

function readInteger(value: unknown): number | null {
  const numberValue = readNumber(value);
  return numberValue === null ? null : Math.trunc(numberValue);
}
