import type { VercelRequest } from "@vercel/node";

import {
  CheckInStatusQuerySchema,
  type CheckInStatusQuery,
} from "../../packages/validation/src/task.schemas.js";
import { validate } from "../_shared/validate.js";
import {
  assertNoClientControlledTaskFields,
  assertTaskRecordPayload,
  callTaskUserRpcRaw,
  compactRecord,
  firstQueryValue,
  isRecord,
  mapTaskRpcError,
  readBoolean,
  readIsoDateString,
  readNumber,
  readString,
  withTaskApiHandler,
} from "./_shared.js";

export default withTaskApiHandler(
  async (req, _res, ctx) => {
    const input = validate(
      CheckInStatusQuerySchema,
      normalizeCheckInStatusQuery(req),
    );
    const payload = await callSigninGetStatusRpc(
      input,
      ctx.session,
      ctx.requestId,
    );

    return normalizeCheckInStatusPayload(payload);
  },
  {
    methods: ["GET"],
    rateLimit: {
      action: "tasks.check_in_status",
    },
  },
);

export function normalizeCheckInStatusQuery(
  req: VercelRequest,
): Record<string, unknown> {
  assertNoClientControlledTaskFields(req.query);

  return {
    campaignId: firstQueryValue(req.query.campaignId ?? req.query.campaign_id),
  };
}

async function callSigninGetStatusRpc(
  input: CheckInStatusQuery,
  session: { userId: string },
  requestId: string,
): Promise<unknown> {
  try {
    return await callTaskUserRpcRaw(
      "signin_get_status",
      session,
      {
        p_campaign_id: input.campaignId ?? null,
      },
      {
        requestId,
        campaignId: input.campaignId ?? null,
      },
    );
  } catch (error) {
    throw mapTaskRpcError(
      error,
      "SIGNIN_STATUS_RPC_FAILED",
      "获取签到状态失败，请稍后重试。",
    );
  }
}

export function normalizeCheckInStatusPayload(payload: unknown) {
  const result = assertTaskRecordPayload(
    payload,
    "SIGNIN_STATUS_RESULT_INVALID",
    "签到状态格式无效。",
  );

  return {
    campaign: normalizeCampaign(result.campaign),
    days: normalizeDays(result.days),
    current_streak: readInteger(result.current_streak) ?? 0,
    cycle_position: readInteger(result.cycle_position) ?? 0,
    total_signins: readInteger(result.total_signins) ?? 0,
    last_signin_date: readString(result.last_signin_date),
    already_claimed_today: readBoolean(result.already_claimed_today) ?? false,
    next_day_index: readInteger(result.next_day_index),
    server_date: readString(result.server_date),
    server_time:
      readIsoDateString(result.server_time) ?? new Date().toISOString(),
  };
}

function normalizeCampaign(value: unknown): Record<string, unknown> | null {
  if (!isRecord(value)) {
    return null;
  }

  const campaignId = readString(value.campaign_id ?? value.id);

  if (!campaignId) {
    return null;
  }

  return compactRecord({
    campaign_id: campaignId,
    code: readString(value.code),
    title: readString(value.title) ?? "7 日签到",
    description: readString(value.description),
    cycle_days: readInteger(value.cycle_days) ?? 7,
    active: readBoolean(value.active),
    starts_at: readIsoDateString(value.starts_at),
    ends_at: readIsoDateString(value.ends_at),
  });
}

function normalizeDays(value: unknown): Record<string, unknown>[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .map(normalizeDay)
    .filter((item): item is Record<string, unknown> => item !== null);
}

function normalizeDay(value: unknown): Record<string, unknown> | null {
  if (!isRecord(value)) {
    return null;
  }

  const dayIndex = readInteger(value.day_index);

  if (dayIndex === null) {
    return null;
  }

  return compactRecord({
    day_index: dayIndex,
    title: readString(value.title) ?? `Day ${dayIndex}`,
    reward: Array.isArray(value.reward) ? value.reward : [],
    status: normalizeDayStatus(value.status),
    claimed: readBoolean(value.claimed) ?? false,
    available: readBoolean(value.available) ?? false,
    last_claimed_at: readIsoDateString(value.last_claimed_at),
    last_claimed_date: readString(value.last_claimed_date),
  });
}

function normalizeDayStatus(
  value: unknown,
): "locked" | "available" | "claimed" | "missed" {
  const status = readString(value)?.toLowerCase();

  if (status === "available" || status === "claimed" || status === "missed") {
    return status;
  }

  return "locked";
}

function readInteger(value: unknown): number | null {
  const numberValue = readNumber(value);
  return numberValue === null ? null : Math.trunc(numberValue);
}
