import {
  AlbumLeaderboardQuerySchema,
  AlbumLeaderboardResponseSchema,
  type AlbumLeaderboardQuery,
} from "../../packages/validation/src/album.schemas.js";
import { callRpcRaw, RpcError } from "../../packages/server/src/db/rpc.js";
import { ApiError, withApiHandler } from "../_shared/handler.js";
import { requireSession } from "../_shared/requireSession.js";
import { validate } from "../_shared/validate.js";

type AlbumLeaderboardRpcPayload = Record<string, unknown>;

export default withApiHandler(
  async (req, _res, ctx) => {
    const session = await requireSession(req);
    const query = validate(AlbumLeaderboardQuerySchema, req.query);
    const offset = parseOffsetCursor(query.cursor);

    const payload = await callAlbumLeaderboardRpc(
      session.userId,
      query,
      offset,
      ctx.requestId,
    );

    return normalizeAlbumLeaderboardPayload(payload, query);
  },
  {
    methods: ["GET"],
    rateLimit: {
      action: "album.leaderboard",
    },
  },
);

async function callAlbumLeaderboardRpc(
  userId: string,
  query: AlbumLeaderboardQuery,
  offset: number,
  requestId: string,
): Promise<AlbumLeaderboardRpcPayload> {
  try {
    return await callRpcRaw<AlbumLeaderboardRpcPayload>(
      "album_get_leaderboard",
      {
        p_user_id: userId,
        p_board_id: query.board_id ?? null,
        p_period: query.period,
        p_scope: query.scope,
        p_series_id: query.series_id ?? null,
        p_faction_id: query.faction_id ?? null,
        p_rarity: query.rarity ?? null,
        p_sort: query.sort,
        p_around_me: query.around_me,
        p_limit: query.limit,
        p_offset: offset,
      },
      {
        schema: "api" as never,
        context: {
          requestId,
          userId,
          boardId: query.board_id,
          period: query.period,
          scope: query.scope,
          sort: query.sort,
          limit: query.limit,
          offset,
        },
      },
    );
  } catch (error) {
    throw mapAlbumLeaderboardRpcError(error);
  }
}

export function normalizeAlbumLeaderboardPayload(
  payload: unknown,
  query: AlbumLeaderboardQuery,
) {
  const result = assertRecordPayload(
    payload,
    "ALBUM_LEADERBOARD_RESULT_INVALID",
    "排行榜结果格式无效。",
  );

  if (result.entries !== undefined && !Array.isArray(result.entries)) {
    throw invalidAlbumLeaderboardResult("排行榜 entries 格式无效。", {
      entries: result.entries,
    });
  }

  const normalized = {
    board_id: readString(result.board_id),
    period: readString(result.period) ?? query.period,
    scope: readString(result.scope) ?? query.scope,
    entries: Array.isArray(result.entries)
      ? result.entries.map(normalizeLeaderboardEntry)
      : [],
    my_entry:
      result.my_entry === null || result.my_entry === undefined
        ? null
        : normalizeLeaderboardEntry(result.my_entry),
    next_cursor: normalizeNextCursor(result.next_cursor),
    generated_at: readIsoDateString(result.generated_at),
  };

  const parsed = AlbumLeaderboardResponseSchema.safeParse(normalized);

  if (!parsed.success) {
    throw invalidAlbumLeaderboardResult("排行榜结果字段无效。", {
      issues: parsed.error.issues,
    });
  }

  return parsed.data;
}

function normalizeLeaderboardEntry(value: unknown) {
  const entry = isRecord(value) ? value : {};
  const rank = readInteger(entry.rank);
  const userId = readString(entry.user_id);
  const score = readInteger(entry.score);
  const completionPercent = readFiniteNumber(entry.completion_percent);
  const collectedCount = readInteger(entry.collected_count);
  const totalCount = readInteger(entry.total_count);
  const rareCount = readInteger(entry.rare_count);
  const epicCount = readInteger(entry.epic_count);
  const legendaryCount = readInteger(entry.legendary_count);
  const mintCount =
    readInteger(entry.mint_count) ?? readInteger(entry.minted_count);
  const updatedAt =
    readIsoDateString(entry.updated_at) ??
    readIsoDateString(entry.generated_at);

  if (
    rank === null ||
    !userId ||
    score === null ||
    completionPercent === null ||
    collectedCount === null ||
    totalCount === null ||
    rareCount === null ||
    epicCount === null ||
    legendaryCount === null ||
    mintCount === null ||
    !updatedAt
  ) {
    throw invalidAlbumLeaderboardResult("排行榜条目缺少必要字段。", {
      rank: entry.rank,
      user_id: entry.user_id,
      score: entry.score,
      completion_percent: entry.completion_percent,
      collected_count: entry.collected_count,
      total_count: entry.total_count,
      rare_count: entry.rare_count,
      epic_count: entry.epic_count,
      legendary_count: entry.legendary_count,
      mint_count: entry.mint_count,
      updated_at: entry.updated_at,
    });
  }

  return {
    rank,
    user_id: userId,
    display_name: readString(entry.display_name) ?? "Player",
    avatar_url: readString(entry.avatar_url),
    score,
    completion_percent: completionPercent,
    collected_count: collectedCount,
    total_count: totalCount,
    rare_count: rareCount,
    epic_count: epicCount,
    legendary_count: legendaryCount,
    mint_count: mintCount,
    updated_at: updatedAt,
  };
}

function normalizeNextCursor(value: unknown): string | null {
  const cursor = readString(value);

  if (cursor) {
    return cursor;
  }

  return null;
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
    throw ApiError.badRequest("排行榜分页 cursor 无效。");
  }

  return parsed;
}

function mapAlbumLeaderboardRpcError(error: unknown): ApiError {
  if (error instanceof ApiError) {
    return error;
  }

  if (!(error instanceof RpcError)) {
    return ApiError.internal("查询排行榜失败。", {
      cause: getErrorMessage(error),
    });
  }

  const message = getRpcErrorText(error);

  if (message.includes("user_id is required")) {
    return ApiError.unauthorized("缺少用户会话。");
  }

  if (message.includes("leaderboard not found")) {
    return new ApiError(404, "LEADERBOARD_NOT_FOUND", "排行榜不存在。");
  }

  if (message.includes("invalid cursor")) {
    return ApiError.badRequest("排行榜分页 cursor 无效。");
  }

  return new ApiError(500, "ALBUM_LEADERBOARD_RPC_FAILED", "查询排行榜失败。", {
    cause: error,
    expose: false,
  });
}

function assertRecordPayload(
  payload: unknown,
  code: string,
  message: string,
): Record<string, unknown> {
  if (!isRecord(payload)) {
    throw new ApiError(500, code, message, {
      expose: false,
      details: { payloadType: typeof payload },
    });
  }

  return payload;
}

function invalidAlbumLeaderboardResult(
  message: string,
  details?: unknown,
): ApiError {
  return new ApiError(500, "ALBUM_LEADERBOARD_RESULT_INVALID", message, {
    details,
    expose: false,
  });
}

function readString(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }

  const trimmed = value.trim();

  return trimmed.length > 0 ? trimmed : null;
}

function readInteger(value: unknown): number | null {
  const numberValue = readFiniteNumber(value);

  return numberValue === null ? null : Math.trunc(numberValue);
}

function readFiniteNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }

  if (typeof value === "string" && value.trim() !== "") {
    const parsed = Number(value);

    return Number.isFinite(parsed) ? parsed : null;
  }

  return null;
}

function readIsoDateString(value: unknown): string | null {
  const text = readString(value);

  if (!text) {
    return null;
  }

  const timestamp = Date.parse(text);

  return Number.isFinite(timestamp) ? new Date(timestamp).toISOString() : null;
}

function getRpcErrorText(error: RpcError): string {
  return [error.message, error.details, error.hint, error.code]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
}

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
