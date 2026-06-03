import {
  InventoryListQuerySchema,
  type InventoryListQuery,
} from "../../packages/validation/src/inventory.schemas.js";
import { callRpcRaw, RpcError } from "../../packages/server/src/db/rpc.js";
import { ApiError, withApiHandler } from "../_shared/handler.js";
import { normalizePublicStorageUrl } from "../_shared/publicStorageUrl.js";
import { requireSession } from "../_shared/requireSession.js";
import { validate } from "../_shared/validate.js";

type InventoryListRpcPayload = {
  items?: unknown;
  total?: unknown;
  limit?: unknown;
  offset?: unknown;
  statuses?: unknown;
  server_time?: unknown;
};

type InventoryRpcItem = {
  item_instance_id?: unknown;
  template_id?: unknown;
  template_slug?: unknown;
  name?: unknown;
  subtitle?: unknown;
  description?: unknown;
  rarity?: unknown;
  series?: unknown;
  form?: unknown;
  type_code?: unknown;
  serial_no?: unknown;
  level?: unknown;
  power?: unknown;
  status?: unknown;
  nft_mint_status?: unknown;
  image_url?: unknown;
  thumbnail_url?: unknown;
  avatar_url?: unknown;
  tradeable?: unknown;
  upgradeable?: unknown;
  evolvable?: unknown;
  decomposable?: unknown;
  nft_mintable?: unknown;
  source_type?: unknown;
  source_id?: unknown;
  obtained_at?: unknown;
};

export default withApiHandler(
  async (req, _res, ctx) => {
    const session = await requireSession(req);
    const query = validate(InventoryListQuerySchema, req.query);
    const offset = parseOffsetCursor(query.cursor);
    const statuses = resolveStatuses(query);
    const payload = await callInventoryListRpc(
      session.userId,
      statuses,
      query.limit,
      offset,
      ctx.requestId,
    );

    return buildInventoryListResponse(payload, offset, query.limit);
  },
  {
    methods: ["GET"],
    rateLimit: {
      action: "inventory.list",
    },
  },
);

export function buildInventoryListResponse(
  payload: InventoryListRpcPayload,
  requestOffset: number,
  requestLimit: number,
) {
  const items = Array.isArray(payload.items)
    ? payload.items.map(toInventoryListItem)
    : [];
  const total = numberOrZero(payload.total);
  const responseOffset = numberOrFallback(payload.offset, requestOffset);
  const responseLimit = numberOrFallback(payload.limit, requestLimit);
  const nextOffset = responseOffset + responseLimit;

  return {
    items,
    total,
    limit: responseLimit,
    offset: responseOffset,
    next_cursor: nextOffset < total ? String(nextOffset) : null,
    statuses: Array.isArray(payload.statuses)
      ? payload.statuses.filter(isString)
      : [],
    server_time: stringOrNull(payload.server_time) ?? new Date().toISOString(),
  };
}

async function callInventoryListRpc(
  userId: string,
  statuses: string[],
  limit: number,
  offset: number,
  requestId: string,
): Promise<InventoryListRpcPayload> {
  try {
    return await callRpcRaw<InventoryListRpcPayload>(
      "inventory_list_user_items",
      {
        p_user_id: userId,
        p_statuses: statuses,
        p_limit: limit,
        p_offset: offset,
      },
      {
        schema: "api" as never,
        context: {
          requestId,
          userId,
          statuses,
          limit,
          offset,
        },
      },
    );
  } catch (error) {
    throw mapInventoryRpcError(error);
  }
}

function toInventoryListItem(value: unknown) {
  const item = isRecord(value) ? (value as InventoryRpcItem) : {};
  const rarity = isRecord(item.rarity) ? item.rarity : null;
  const series = isRecord(item.series) ? item.series : null;
  const form = isRecord(item.form) ? item.form : null;

  return {
    item_instance_id: stringOrNull(item.item_instance_id),
    template_id: stringOrNull(item.template_id),
    template_slug: stringOrNull(item.template_slug),
    name: stringOrNull(item.name) ?? "Unknown item",
    subtitle: stringOrNull(item.subtitle),
    description: stringOrNull(item.description),
    rarity: rarity
      ? {
          code: stringOrNull(rarity.code),
          display_name: stringOrNull(rarity.display_name),
          sort_order: nullableNumber(rarity.sort_order),
        }
      : null,
    series: series
      ? {
          id: stringOrNull(series.id),
          slug: stringOrNull(series.slug),
          display_name: stringOrNull(series.display_name),
        }
      : null,
    form: form
      ? {
          id: stringOrNull(form.id),
          index: nullableNumber(form.index),
          display_name: stringOrNull(form.display_name),
        }
      : null,
    type_code: stringOrNull(item.type_code),
    serial_no: nullableNumber(item.serial_no),
    level: numberOrZero(item.level),
    power: numberOrZero(item.power),
    status: stringOrNull(item.status),
    nft_mint_status: stringOrNull(item.nft_mint_status),
    image_url:
      normalizePublicStorageUrl(item.image_url) ??
      normalizePublicStorageUrl(item.thumbnail_url) ??
      normalizePublicStorageUrl(item.avatar_url),
    thumbnail_url: normalizePublicStorageUrl(item.thumbnail_url),
    avatar_url: normalizePublicStorageUrl(item.avatar_url),
    is_tradeable: Boolean(item.tradeable),
    is_upgradeable: Boolean(item.upgradeable),
    is_evolvable: Boolean(item.evolvable),
    is_decomposable: Boolean(item.decomposable),
    is_mintable: Boolean(item.nft_mintable),
    source_type: stringOrNull(item.source_type),
    source_id: stringOrNull(item.source_id),
    obtained_at: stringOrNull(item.obtained_at),
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

function parseOffsetCursor(cursor: string | undefined): number {
  if (!cursor) {
    return 0;
  }

  const parsed = Number.parseInt(cursor, 10);

  if (
    !Number.isFinite(parsed) ||
    parsed < 0 ||
    String(parsed) !== cursor.trim()
  ) {
    throw ApiError.badRequest("库存分页 cursor 无效。");
  }

  return parsed;
}

function mapInventoryRpcError(error: unknown): ApiError {
  if (!(error instanceof RpcError)) {
    return error instanceof ApiError
      ? error
      : ApiError.internal("查询库存失败。", { cause: getErrorMessage(error) });
  }

  const message = error.message.toLowerCase();

  if (message.includes("user_id is required")) {
    return ApiError.unauthorized("缺少用户会话。");
  }

  return new ApiError(500, "INVENTORY_LIST_FAILED", "查询库存失败。", {
    expose: false,
    cause: error,
  });
}

function stringOrNull(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value : null;
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

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function isString(value: unknown): value is string {
  return typeof value === "string";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
