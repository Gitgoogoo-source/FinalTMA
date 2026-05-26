import type { VercelRequest } from "@vercel/node";

import {
  TaskListQuerySchema,
  type TaskListQuery,
} from "../../packages/validation/src/task.schemas.js";
import { validate } from "../_shared/validate.js";
import {
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

const MAX_FILTERED_RPC_LIMIT = 200;

const TASK_CATEGORY_TO_RPC_TYPES: Partial<Record<string, string[]>> = {
  DAILY: ["daily"],
  SOCIAL: ["social", "referral"],
  TRADE: ["trade"],
  GACHA: ["gacha"],
  ALBUM: ["album"],
  WALLET: ["onchain"],
  ONCHAIN: ["onchain"],
  GAME: ["one_time"],
  EVENT: ["one_time"],
  SYSTEM: ["one_time"],
};

const TASK_STATUS_TO_RPC_STATUS: Partial<Record<string, string>> = {
  NOT_STARTED: "in_progress",
  IN_PROGRESS: "in_progress",
  CLAIMABLE: "completed",
  CLAIMED: "claimed",
  EXPIRED: "expired",
};

export default withTaskApiHandler(
  async (req, _res, ctx) => {
    const input = validate(TaskListQuerySchema, normalizeTaskListQuery(req));
    const taskTypes = resolveRpcTaskTypes(input.categories);
    const statuses = resolveRpcStatuses(input.statuses);

    if (
      ((input.categories?.length ?? 0) > 0 && taskTypes.length === 0) ||
      ((input.statuses?.length ?? 0) > 0 && statuses.length === 0)
    ) {
      return emptyTaskListResponse(input);
    }

    const payload = await callTaskListRpc(
      input,
      taskTypes,
      statuses,
      ctx.session,
      ctx.requestId,
    );

    return normalizeTaskListPayload(payload, input, taskTypes, statuses);
  },
  {
    methods: ["GET"],
    rateLimit: {
      action: "tasks.list",
    },
  },
);

export function normalizeTaskListQuery(
  req: VercelRequest,
): Record<string, unknown> {
  return {
    cursor: firstQueryValue(req.query.cursor),
    limit: firstQueryValue(req.query.limit),
    categories: normalizeCsvEnumQuery(
      req.query.categories ?? req.query.category ?? req.query.task_type,
    ),
    statuses: normalizeCsvEnumQuery(req.query.statuses ?? req.query.status),
    periodType: normalizeUpperQuery(
      firstQueryValue(req.query.periodType ?? req.query.period_type),
    ),
    periodKey: firstQueryValue(req.query.periodKey ?? req.query.period_key),
    includeClaimed: firstQueryValue(
      req.query.includeClaimed ?? req.query.include_claimed,
    ),
    includeExpired: firstQueryValue(
      req.query.includeExpired ?? req.query.include_expired,
    ),
  };
}

async function callTaskListRpc(
  input: TaskListQuery,
  taskTypes: string[],
  statuses: string[],
  session: { userId: string },
  requestId: string,
): Promise<unknown> {
  const filters = buildTaskListRpcFilters(input, taskTypes, statuses);

  try {
    return await callTaskUserRpcRaw(
      "task_get_list",
      session,
      {
        p_filters: filters,
      },
      {
        requestId,
        filters,
      },
    );
  } catch (error) {
    throw mapTaskRpcError(
      error,
      "TASK_LIST_RPC_FAILED",
      "获取任务列表失败，请稍后重试。",
    );
  }
}

function buildTaskListRpcFilters(
  input: TaskListQuery,
  taskTypes: string[],
  statuses: string[],
): Record<string, unknown> {
  const needsPostFilter =
    taskTypes.length > 1 ||
    statuses.length > 1 ||
    input.includeClaimed === false ||
    input.includeExpired === false;

  return compactRecord({
    task_type: taskTypes.length === 1 ? taskTypes[0] : undefined,
    status: statuses.length === 1 ? statuses[0] : undefined,
    period_key: input.periodKey,
    limit: needsPostFilter
      ? MAX_FILTERED_RPC_LIMIT
      : Math.min(input.limit ?? 20, MAX_FILTERED_RPC_LIMIT),
  });
}

export function normalizeTaskListPayload(
  payload: unknown,
  input: TaskListQuery,
  taskTypes: string[] = resolveRpcTaskTypes(input.categories),
  statuses: string[] = resolveRpcStatuses(input.statuses),
) {
  const result = assertTaskRecordPayload(
    payload,
    "TASK_LIST_RESULT_INVALID",
    "任务列表结果格式无效。",
  );
  const rawTasks = Array.isArray(result.tasks) ? result.tasks : [];
  const items = rawTasks
    .map(normalizeTaskListItem)
    .filter((item): item is Record<string, unknown> => item !== null);
  const filteredItems = filterTaskListItems(items, input, taskTypes, statuses);
  const limitedItems = filteredItems.slice(0, input.limit ?? 20);

  return {
    items: limitedItems,
    tasks: limitedItems,
    count: limitedItems.length,
    next_cursor: null,
    filters: isRecord(result.filters) ? result.filters : {},
    server_time: readString(result.server_time) ?? new Date().toISOString(),
  };
}

function normalizeTaskListItem(value: unknown): Record<string, unknown> | null {
  if (!isRecord(value)) {
    return null;
  }

  const taskId = readString(value.task_id ?? value.taskId);
  const code = readString(value.code);

  if (!taskId || !code) {
    return null;
  }

  const progress = isRecord(value.progress) ? value.progress : {};
  const taskType = readString(value.task_type ?? value.category);
  const periodType = readString(value.period_type ?? value.periodType);
  const progressCount =
    readInteger(progress.progress_count) ?? readInteger(progress.current) ?? 0;
  const targetCount =
    readInteger(progress.target_count) ??
    readInteger(progress.target) ??
    readInteger(value.target_count) ??
    1;
  const status =
    readString(progress.status ?? value.status ?? value.task_status) ??
    "in_progress";
  const periodKey = readString(progress.period_key ?? value.period_key);
  const rewards = Array.isArray(value.reward)
    ? value.reward
    : Array.isArray(value.rewards)
      ? value.rewards
      : [];

  return compactRecord({
    task_id: taskId,
    code,
    task_type: taskType,
    category: taskType,
    title: readString(value.title) ?? code,
    description: readString(value.description),
    period_type: periodType,
    target_count: targetCount,
    reward: rewards,
    rewards,
    action_type: readString(value.action_type ?? value.actionType),
    action_url: readString(value.action_url ?? value.actionRoute),
    active: readBoolean(value.active),
    sort_order: readInteger(value.sort_order) ?? 0,
    metadata: isRecord(value.metadata) ? value.metadata : {},
    status,
    period_key: periodKey,
    completed_at: readIsoDateString(progress.completed_at),
    claimed_at: readIsoDateString(progress.claimed_at),
    progress: compactRecord({
      progress_id: readString(progress.progress_id),
      period_key: periodKey,
      progress_count: progressCount,
      target_count: targetCount,
      current: progressCount,
      target: targetCount,
      percent: calculatePercent(progressCount, targetCount),
      status,
      completed_at: readIsoDateString(progress.completed_at),
      claimed_at: readIsoDateString(progress.claimed_at),
      updated_at: readIsoDateString(progress.updated_at),
    }),
  });
}

function filterTaskListItems(
  items: Record<string, unknown>[],
  input: TaskListQuery,
  taskTypes: string[],
  statuses: string[],
): Record<string, unknown>[] {
  return items.filter((item) => {
    const taskType = readString(item.task_type ?? item.category);
    const status = readString(item.status);

    if (taskTypes.length > 0 && (!taskType || !taskTypes.includes(taskType))) {
      return false;
    }

    if (statuses.length > 0 && (!status || !statuses.includes(status))) {
      return false;
    }

    if (input.includeClaimed === false && status === "claimed") {
      return false;
    }

    if (input.includeExpired === false && status === "expired") {
      return false;
    }

    return true;
  });
}

function emptyTaskListResponse(input: TaskListQuery) {
  return {
    items: [],
    tasks: [],
    count: 0,
    next_cursor: null,
    filters: compactRecord({
      categories: input.categories,
      statuses: input.statuses,
      period_key: input.periodKey,
      limit: input.limit,
    }),
    server_time: new Date().toISOString(),
  };
}

function resolveRpcTaskTypes(
  categories: TaskListQuery["categories"],
): string[] {
  if (!categories || categories.length === 0) {
    return [];
  }

  return uniqueStrings(
    categories
      .flatMap((category) => TASK_CATEGORY_TO_RPC_TYPES[category] ?? [])
      .filter((category): category is string => Boolean(category)),
  );
}

function resolveRpcStatuses(statuses: TaskListQuery["statuses"]): string[] {
  if (!statuses || statuses.length === 0) {
    return [];
  }

  return uniqueStrings(
    statuses
      .map((status) => TASK_STATUS_TO_RPC_STATUS[status])
      .filter((status): status is string => Boolean(status)),
  );
}

function normalizeCsvEnumQuery(value: unknown): string[] | undefined {
  if (value === undefined) {
    return undefined;
  }

  const values = Array.isArray(value) ? value : [value];
  return values.flatMap((item) =>
    String(item)
      .split(",")
      .map((part) => part.trim().replace(/-/g, "_").toUpperCase())
      .filter(Boolean),
  );
}

function normalizeUpperQuery(value: unknown): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }

  const normalized = value.trim().replace(/-/g, "_").toUpperCase();
  return normalized.length > 0 ? normalized : undefined;
}

function uniqueStrings(values: string[]): string[] {
  return [...new Set(values)];
}

function calculatePercent(current: number, target: number): number {
  if (target <= 0) {
    return 0;
  }

  return Math.max(0, Math.min(100, (current / target) * 100));
}

function readInteger(value: unknown): number | null {
  const numberValue = readNumber(value);
  return numberValue === null ? null : Math.trunc(numberValue);
}
