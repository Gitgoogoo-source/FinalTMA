import type { VercelRequest } from "@vercel/node";

import {
  RewardHistoryQuerySchema,
  type RewardHistoryQuery,
  type RewardHistorySource,
} from "../../packages/validation/src/task.schemas.js";
import { ApiError } from "../_shared/handler.js";
import { getSupabaseAdmin } from "../_shared/requireSession.js";
import { validate } from "../_shared/validate.js";
import {
  assertNoClientControlledTaskFields,
  compactRecord,
  firstQueryValue,
  isRecord,
  readIsoDateString,
  readNumber,
  readString,
  withTaskApiHandler,
} from "./_shared.js";

type RewardLedgerRow = {
  id: string;
  currency_code: string;
  entry_type: string;
  amount: string | number;
  source_type: string;
  source_id: string | null;
  created_at: string;
};

const REWARD_HISTORY_SOURCE_TYPES = [
  "task_claim",
  "daily_check_in",
  "referral_first_open",
  "referral_commission_claim",
] as const satisfies readonly RewardHistorySource[];

export default withTaskApiHandler(
  async (req, _res, ctx) => {
    const input = validate(
      RewardHistoryQuerySchema,
      normalizeRewardHistoryQuery(req),
    );
    const payload = await loadRewardHistory(input, ctx.session.userId);

    return normalizeRewardHistoryPayload(payload);
  },
  {
    methods: ["GET"],
    rateLimit: {
      action: "tasks.reward_history",
    },
  },
);

export function normalizeRewardHistoryQuery(
  req: VercelRequest,
): Record<string, unknown> {
  assertNoClientControlledTaskFields(req.query);

  return {
    cursor: firstQueryValue(req.query.cursor),
    limit: firstQueryValue(req.query.limit),
    source: firstQueryValue(req.query.source ?? req.query.source_type),
  };
}

async function loadRewardHistory(
  input: RewardHistoryQuery,
  userId: string,
): Promise<{ rows: RewardLedgerRow[]; limit: number }> {
  const limit = input.limit ?? 20;
  const cursor = normalizeCursor(input.cursor);
  const sourceTypes = input.source
    ? [input.source]
    : [...REWARD_HISTORY_SOURCE_TYPES];
  const db = getSupabaseAdmin();

  let query = db
    .schema("economy")
    .from("currency_ledger")
    .select(
      "id,currency_code,entry_type,amount,source_type,source_id,created_at",
    )
    .eq("user_id", userId)
    .eq("entry_type", "credit")
    .in("source_type", sourceTypes);

  if (cursor) {
    query = query.lt("created_at", cursor);
  }

  const { data, error } = await query
    .order("created_at", { ascending: false })
    .order("id", { ascending: false })
    .limit(limit + 1);

  if (error) {
    throw new ApiError(
      500,
      "TASK_REWARD_HISTORY_LOOKUP_FAILED",
      "获取奖励流水失败，请稍后重试。",
      {
        details: error,
        expose: false,
      },
    );
  }

  return {
    rows: Array.isArray(data) ? data.filter(isRewardLedgerRow) : [],
    limit,
  };
}

export function normalizeRewardHistoryPayload(payload: {
  rows: RewardLedgerRow[];
  limit: number;
}) {
  const visibleRows = payload.rows.slice(0, payload.limit);
  const nextCursor =
    payload.rows.length > payload.limit
      ? readIsoDateString(visibleRows.at(-1)?.created_at)
      : null;

  return {
    items: visibleRows
      .map(normalizeRewardHistoryRecord)
      .filter((item): item is Record<string, unknown> => item !== null),
    count: visibleRows.length,
    next_cursor: nextCursor,
    server_time: new Date().toISOString(),
  };
}

function normalizeRewardHistoryRecord(
  value: unknown,
): Record<string, unknown> | null {
  if (!isRecord(value)) {
    return null;
  }

  const rewardId = readString(value.id);
  const sourceType = readString(value.source_type);
  const currencyCode = readString(value.currency_code);
  const createdAt = readIsoDateString(value.created_at);

  if (!rewardId || !sourceType || !currencyCode || !createdAt) {
    return null;
  }

  return compactRecord({
    reward_id: rewardId,
    source_type: sourceType,
    source_label: getRewardSourceLabel(sourceType),
    source_id: readString(value.source_id),
    currency_code: currencyCode,
    entry_type: readString(value.entry_type) ?? "credit",
    amount: readInteger(value.amount) ?? 0,
    created_at: createdAt,
  });
}

function isRewardLedgerRow(value: unknown): value is RewardLedgerRow {
  if (!isRecord(value)) {
    return false;
  }

  return (
    readString(value.id) !== null &&
    readString(value.currency_code) !== null &&
    readString(value.entry_type) !== null &&
    (typeof value.amount === "string" || typeof value.amount === "number") &&
    readString(value.source_type) !== null &&
    (value.source_id === null || readString(value.source_id) !== null) &&
    readIsoDateString(value.created_at) !== null
  );
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

function getRewardSourceLabel(sourceType: string): string {
  switch (sourceType) {
    case "task_claim":
      return "任务奖励";
    case "daily_check_in":
      return "签到奖励";
    case "referral_first_open":
      return "邀请首开奖励";
    case "referral_commission_claim":
      return "邀请分红";
    default:
      return "奖励";
  }
}

function readInteger(value: unknown): number | null {
  const numberValue = readNumber(value);
  return numberValue === null ? null : Math.trunc(numberValue);
}
