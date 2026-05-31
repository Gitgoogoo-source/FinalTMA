import { callRpcRaw, RpcError } from "../../packages/server/src/db/rpc.js";
import { assertCronRequest } from "../_shared/cron.js";
import { ApiError, withApiHandler } from "../_shared/handler.js";

type SyncCampaignBoxStatusesPayload = {
  campaigns_ended_count: number;
  boxes_activated_count: number;
  boxes_ended_count: number;
  boxes_sold_out_count: number;
  box_activation_blocked_count: number;
  app_event_id: string;
  server_time: string;
  duration_ms: number;
};

export default withApiHandler(
  async (req, _res, ctx) => {
    assertCronRequest(req);

    try {
      const payload = await callRpcRaw<Record<string, unknown>>(
        "sync_campaign_box_statuses",
        {
          p_request_context: {
            request_id: ctx.requestId,
            method: ctx.method,
            source: "vercel.cron",
          },
          p_now: null,
        },
        {
          schema: "api" as never,
          context: {
            requestId: ctx.requestId,
            source: "cron.sync_campaign_box_statuses",
          },
        },
      );

      return normalizeSyncPayload(payload);
    } catch (error) {
      throw mapSyncError(error, ctx.requestId);
    }
  },
  {
    methods: ["GET", "POST"],
    rateLimit: {
      action: "cron.job",
    },
  },
);

function normalizeSyncPayload(
  payload: unknown,
): SyncCampaignBoxStatusesPayload {
  if (!isRecord(payload)) {
    throw invalidSyncResult();
  }

  const appEventId = readString(payload.app_event_id);
  const serverTime = readIsoDateString(payload.server_time);

  if (!appEventId || !serverTime) {
    throw invalidSyncResult({
      app_event_id: payload.app_event_id,
      server_time: payload.server_time,
    });
  }

  return {
    campaigns_ended_count: readNonNegativeInteger(
      payload.campaigns_ended_count,
    ),
    boxes_activated_count: readNonNegativeInteger(
      payload.boxes_activated_count,
    ),
    boxes_ended_count: readNonNegativeInteger(payload.boxes_ended_count),
    boxes_sold_out_count: readNonNegativeInteger(payload.boxes_sold_out_count),
    box_activation_blocked_count: readNonNegativeInteger(
      payload.box_activation_blocked_count,
    ),
    app_event_id: appEventId,
    server_time: serverTime,
    duration_ms: readNonNegativeInteger(payload.duration_ms),
  };
}

function mapSyncError(error: unknown, requestId: string): ApiError {
  if (error instanceof ApiError) {
    return error;
  }

  logCronFailure(error, requestId);

  if (error instanceof RpcError) {
    return new ApiError(
      500,
      "CAMPAIGN_BOX_STATUS_SYNC_RPC_FAILED",
      "同步活动和盲盒状态失败，请稍后重试。",
      {
        cause: error,
        expose: false,
      },
    );
  }

  return ApiError.internal("同步活动和盲盒状态失败，请稍后重试。", {
    cause: error instanceof Error ? error.message : String(error),
  });
}

function invalidSyncResult(details?: unknown): ApiError {
  return new ApiError(
    500,
    "CAMPAIGN_BOX_STATUS_SYNC_RESULT_INVALID",
    "活动和盲盒状态同步结果格式无效。",
    {
      details,
      expose: false,
    },
  );
}

function logCronFailure(error: unknown, requestId: string): void {
  const message = error instanceof Error ? error.message : String(error);

  console.error("cron.sync_campaign_box_statuses failed", {
    requestId,
    message,
  });
}

function readString(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }

  const trimmed = value.trim();

  return trimmed.length > 0 ? trimmed : null;
}

function readIsoDateString(value: unknown): string | null {
  const text = readString(value);

  if (!text) {
    return null;
  }

  const date = new Date(text);

  if (Number.isNaN(date.getTime())) {
    return null;
  }

  return date.toISOString();
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
