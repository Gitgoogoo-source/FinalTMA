import type { VercelRequest } from "@vercel/node";

import {
  ReferralListQuerySchema,
  type ReferralListQuery,
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
  readString,
  withTaskApiHandler,
} from "./_shared.js";

export default withTaskApiHandler(
  async (req, _res, ctx) => {
    const input = validate(
      ReferralListQuerySchema,
      normalizeReferralRecordsQuery(req),
    );
    const payload = await callReferralRecordsRpc(
      input,
      ctx.session,
      ctx.requestId,
    );

    return normalizeReferralRecordsPayload(payload);
  },
  {
    methods: ["GET"],
    rateLimit: {
      action: "tasks.referral_records",
    },
  },
);

export function normalizeReferralRecordsQuery(
  req: VercelRequest,
): Record<string, unknown> {
  return {
    cursor: firstQueryValue(req.query.cursor),
    limit: firstQueryValue(req.query.limit),
    status: firstQueryValue(req.query.status),
    campaignId: firstQueryValue(req.query.campaignId ?? req.query.campaign_id),
  };
}

async function callReferralRecordsRpc(
  input: ReferralListQuery,
  session: { userId: string },
  requestId: string,
): Promise<unknown> {
  try {
    return await callTaskUserRpcRaw(
      "referral_get_records",
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
        campaignId: input.campaignId ?? null,
      },
    );
  } catch (error) {
    throw mapTaskRpcError(
      error,
      "REFERRAL_RECORDS_RPC_FAILED",
      "获取邀请记录失败，请稍后重试。",
    );
  }
}

export function normalizeReferralRecordsPayload(payload: unknown) {
  const result = assertTaskRecordPayload(
    payload,
    "REFERRAL_RECORDS_RESULT_INVALID",
    "邀请记录结果格式无效。",
  );
  const records = Array.isArray(result.records) ? result.records : [];

  return {
    items: records
      .map(normalizeReferralRecord)
      .filter((item): item is Record<string, unknown> => item !== null),
    next_cursor: readIsoDateString(result.next_cursor),
    server_time: readString(result.server_time) ?? new Date().toISOString(),
  };
}

function normalizeReferralRecord(
  value: unknown,
): Record<string, unknown> | null {
  if (!isRecord(value)) {
    return null;
  }

  const referralId = readString(value.referral_id);
  const createdAt = readIsoDateString(value.created_at);

  if (!referralId || !createdAt) {
    return null;
  }

  return compactRecord({
    referral_id: referralId,
    invitee_display_name: readString(value.invitee_display_name),
    invitee_username: readString(value.invitee_username),
    invite_code: readString(value.invite_code),
    status: readString(value.status),
    qualified_at: readIsoDateString(value.qualified_at),
    rewarded_at: readIsoDateString(value.rewarded_at),
    created_at: createdAt,
    updated_at: readIsoDateString(value.updated_at),
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
