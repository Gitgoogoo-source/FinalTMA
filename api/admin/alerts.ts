import type { VercelRequest } from "@vercel/node";

import { callRpcRaw } from "../../packages/server/src/db/rpc.js";
import { parseJsonBody } from "../_shared/parseBody.js";
import {
  ApiError,
  withApiHandler,
  type ApiContext,
} from "../_shared/handler.js";
import { requireAdmin } from "../_shared/requireAdmin.js";
import {
  asJsonRecord,
  buildAdminRpcContext,
  buildNextCursor,
  callAdminWriteRpc,
  mapAdminRpcError,
  normalizeRequiredText,
  parseAdminLimit,
  parseOffsetCursor,
  readHeaderIdempotencyKey,
} from "./_shared.js";
import {
  normalizeAlertActionStatus,
  normalizeAlertId,
  normalizeResolutionResult,
  parseAlertFilters,
  parseAlertSort,
  serializeAlert,
  summarizeAlerts,
  type AlertRow,
} from "./alerts.shared.js";

type AlertsRpcPayload = {
  total_count?: number | string | null;
  rows?: unknown;
};

type UpdateAlertRpcResult = Record<string, unknown> & {
  server_time?: string;
};

export default withApiHandler(
  async (req, _res, ctx) => {
    if (ctx.method === "GET") {
      return handleListAlerts(req);
    }

    return handleUpdateAlert(req, ctx);
  },
  {
    methods: ["GET", "POST", "PATCH"],
    rateLimit: {
      action: "admin.write",
    },
  },
);

async function handleListAlerts(req: VercelRequest) {
  await requireAdmin(req, {
    permissions: ["admin:read", "ops:read", "risk:read"],
    requireAll: false,
  });

  const limit = parseAdminLimit(req.query.limit);
  const offset = parseOffsetCursor(req.query.cursor);
  const filters = parseAlertFilters(req.query);
  const sort = parseAlertSort(req.query.sort);
  const payload = await listAlerts(filters, sort, offset, limit);
  const rows = readRows<AlertRow>(payload.rows);
  const items = rows.slice(0, limit).map(serializeAlert);

  return {
    items,
    summary: summarizeAlerts(items, readCount(payload.total_count)),
    nextCursor: buildNextCursor(rows.length, limit, offset),
    serverTime: new Date().toISOString(),
  };
}

async function handleUpdateAlert(req: VercelRequest, ctx: ApiContext) {
  const admin = await requireAdmin(req, {
    permissions: ["admin:write", "ops:write", "risk:write"],
    requireAll: false,
  });
  const body = asJsonRecord(await parseJsonBody(req, { maxBytes: 32 * 1024 }));

  const idempotencyKey = readHeaderIdempotencyKey(req);
  const alertId = normalizeAlertId(body.alertId ?? body.alert_id ?? body.id);
  const status = normalizeAlertActionStatus(body.action ?? body.status);
  const reason = normalizeRequiredText(body.reason, "reason");
  const resolutionResult = normalizeResolutionResult(
    body.resolutionResult ?? body.resolution_result ?? body.result,
    status,
  );

  try {
    const result = await callAdminWriteRpc<UpdateAlertRpcResult>({
      functionName: "admin_update_alert_status",
      requestId: ctx.requestId,
      args: {
        p_admin_user_id: admin.adminId,
        p_alert_id: alertId,
        p_status: status,
        p_reason: reason,
        p_idempotency_key: idempotencyKey,
        p_request_context: buildAdminRpcContext(admin, ctx),
        p_resolution_result: resolutionResult,
      },
    });

    return {
      ...result,
      serverTime: result.server_time ?? new Date().toISOString(),
    };
  } catch (error) {
    throw mapAdminRpcError(error, "ADMIN_UPDATE_ALERT_FAILED");
  }
}

async function listAlerts(
  filters: ReturnType<typeof parseAlertFilters>,
  sort: ReturnType<typeof parseAlertSort>,
  offset: number,
  limit: number,
): Promise<AlertsRpcPayload> {
  try {
    return await callRpcRaw<AlertsRpcPayload>(
      "admin_list_alerts",
      {
        p_filters: filters,
        p_sort: sort,
        p_limit: limit,
        p_offset: offset,
      },
      {
        schema: "api" as never,
        context: {
          route: "admin.alerts",
          sort,
        },
      },
    );
  } catch (error) {
    throw new ApiError(500, "ADMIN_ALERTS_LOOKUP_FAILED", "告警查询失败。", {
      expose: false,
      cause: error,
    });
  }
}

function readRows<TRow>(value: unknown): TRow[] {
  return Array.isArray(value) ? (value as TRow[]) : [];
}

function readCount(value: unknown): number {
  const parsed =
    typeof value === "number"
      ? value
      : typeof value === "string"
        ? Number.parseInt(value, 10)
        : 0;

  return Number.isFinite(parsed) && parsed >= 0 ? parsed : 0;
}
