import type { VercelRequest } from "@vercel/node";

import {
  CommissionHistoryQuerySchema,
  type CommissionHistoryQuery,
} from "../../packages/validation/src/task.schemas.js";
import { ApiError } from "../_shared/handler.js";
import { validate } from "../_shared/validate.js";
import {
  assertTaskRecordPayload,
  callTaskUserRpcRaw,
  compactRecord,
  firstQueryValue,
  isRecord,
  mapTaskRpcError,
  readIsoDateString,
  readNumber,
  readString,
  withTaskApiHandler,
} from "./_shared.js";

export default withTaskApiHandler(
  async (req, _res, ctx) => {
    const input = validate(
      CommissionHistoryQuerySchema,
      normalizeCommissionHistoryQuery(req),
    );
    const payload = await callCommissionHistoryRpc(
      input,
      ctx.session,
      ctx.requestId,
    );

    return normalizeCommissionHistoryPayload(payload);
  },
  {
    methods: ["GET"],
    rateLimit: {
      action: "tasks.commission_history",
    },
  },
);

export function normalizeCommissionHistoryQuery(
  req: VercelRequest,
): Record<string, unknown> {
  return {
    cursor: firstQueryValue(req.query.cursor),
    limit: firstQueryValue(req.query.limit),
    status: firstQueryValue(req.query.status),
  };
}

async function callCommissionHistoryRpc(
  input: CommissionHistoryQuery,
  session: { userId: string },
  requestId: string,
): Promise<unknown> {
  try {
    return await callTaskUserRpcRaw(
      "referral_get_commission_history",
      session,
      {
        p_cursor: normalizeCursor(input.cursor),
        p_status: input.status ?? null,
        p_limit: input.limit ?? 20,
      },
      {
        requestId,
        cursor: input.cursor ?? null,
        status: input.status ?? null,
        limit: input.limit ?? 20,
      },
    );
  } catch (error) {
    throw mapTaskRpcError(
      error,
      "REFERRAL_COMMISSION_HISTORY_RPC_FAILED",
      "获取分红明细失败，请稍后重试。",
    );
  }
}

export function normalizeCommissionHistoryPayload(payload: unknown) {
  const result = assertTaskRecordPayload(
    payload,
    "REFERRAL_COMMISSION_HISTORY_RESULT_INVALID",
    "分红明细结果格式无效。",
  );
  const commissions = Array.isArray(result.commissions)
    ? result.commissions
    : [];

  return {
    items: commissions
      .map(normalizeCommissionRecord)
      .filter((item): item is Record<string, unknown> => item !== null),
    count: readInteger(result.count) ?? commissions.length,
    next_cursor: readIsoDateString(result.next_cursor),
    server_time: readString(result.server_time) ?? new Date().toISOString(),
  };
}

function normalizeCommissionRecord(
  value: unknown,
): Record<string, unknown> | null {
  if (!isRecord(value)) {
    return null;
  }

  const commissionId = readString(value.commission_id ?? value.id);
  const createdAt = readIsoDateString(value.created_at);

  if (!commissionId || !createdAt) {
    return null;
  }

  return compactRecord({
    commission_id: commissionId,
    invitee_username: readString(value.invitee_username),
    invitee_display_name: readString(value.invitee_display_name),
    source_type: readString(value.source_type),
    source_id: readString(value.source_id),
    base_amount_kcoin: readInteger(value.base_amount_kcoin) ?? 0,
    commission_bps: readInteger(value.commission_bps) ?? 0,
    commission_amount_kcoin: readInteger(value.commission_amount_kcoin) ?? 0,
    ledger_id: readString(value.ledger_id),
    status: readString(value.status) ?? "pending",
    created_at: createdAt,
    claimed_at: readIsoDateString(value.claimed_at),
  });
}

function normalizeCursor(value: string | undefined): string | null {
  if (!value) {
    return null;
  }

  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    throw new ApiError(400, "VALIDATION_ERROR", "请求参数校验失败。", {
      details: [
        {
          path: "cursor",
          message: "cursor 必须是有效时间。",
        },
      ],
    });
  }

  return parsed.toISOString();
}

function readInteger(value: unknown): number | null {
  const numberValue = readNumber(value);
  return numberValue === null ? null : Math.trunc(numberValue);
}
