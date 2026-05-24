import {
  AlbumProgressQuerySchema,
  type AlbumProgressQuery,
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
  normalizeAlbumMilestone,
  normalizeRaritySummaryItem,
  normalizeSeriesSummaryItem,
  readBoolean,
  readString,
} from "./_shared.js";

type AlbumProgressRpcPayload = Record<string, unknown>;

export default withApiHandler(
  async (req, _res, ctx) => {
    const session = await requireSession(req);
    const query = validate(AlbumProgressQuerySchema, req.query);

    const payload = await callAlbumProgressRpc(
      session.userId,
      query,
      ctx.requestId,
    );

    return normalizeAlbumProgressPayload(payload);
  },
  {
    methods: ["GET"],
    rateLimit: {
      action: "album.progress",
    },
  },
);

async function callAlbumProgressRpc(
  userId: string,
  query: AlbumProgressQuery,
  requestId: string,
): Promise<AlbumProgressRpcPayload> {
  try {
    return await callRpcRaw<AlbumProgressRpcPayload>(
      "album_get_progress",
      {
        p_user_id: userId,
        p_book_id: query.book_id ?? null,
        p_book_type: query.book_type ?? null,
        p_series_id: query.series_id ?? null,
        p_faction_id: query.faction_id ?? null,
        p_rarity: query.rarity ?? null,
        p_include_items: query.include_items,
        p_include_milestones: query.include_milestones,
        p_include_rewards: query.include_rewards,
        p_include_locked_items: query.include_locked_items,
      },
      {
        schema: "api" as never,
        context: {
          requestId,
          userId,
          bookId: query.book_id,
          bookType: query.book_type,
        },
      },
    );
  } catch (error) {
    throw mapAlbumProgressRpcError(error);
  }
}

export function normalizeAlbumProgressPayload(payload: unknown) {
  const result = assertRecordPayload(
    payload,
    "ALBUM_PROGRESS_RESULT_INVALID",
    "图鉴进度结果格式无效。",
  );
  const book = normalizeAlbumBook(result.book, "ALBUM_PROGRESS_RESULT_INVALID");

  return {
    book,
    items: Array.isArray(result.items)
      ? result.items.map((item) =>
          normalizeAlbumItem(item, "ALBUM_PROGRESS_RESULT_INVALID"),
        )
      : [],
    milestones: Array.isArray(result.milestones)
      ? result.milestones.map((milestone) =>
          normalizeAlbumMilestone(milestone, "ALBUM_PROGRESS_RESULT_INVALID"),
        )
      : [],
    rarity_summary: Array.isArray(result.rarity_summary)
      ? result.rarity_summary.map((item) =>
          normalizeRaritySummaryItem(item, "ALBUM_PROGRESS_RESULT_INVALID"),
        )
      : [],
    series_summary: Array.isArray(result.series_summary)
      ? result.series_summary.map(normalizeSeriesSummaryItem)
      : [],
    empty: readBoolean(result.empty) ?? book === null,
    server_time: readString(result.server_time) ?? new Date().toISOString(),
  };
}

function mapAlbumProgressRpcError(error: unknown): ApiError {
  if (error instanceof ApiError) {
    return error;
  }

  if (!(error instanceof RpcError)) {
    return ApiError.internal("查询图鉴进度失败。", {
      cause: getErrorMessage(error),
    });
  }

  const message = getRpcErrorText(error);

  if (message.includes("user_id is required")) {
    return ApiError.unauthorized("缺少用户会话。");
  }

  return new ApiError(500, "ALBUM_PROGRESS_RPC_FAILED", "查询图鉴进度失败。", {
    cause: error,
    expose: false,
  });
}
