import {
  AlbumSeriesQuerySchema,
  type AlbumSeriesQuery,
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
  parseOffsetCursor,
  readInteger,
  readString,
} from "./_shared.js";

type AlbumSeriesRpcPayload = Record<string, unknown>;

const UNSUPPORTED_SERIES_FILTERS: Array<keyof AlbumSeriesQuery> = [
  "keyword",
  "status",
  "types",
];

export default withApiHandler(
  async (req, _res, ctx) => {
    const session = await requireSession(req);
    const query = validate(AlbumSeriesQuerySchema, req.query);
    assertSupportedAlbumSeriesQuery(query);
    const offset = parseOffsetCursor(query.cursor, "图鉴册分页 cursor 无效。");

    const payload = await callAlbumSeriesRpc(
      session.userId,
      query,
      offset,
      ctx.requestId,
    );

    return normalizeAlbumSeriesPayload(payload, offset, query.limit);
  },
  {
    methods: ["GET"],
    rateLimit: {
      action: "album.series",
    },
  },
);

async function callAlbumSeriesRpc(
  userId: string,
  query: AlbumSeriesQuery,
  offset: number,
  requestId: string,
): Promise<AlbumSeriesRpcPayload> {
  try {
    return await callRpcRaw<AlbumSeriesRpcPayload>(
      "album_list_books",
      {
        p_user_id: userId,
        p_book_type: query.book_type ?? null,
        p_series_ids: query.series_ids ?? null,
        p_faction_ids: query.faction_ids ?? null,
        p_rarities: query.rarities ?? null,
        p_limit: query.limit,
        p_offset: offset,
      },
      {
        schema: "api" as never,
        context: {
          requestId,
          userId,
          bookType: query.book_type,
          limit: query.limit,
          offset,
        },
      },
    );
  } catch (error) {
    throw mapAlbumSeriesRpcError(error);
  }
}

export function normalizeAlbumSeriesPayload(
  payload: unknown,
  requestOffset: number,
  requestLimit: number,
) {
  const result = assertRecordPayload(
    payload,
    "ALBUM_SERIES_RESULT_INVALID",
    "图鉴册列表结果格式无效。",
  );

  return {
    books: Array.isArray(result.books)
      ? result.books
          .map((book) =>
            normalizeAlbumBook(book, "ALBUM_SERIES_RESULT_INVALID"),
          )
          .filter((book) => book !== null)
      : [],
    total: readInteger(result.total) ?? 0,
    limit: readInteger(result.limit) ?? requestLimit,
    offset: readInteger(result.offset) ?? requestOffset,
    next_cursor: readString(result.next_cursor),
    server_time: readString(result.server_time) ?? new Date().toISOString(),
  };
}

function assertSupportedAlbumSeriesQuery(query: AlbumSeriesQuery): void {
  const unsupported = UNSUPPORTED_SERIES_FILTERS.filter((key) => {
    if (key === "status") {
      return query.status !== "all";
    }

    const value = query[key];

    if (Array.isArray(value)) {
      return value.length > 0;
    }

    return value !== undefined;
  });

  if (unsupported.length > 0) {
    throw ApiError.badRequest("图鉴册接口暂不支持这些筛选条件。", {
      unsupported,
    });
  }
}

function mapAlbumSeriesRpcError(error: unknown): ApiError {
  if (error instanceof ApiError) {
    return error;
  }

  if (!(error instanceof RpcError)) {
    return ApiError.internal("查询图鉴册列表失败。", {
      cause: getErrorMessage(error),
    });
  }

  const message = getRpcErrorText(error);

  if (message.includes("user_id is required")) {
    return ApiError.unauthorized("缺少用户会话。");
  }

  return new ApiError(500, "ALBUM_SERIES_RPC_FAILED", "查询图鉴册列表失败。", {
    cause: error,
    expose: false,
  });
}
