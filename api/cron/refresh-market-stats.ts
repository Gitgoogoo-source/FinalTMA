import { timingSafeEqual } from "node:crypto";
import type { VercelRequest } from "@vercel/node";

import { callRpcRaw, RpcError } from "../../packages/server/src/db/rpc.js";
import { ApiError, withApiHandler } from "../_shared/handler.js";

type RefreshMarketStatsPayload = {
  snapshot_at: string | null;
  price_snapshot_count: number;
  depth_snapshot_count: number;
  price_health_update_count: number;
};

export default withApiHandler(
  async (req, _res, ctx) => {
    assertCronRequest(req);

    try {
      const payload = await callRpcRaw<Record<string, unknown>>(
        "market_refresh_price_stats",
        {},
        {
          schema: "api" as never,
          context: {
            requestId: ctx.requestId,
            source: "cron.refresh_market_stats",
          },
        },
      );

      return normalizeRefreshPayload(payload);
    } catch (error) {
      throw mapRefreshMarketStatsError(error);
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
  const isProductionLike =
    process.env.NODE_ENV === "production" ||
    process.env.VERCEL_ENV === "production";

  if (!expectedSecret && isProductionLike) {
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

function normalizeRefreshPayload(payload: unknown): RefreshMarketStatsPayload {
  if (!isRecord(payload)) {
    throw invalidRefreshResult();
  }

  return {
    snapshot_at: readString(payload.snapshot_at),
    price_snapshot_count: readNonNegativeInteger(payload.price_snapshot_count),
    depth_snapshot_count: readNonNegativeInteger(payload.depth_snapshot_count),
    price_health_update_count: readNonNegativeInteger(
      payload.price_health_update_count,
    ),
  };
}

function mapRefreshMarketStatsError(error: unknown): ApiError {
  if (error instanceof ApiError) {
    return error;
  }

  if (error instanceof RpcError) {
    return new ApiError(
      500,
      "MARKET_STATS_REFRESH_RPC_FAILED",
      "刷新市场统计失败，请稍后重试。",
      {
        cause: error,
        expose: false,
      },
    );
  }

  return ApiError.internal("刷新市场统计失败，请稍后重试。", {
    cause: error instanceof Error ? error.message : String(error),
  });
}

function invalidRefreshResult(): ApiError {
  return new ApiError(
    500,
    "MARKET_STATS_REFRESH_RESULT_INVALID",
    "市场统计刷新结果格式无效。",
    {
      expose: false,
    },
  );
}

function isCronApiDisabled(): boolean {
  const value = process.env.ENABLE_CRON_API;

  return typeof value === "string" && value.trim().toLowerCase() === "false";
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
  return typeof value === "string" && value.trim().length > 0 ? value : null;
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
