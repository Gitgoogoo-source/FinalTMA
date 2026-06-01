import { callRpcRaw, RpcError } from "../../packages/server/src/db/rpc.js";
import { assertCronRequest } from "../_shared/cron.js";
import {
  ApiError,
  getIdempotencyKey,
  withApiHandler,
} from "../_shared/handler.js";

type RebuildMarketStatsPayload = {
  status: "success" | "failed";
  snapshot_at: string | null;
  price_snapshot_count: number;
  depth_snapshot_count: number;
  price_health_update_count: number;
  start_app_event_id: string;
  end_app_event_id: string;
  failure_risk_event_id: string | null;
  server_time: string | null;
  duration_ms: number;
  error?: string | null;
};

export default withApiHandler(
  async (req, _res, ctx) => {
    assertCronRequest(req);
    const idempotencyKey = getIdempotencyKey(req) ?? buildCronIdempotencyKey();

    try {
      const payload = await callRpcRaw<Record<string, unknown>>(
        "market_rebuild_stats_job",
        {
          p_idempotency_key: idempotencyKey,
          p_request_context: {
            request_id: ctx.requestId,
            method: ctx.method,
            source: "vercel.cron",
            route: "rebuild-market-stats",
          },
        },
        {
          schema: "api" as never,
          context: {
            requestId: ctx.requestId,
            source: "cron.rebuild_market_stats",
          },
        },
      );
      const normalized = normalizeRebuildPayload(payload);

      if (normalized.status === "failed") {
        throw new ApiError(
          500,
          "MARKET_STATS_REBUILD_FAILED",
          "重建市场统计失败，请查看 cron app_event / risk_event。",
          {
            details: {
              startAppEventId: normalized.start_app_event_id,
              endAppEventId: normalized.end_app_event_id,
              failureRiskEventId: normalized.failure_risk_event_id,
              error: normalized.error,
            },
            expose: false,
          },
        );
      }

      return normalized;
    } catch (error) {
      throw mapRebuildMarketStatsError(error);
    }
  },
  {
    methods: ["GET", "POST"],
    rateLimit: {
      action: "cron.job",
    },
  },
);

function normalizeRebuildPayload(payload: unknown): RebuildMarketStatsPayload {
  if (!isRecord(payload)) {
    throw invalidRebuildResult();
  }

  const status = readStatus(payload.status);
  const startAppEventId = readRequiredString(payload.start_app_event_id);
  const endAppEventId = readRequiredString(payload.end_app_event_id);

  return {
    status,
    snapshot_at: readString(payload.snapshot_at),
    price_snapshot_count: readNonNegativeInteger(payload.price_snapshot_count),
    depth_snapshot_count: readNonNegativeInteger(payload.depth_snapshot_count),
    price_health_update_count: readNonNegativeInteger(
      payload.price_health_update_count,
    ),
    start_app_event_id: startAppEventId,
    end_app_event_id: endAppEventId,
    failure_risk_event_id: readString(payload.failure_risk_event_id),
    server_time: readString(payload.server_time),
    duration_ms: readNonNegativeInteger(payload.duration_ms),
    error: readString(payload.error),
  };
}

function mapRebuildMarketStatsError(error: unknown): ApiError {
  if (error instanceof ApiError) {
    return error;
  }

  if (error instanceof RpcError) {
    return new ApiError(
      500,
      "MARKET_STATS_REBUILD_RPC_FAILED",
      "重建市场统计失败，请稍后重试。",
      {
        cause: error,
        expose: false,
      },
    );
  }

  return ApiError.internal("重建市场统计失败，请稍后重试。", {
    cause: error instanceof Error ? error.message : String(error),
  });
}

function invalidRebuildResult(): ApiError {
  return new ApiError(
    500,
    "MARKET_STATS_REBUILD_RESULT_INVALID",
    "市场统计重建结果格式无效。",
    {
      expose: false,
    },
  );
}

function buildCronIdempotencyKey(): string {
  return `market-stats-rebuild:${new Date().toISOString().slice(0, 16)}`;
}

function readString(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value : null;
}

function readRequiredString(value: unknown): string {
  const stringValue = readString(value);

  if (!stringValue) {
    throw invalidRebuildResult();
  }

  return stringValue;
}

function readStatus(value: unknown): "success" | "failed" {
  const status = readString(value);

  if (status !== "success" && status !== "failed") {
    throw invalidRebuildResult();
  }

  return status;
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
