import {
  InventoryListQuerySchema,
  type InventoryListQuery,
} from "../../packages/validation/src/inventory.schemas.js";
import { callRpcRaw, RpcError } from "../../packages/server/src/db/rpc.js";
import { ApiError, withApiHandler } from "../_shared/handler.js";
import { requireSession } from "../_shared/requireSession.js";
import { validate } from "../_shared/validate.js";
import { toInventoryListItem } from "./list.js";

type InventorySummaryRpcPayload = {
  groups?: unknown;
  total?: unknown;
  group_total?: unknown;
  summary?: unknown;
  statuses?: unknown;
  server_time?: unknown;
};

type InventorySummaryRpcGroup = {
  group_key?: unknown;
  template_id?: unknown;
  form_id?: unknown;
  owned_count?: unknown;
  available_count?: unknown;
  listed_count?: unknown;
  locked_count?: unknown;
  minting_count?: unknown;
  minted_count?: unknown;
  max_level?: unknown;
  max_power?: unknown;
  latest_obtained_at?: unknown;
  representative_item?: unknown;
};

export default withApiHandler(
  async (req, _res, ctx) => {
    const session = await requireSession(req);
    const query = validate(InventoryListQuerySchema, req.query);
    const statuses = resolveStatuses(query);
    const payload = await callInventorySummaryRpc(
      session.userId,
      statuses,
      ctx.requestId,
    );

    return buildInventorySummaryResponse(payload);
  },
  {
    methods: ["GET"],
    rateLimit: {
      action: "inventory.list",
    },
  },
);

export function buildInventorySummaryResponse(
  payload: InventorySummaryRpcPayload,
) {
  const groups = Array.isArray(payload.groups)
    ? payload.groups.map(toInventorySummaryGroup).filter(isSummaryGroup)
    : [];
  const summary = normalizeSummaryCounts(payload.summary);

  return {
    groups,
    total: numberOrFallback(payload.total, summary.total_count),
    group_total: numberOrFallback(payload.group_total, groups.length),
    summary: {
      ...summary,
      total_count: numberOrFallback(payload.total, summary.total_count),
      group_count: numberOrFallback(payload.group_total, groups.length),
    },
    statuses: Array.isArray(payload.statuses)
      ? payload.statuses.filter(isString)
      : [],
    server_time: stringOrNull(payload.server_time) ?? new Date().toISOString(),
  };
}

async function callInventorySummaryRpc(
  userId: string,
  statuses: string[],
  requestId: string,
): Promise<InventorySummaryRpcPayload> {
  try {
    return await callRpcRaw<InventorySummaryRpcPayload>(
      "inventory_get_collection_summary",
      {
        p_user_id: userId,
        p_statuses: statuses,
      },
      {
        schema: "api" as never,
        context: {
          requestId,
          userId,
          statuses,
        },
      },
    );
  } catch (error) {
    throw mapInventorySummaryRpcError(error);
  }
}

function toInventorySummaryGroup(value: unknown) {
  const group = isRecord(value) ? (value as InventorySummaryRpcGroup) : {};
  const representativeItem = toInventoryListItem(group.representative_item);
  const itemInstanceId = stringOrNull(representativeItem.item_instance_id);

  if (!itemInstanceId) {
    return null;
  }

  return {
    group_key:
      stringOrNull(group.group_key) ??
      `item:${itemInstanceId}`,
    template_id: stringOrNull(group.template_id),
    form_id: stringOrNull(group.form_id),
    owned_count: numberOrZero(group.owned_count),
    available_count: numberOrZero(group.available_count),
    listed_count: numberOrZero(group.listed_count),
    locked_count: numberOrZero(group.locked_count),
    minting_count: numberOrZero(group.minting_count),
    minted_count: numberOrZero(group.minted_count),
    max_level: nullableNumber(group.max_level),
    max_power: nullableNumber(group.max_power),
    latest_obtained_at: stringOrNull(group.latest_obtained_at),
    representative_item: representativeItem,
  };
}

function normalizeSummaryCounts(value: unknown) {
  const summary = isRecord(value) ? value : {};

  return {
    total_count: numberOrZero(summary.total_count),
    available_count: numberOrZero(summary.available_count),
    listed_count: numberOrZero(summary.listed_count),
    locked_count: numberOrZero(summary.locked_count),
    minting_count: numberOrZero(summary.minting_count),
    minted_count: numberOrZero(summary.minted_count),
    group_count: numberOrZero(summary.group_count),
  };
}

function resolveStatuses(query: InventoryListQuery): string[] {
  if (query.statuses && query.statuses.length > 0) {
    return query.statuses;
  }

  if (query.include_locked) {
    return ["available", "locked", "listed", "minting", "minted"];
  }

  return ["available", "listed", "minting", "minted"];
}

function mapInventorySummaryRpcError(error: unknown): ApiError {
  if (error instanceof ApiError) {
    return error;
  }

  if (!(error instanceof RpcError)) {
    return ApiError.internal("查询藏品摘要失败。", {
      cause: getErrorMessage(error),
    });
  }

  const message = error.message.toLowerCase();

  if (message.includes("user_id is required")) {
    return ApiError.unauthorized("缺少用户会话。");
  }

  return new ApiError(500, "INVENTORY_SUMMARY_FAILED", "查询藏品摘要失败。", {
    expose: false,
    cause: error,
  });
}

function nullableNumber(value: unknown): number | null {
  if (value === null || value === undefined) {
    return null;
  }

  return numberOrZero(value);
}

function numberOrFallback(value: unknown, fallback: number): number {
  const number = nullableNumber(value);

  return number ?? fallback;
}

function numberOrZero(value: unknown): number {
  if (typeof value === "number" && Number.isFinite(value)) {
    return Math.trunc(value);
  }

  if (typeof value === "string" && /^-?\d+(?:\.\d+)?$/.test(value)) {
    return Math.trunc(Number(value));
  }

  return 0;
}

function stringOrNull(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value : null;
}

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function isString(value: unknown): value is string {
  return typeof value === "string";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isSummaryGroup(
  value: ReturnType<typeof toInventorySummaryGroup>,
): value is Exclude<ReturnType<typeof toInventorySummaryGroup>, null> {
  return value !== null;
}
