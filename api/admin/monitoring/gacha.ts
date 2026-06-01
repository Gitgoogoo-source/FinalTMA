import { withApiHandler } from "../../_shared/handler.js";
import { requireAdmin } from "../../_shared/requireAdmin.js";
import { parseMonitoringWindowHours } from "../../_shared/monitoringThresholds.js";
import {
  runReadRpc,
  type JsonObject,
} from "../../../packages/server/src/db/transactions.js";
import { buildAdminRpcContext, mapAdminRpcError } from "../_shared.js";
import { GACHA_READ_PERMISSIONS } from "../gacha/_shared.js";

export default withApiHandler(
  async (req, _res, ctx) => {
    const admin = await requireAdmin(req, {
      permissions: GACHA_READ_PERMISSIONS,
      requireAll: false,
    });
    const windowHours = parseMonitoringWindowHours(req.query.windowHours);

    try {
      return await runReadRpc<JsonObject>({
        schema: "api",
        functionName: "admin_get_gacha_monitoring",
        args: {
          p_admin_user_id: admin.adminId,
          p_window_hours: windowHours,
          p_request_context: buildAdminRpcContext(admin, ctx),
        },
        traceId: ctx.requestId,
        label: "admin_get_gacha_monitoring",
      });
    } catch (error) {
      throw mapAdminRpcError(error, "ADMIN_GACHA_MONITORING_LOOKUP_FAILED");
    }
  },
  {
    methods: ["GET"],
    rateLimit: {
      action: "admin.read",
    },
  },
);
