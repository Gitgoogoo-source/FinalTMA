import {
  AlbumItemsQuerySchema,
  type AlbumItemsQuery,
} from "../../packages/validation/src/album.schemas.js";
import { callRpcRaw, RpcError } from "../../packages/server/src/db/rpc.js";
import { ApiError, withApiHandler } from "../_shared/handler.js";
import { requireSession } from "../_shared/requireSession.js";
import { validate } from "../_shared/validate.js";
import {
  assertRecordPayload,
  getErrorMessage,
  getRpcErrorText,
  normalizeAlbumBook,
  normalizeAlbumItem,
  parseOffsetCursor,
  readString,
} from "./_shared.js";

type AlbumItemsRpcPayload = Record<string, unknown>;

const RARITY_WEIGHT: Record<string, number> = {
  common: 1,
  rare: 2,
  epic: 3,
  legendary: 4,
  mythic: 5,
};

type NormalizedAlbumItem = ReturnType<typeof normalizeAlbumItem>;

export default withApiHandler(
  async (req, _res, ctx) => {
    const session = await requireSession(req);
    const query = validate(AlbumItemsQuerySchema, req.query);
    const offset = parseOffsetCursor(
      query.cursor,
      "图鉴物品分页 cursor 无效。",
    );

    const payload = await callAlbumItemsRpc(
      session.userId,
      query,
      ctx.requestId,
    );

    return normalizeAlbumItemsPayload(payload, query, offset);
  },
  {
    methods: ["GET"],
    rateLimit: {
      action: "album.items",
    },
  },
);

async function callAlbumItemsRpc(
  userId: string,
  query: AlbumItemsQuery,
  requestId: string,
): Promise<AlbumItemsRpcPayload> {
  try {
    return await callRpcRaw<AlbumItemsRpcPayload>(
      "album_get_progress",
      {
        p_user_id: userId,
        p_book_id: query.book_id ?? null,
        p_book_type: null,
        p_series_id: query.series_id ?? null,
        p_faction_id: query.faction_id ?? null,
        p_rarity: query.rarity ?? null,
        p_include_items: true,
        p_include_milestones: false,
        p_include_rewards: false,
        p_include_locked_items: query.status !== "collected",
      },
      {
        schema: "api" as never,
        context: {
          requestId,
          userId,
          bookId: query.book_id,
          status: query.status,
          limit: query.limit,
        },
      },
    );
  } catch (error) {
    throw mapAlbumItemsRpcError(error);
  }
}

export function normalizeAlbumItemsPayload(
  payload: unknown,
  query: AlbumItemsQuery,
  offset: number,
) {
  const result = assertRecordPayload(
    payload,
    "ALBUM_ITEMS_RESULT_INVALID",
    "图鉴物品结果格式无效。",
  );
  const book = normalizeAlbumBook(result.book, "ALBUM_ITEMS_RESULT_INVALID");
  const items = Array.isArray(result.items)
    ? result.items.map((item) =>
        normalizeAlbumItem(item, "ALBUM_ITEMS_RESULT_INVALID"),
      )
    : [];
  const filtered = sortAlbumItems(filterAlbumItems(items, query), query.sort);
  const page = filtered.slice(offset, offset + query.limit);
  const nextOffset = offset + query.limit;

  return {
    book,
    items: page,
    total: filtered.length,
    limit: query.limit,
    offset,
    next_cursor: nextOffset < filtered.length ? String(nextOffset) : null,
    server_time: readString(result.server_time) ?? new Date().toISOString(),
  };
}

function filterAlbumItems(
  items: NormalizedAlbumItem[],
  query: AlbumItemsQuery,
): NormalizedAlbumItem[] {
  const keyword = query.keyword?.trim().toLowerCase();

  return items.filter((item) => {
    if (query.status === "collected" && !item.is_collected) {
      return false;
    }

    if (query.status === "uncollected" && item.is_collected) {
      return false;
    }

    if (query.type && item.type !== query.type) {
      return false;
    }

    if (keyword && !matchesKeyword(item, keyword)) {
      return false;
    }

    return true;
  });
}

function matchesKeyword(item: NormalizedAlbumItem, keyword: string): boolean {
  return [item.name, item.description, item.series_name, item.faction_name]
    .filter((value): value is string => typeof value === "string")
    .some((value) => value.toLowerCase().includes(keyword));
}

function sortAlbumItems(
  items: NormalizedAlbumItem[],
  sort: AlbumItemsQuery["sort"],
): NormalizedAlbumItem[] {
  return [...items].sort((left, right) => {
    if (sort === "rarity_desc" || sort === "rarity_asc") {
      const direction = sort === "rarity_desc" ? -1 : 1;
      return (
        direction * (rarityWeight(left.rarity) - rarityWeight(right.rarity)) ||
        compareAlbumOrder(left, right)
      );
    }

    if (sort === "name_asc" || sort === "name_desc") {
      const direction = sort === "name_desc" ? -1 : 1;
      return direction * left.name.localeCompare(right.name);
    }

    if (sort === "collected_at_desc") {
      return (
        compareCollectedAtDesc(left, right) || compareAlbumOrder(left, right)
      );
    }

    return compareAlbumOrder(left, right);
  });
}

function compareAlbumOrder(
  left: NormalizedAlbumItem,
  right: NormalizedAlbumItem,
): number {
  const leftOrder = left.album_order ?? Number.MAX_SAFE_INTEGER;
  const rightOrder = right.album_order ?? Number.MAX_SAFE_INTEGER;

  return leftOrder - rightOrder || left.name.localeCompare(right.name);
}

function compareCollectedAtDesc(
  left: NormalizedAlbumItem,
  right: NormalizedAlbumItem,
): number {
  const leftTime = readTime(left.first_collected_at);
  const rightTime = readTime(right.first_collected_at);

  return rightTime - leftTime;
}

function rarityWeight(rarity: string): number {
  return RARITY_WEIGHT[rarity] ?? 0;
}

function readTime(value: string | null): number {
  if (!value) {
    return 0;
  }

  const timestamp = Date.parse(value);

  return Number.isFinite(timestamp) ? timestamp : 0;
}

function mapAlbumItemsRpcError(error: unknown): ApiError {
  if (error instanceof ApiError) {
    return error;
  }

  if (!(error instanceof RpcError)) {
    return ApiError.internal("查询图鉴物品失败。", {
      cause: getErrorMessage(error),
    });
  }

  const message = getRpcErrorText(error);

  if (message.includes("user_id is required")) {
    return ApiError.unauthorized("缺少用户会话。");
  }

  return new ApiError(500, "ALBUM_ITEMS_RPC_FAILED", "查询图鉴物品失败。", {
    cause: error,
    expose: false,
  });
}
