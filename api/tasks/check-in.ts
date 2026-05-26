import {
  CheckInBodySchema,
  type CheckInBody,
} from "../../packages/validation/src/task.schemas.js";
import { ApiError } from "../_shared/handler.js";
import {
  assertTaskRecordPayload,
  callTaskUserRpcRaw,
  isRecord,
  mapTaskRpcError,
  parseTaskJsonBodyInput,
  withTaskApiHandler,
} from "./_shared.js";

export default withTaskApiHandler(
  async (req, _res, ctx) => {
    const input = await parseTaskJsonBodyInput(req, CheckInBodySchema, {
      maxBytes: 8 * 1024,
      requireIdempotencyKey: true,
      normalize: normalizeCheckInInput,
    });
    const payload = await callTaskDailyCheckInRpc(
      input,
      ctx.session,
      ctx.requestId,
    );

    return normalizeCheckInPayload(payload);
  },
  {
    methods: ["POST"],
    rateLimit: {
      action: "tasks.check_in",
    },
  },
);

export function normalizeCheckInInput(
  body: unknown,
  idempotencyKey: unknown,
): Record<string, unknown> {
  if (!isRecord(body)) {
    return {
      idempotencyKey,
    };
  }

  assertNoClientIdentityFields(body);

  return {
    campaignId: body.campaignId ?? body.campaign_id,
    idempotencyKey,
  };
}

async function callTaskDailyCheckInRpc(
  input: CheckInBody,
  session: { userId: string },
  requestId: string,
): Promise<unknown> {
  try {
    return await callTaskUserRpcRaw(
      "task_daily_check_in",
      session,
      {
        p_campaign_id: input.campaignId ?? null,
        p_local_date: null,
        p_timezone_offset_minutes: null,
        p_idempotency_key: input.idempotencyKey,
      },
      {
        requestId,
        idempotencyKey: input.idempotencyKey,
        campaignId: input.campaignId ?? null,
      },
    );
  } catch (error) {
    throw mapTaskRpcError(
      error,
      "TASK_CHECK_IN_RPC_FAILED",
      "签到失败，请稍后重试。",
    );
  }
}

export function normalizeCheckInPayload(payload: unknown) {
  const result = assertTaskRecordPayload(
    payload,
    "TASK_CHECK_IN_RESULT_INVALID",
    "签到结果格式无效。",
  );
  const campaignId = readString(result.campaign_id);
  const dayIndex = readNumber(result.day_index);
  const currentStreak = readNumber(result.current_streak);
  const checkedInAt = readString(result.checked_in_at);

  if (!campaignId || dayIndex === null || currentStreak === null) {
    throw new ApiError(
      500,
      "TASK_CHECK_IN_RESULT_INVALID",
      "签到结果缺少必要字段。",
      {
        details: {
          campaign_id: result.campaign_id,
          day_index: result.day_index,
          current_streak: result.current_streak,
        },
        expose: false,
      },
    );
  }

  return {
    signin_id: readString(result.signin_id),
    campaign_id: campaignId,
    already_claimed: readBoolean(result.already_claimed) ?? false,
    day_index: dayIndex,
    current_streak: currentStreak,
    cycle_position: readNumber(result.cycle_position),
    total_signins: readNumber(result.total_signins),
    reward: Array.isArray(result.reward) ? result.reward : [],
    ledger_results: Array.isArray(result.ledger_results)
      ? result.ledger_results
      : [],
    progress_result: result.progress_result ?? null,
    checked_in_at: checkedInAt ?? new Date().toISOString(),
    idempotent: readBoolean(result.idempotent) ?? false,
  };
}

function assertNoClientIdentityFields(body: Record<string, unknown>): void {
  const forbiddenFields = [
    "user_id",
    "userId",
    "telegram_user_id",
    "telegramUserId",
  ].filter((field) => body[field] !== undefined);

  if (forbiddenFields.length > 0) {
    throw new ApiError(400, "VALIDATION_ERROR", "请求参数校验失败。", {
      details: forbiddenFields.map((field) => ({
        path: field,
        message: "签到请求不能携带用户身份字段。",
      })),
    });
  }
}

function readString(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value : null;
}

function readNumber(value: unknown): number | null {
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
