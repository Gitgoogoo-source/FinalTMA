import { timingSafeEqual } from "node:crypto";
import type { VercelRequest } from "@vercel/node";

import { callRpcRaw, RpcError } from "../../packages/server/src/db/rpc.js";
import { ApiError, withApiHandler } from "../_shared/handler.js";

type RefreshLeaderboardPayload = {
  board_id: string;
  week_key: string;
  starts_at: string;
  ends_at: string;
  entry_count: number;
  generated_at: string;
};

export default withApiHandler(
  async (req, _res, ctx) => {
    assertCronRequest(req);

    try {
      const payload = await callRpcRaw<Record<string, unknown>>(
        "album_refresh_weekly_leaderboard",
        {
          p_week_start: null,
        },
        {
          schema: "api" as never,
          context: {
            requestId: ctx.requestId,
            source: "cron.refresh_leaderboard",
          },
        },
      );

      return normalizeRefreshLeaderboardPayload(payload);
    } catch (error) {
      throw mapRefreshLeaderboardError(error);
    }
  },
  {
    methods: ["GET", "POST"],
    rateLimit: {
      action: "cron.job",
    },
  },
);

function assertCronRequest(req: VercelRequest): void {
  if (isCronApiDisabled()) {
    throw new ApiError(404, "CRON_DISABLED", "定时任务入口未启用。");
  }

  const expectedSecret = readEnv("CRON_SECRET");

  if (!expectedSecret && !isCronSecretOptional()) {
    throw new ApiError(500, "CRON_SECRET_MISSING", "定时任务密钥未配置。", {
      expose: false,
    });
  }

  if (!expectedSecret) {
    return;
  }

  const providedSecret = readBearerToken(req.headers.authorization);

  if (!providedSecret || !safeEqual(providedSecret, expectedSecret)) {
    throw new ApiError(401, "CRON_UNAUTHORIZED", "定时任务密钥无效。");
  }
}

function normalizeRefreshLeaderboardPayload(
  payload: unknown,
): RefreshLeaderboardPayload {
  if (!isRecord(payload)) {
    throw invalidRefreshLeaderboardResult();
  }

  const boardId = readString(payload.board_id);
  const weekKey = readString(payload.week_key);
  const startsAt = readIsoDateString(payload.starts_at);
  const endsAt = readIsoDateString(payload.ends_at);
  const generatedAt = readIsoDateString(payload.generated_at);

  if (!boardId || !weekKey || !startsAt || !endsAt || !generatedAt) {
    throw invalidRefreshLeaderboardResult({
      board_id: payload.board_id,
      week_key: payload.week_key,
      starts_at: payload.starts_at,
      ends_at: payload.ends_at,
      generated_at: payload.generated_at,
    });
  }

  return {
    board_id: boardId,
    week_key: weekKey,
    starts_at: startsAt,
    ends_at: endsAt,
    entry_count: readNonNegativeInteger(payload.entry_count),
    generated_at: generatedAt,
  };
}

function mapRefreshLeaderboardError(error: unknown): ApiError {
  if (error instanceof ApiError) {
    return error;
  }

  if (error instanceof RpcError) {
    const message = getRpcErrorText(error);

    if (message.includes("leaderboard score rules not configured")) {
      return new ApiError(
        500,
        "LEADERBOARD_REFRESH_FAILED",
        "排行榜计分规则未配置，刷新失败。",
        {
          cause: error,
          expose: false,
        },
      );
    }

    return new ApiError(
      500,
      "LEADERBOARD_REFRESH_FAILED",
      "刷新排行榜失败，请稍后重试。",
      {
        cause: error,
        expose: false,
      },
    );
  }

  return ApiError.internal("刷新排行榜失败，请稍后重试。", {
    cause: error instanceof Error ? error.message : String(error),
  });
}

function invalidRefreshLeaderboardResult(details?: unknown): ApiError {
  return new ApiError(
    500,
    "LEADERBOARD_REFRESH_RESULT_INVALID",
    "排行榜刷新结果格式无效。",
    {
      details,
      expose: false,
    },
  );
}

function isCronApiDisabled(): boolean {
  const value = process.env.ENABLE_CRON_API;

  return typeof value === "string" && value.trim().toLowerCase() === "false";
}

function isCronSecretOptional(): boolean {
  return process.env.NODE_ENV === "test" || process.env.APP_ENV === "local";
}

function readEnv(name: string): string | null {
  const value = process.env[name];

  if (typeof value !== "string") {
    return null;
  }

  const trimmed = value.trim();

  return trimmed.length > 0 ? trimmed : null;
}

function readBearerToken(value: string | string[] | undefined): string | null {
  const header = readHeader(value);

  if (!header) {
    return null;
  }

  const match = /^bearer\s+(.+)$/i.exec(header);

  return match?.[1]?.trim() ?? null;
}

function readHeader(
  value: string | string[] | number | undefined,
): string | null {
  if (Array.isArray(value)) {
    return value[0] ? String(value[0]) : null;
  }

  if (typeof value === "number") {
    return String(value);
  }

  if (typeof value !== "string") {
    return null;
  }

  const trimmed = value.trim();

  return trimmed.length > 0 ? trimmed : null;
}

function safeEqual(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);

  return left.length === right.length && timingSafeEqual(left, right);
}

function readString(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }

  const trimmed = value.trim();

  return trimmed.length > 0 ? trimmed : null;
}

function readNonNegativeInteger(value: unknown): number {
  const numberValue =
    typeof value === "number"
      ? value
      : typeof value === "string"
        ? Number.parseInt(value, 10)
        : 0;

  if (!Number.isFinite(numberValue) || numberValue < 0) {
    return 0;
  }

  return Math.trunc(numberValue);
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
