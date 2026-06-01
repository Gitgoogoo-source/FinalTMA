import { loadPaymentSupportConfig } from "../../_shared/paymentSupportConfig.js";
import { withApiHandler } from "../../_shared/handler.js";
import { requireAdmin } from "../../_shared/requireAdmin.js";
import { parseMonitoringWindowHours } from "../../_shared/monitoringThresholds.js";
import {
  runReadRpc,
  type JsonObject,
} from "../../../packages/server/src/db/transactions.js";
import { buildAdminRpcContext, mapAdminRpcError } from "../_shared.js";

export default withApiHandler(
  async (req, _res, ctx) => {
    const admin = await requireAdmin(req, {
      permissions: ["payments:read", "mint:read", "onchain:read"],
    });
    const windowHours = parseMonitoringWindowHours(req.query.windowHours);

    try {
      const [payload, paymentSupport] = await Promise.all([
        runReadRpc<JsonObject>({
          schema: "api",
          functionName: "admin_get_operational_monitoring",
          args: {
            p_admin_user_id: admin.adminId,
            p_window_hours: windowHours,
            p_request_context: buildAdminRpcContext(admin, ctx),
          },
          traceId: ctx.requestId,
          label: "admin_get_operational_monitoring",
        }),
        loadPaymentSupportConfig(),
      ]);

      return {
        ...payload,
        paymentSupport,
        warnings: buildMonitoringWarnings(paymentSupport),
      };
    } catch (error) {
      throw mapAdminRpcError(error, "ADMIN_MONITORING_LOOKUP_FAILED");
    }
  },
  {
    methods: ["GET"],
    rateLimit: {
      action: "admin.read",
    },
  },
);

function buildMonitoringWarnings(paymentSupport: {
  configured: boolean;
}): Array<{
  code: string;
  severity: "warning";
  message: string;
  suggestedAction: string;
}> {
  if (paymentSupport.configured) {
    return [];
  }

  return [
    {
      code: "PAYMENT_SUPPORT_CONFIG_MISSING",
      severity: "warning",
      message: "支付客服入口未配置，支付失败页不会展示客服入口。",
      suggestedAction: "在监控页配置 PAYMENT_SUPPORT_CONFIG 的 URL 或 email。",
    },
  ];
}
