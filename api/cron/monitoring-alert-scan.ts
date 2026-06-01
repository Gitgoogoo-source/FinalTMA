import { callRpcRaw, RpcError } from "../../packages/server/src/db/rpc.js";
import { assertCronRequest } from "../_shared/cron.js";
import {
  ApiError,
  getIdempotencyKey,
  withApiHandler,
} from "../_shared/handler.js";

type MonitoringAlertScanPayload = {
  server_time: string;
  idempotent: boolean;
  recorded_count: number;
  app_event_id: string | null;
  checks: Record<string, unknown>;
};

export default withApiHandler(
  async (req, _res, ctx) => {
    assertCronRequest(req);

    const idempotencyKey =
      getIdempotencyKey(req) ?? buildCronIdempotencyKey(new Date());

    try {
      const payload = await callRpcRaw<Record<string, unknown>>(
        "monitoring_scan_alerts",
        {
          p_idempotency_key: idempotencyKey,
          p_request_context: {
            request_id: ctx.requestId,
            method: ctx.method,
            source: "vercel.cron",
            route: "monitoring-alert-scan",
          },
          p_now: null,
        },
        {
          schema: "api" as never,
          context: {
            requestId: ctx.requestId,
            source: "cron.monitoring_alert_scan",
            idempotencyKey,
          },
        },
      );

      return normalizeScanPayload(payload);
    } catch (error) {
      throw mapScanError(error, ctx.requestId);
    }
  },
  {
    methods: ["GET", "POST"],
    rateLimit: {
      action: "cron.job",
    },
  },
);

function buildCronIdempotencyKey(now: Date): string {
  return `monitoring-alert-scan:${now.toISOString().slice(0, 16)}`;
}

function normalizeScanPayload(payload: unknown): MonitoringAlertScanPayload {
  if (!isRecord(payload)) {
    throw invalidScanResult();
  }

  const serverTime = readIsoDateString(payload.server_time);

  if (!serverTime) {
    throw invalidScanResult({
      server_time: payload.server_time,
    });
  }

  return {
    server_time: serverTime,
    idempotent: readBoolean(payload.idempotent),
    recorded_count: readNonNegativeInteger(payload.recorded_count),
    app_event_id: readString(payload.app_event_id),
    checks: isRecord(payload.checks) ? payload.checks : {},
  };
}

function mapScanError(error: unknown, requestId: string): ApiError {
  if (error instanceof ApiError) {
    return error;
  }

  logCronFailure(error, requestId);

  if (error instanceof RpcError) {
    return new ApiError(
      500,
      "MONITORING_ALERT_SCAN_RPC_FAILED",
      "业务监控告警扫描失败，请稍后重试。",
      {
        cause: error,
        expose: false,
      },
    );
  }

  return ApiError.internal("业务监控告警扫描失败，请稍后重试。", {
    cause: error instanceof Error ? error.message : String(error),
  });
}

function invalidScanResult(details?: unknown): ApiError {
  return new ApiError(
    500,
    "MONITORING_ALERT_SCAN_RESULT_INVALID",
    "业务监控告警扫描结果格式无效。",
    {
      details,
      expose: false,
    },
  );
}

function logCronFailure(error: unknown, requestId: string): void {
  const message = error instanceof Error ? error.message : String(error);

  console.error("cron.monitoring_alert_scan failed", {
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

function readBoolean(value: unknown): boolean {
  if (typeof value === "boolean") {
    return value;
  }

  return typeof value === "string" && value.toLowerCase() === "true";
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
