import { withApiHandler } from "../_shared/handler.js";
import { requireAdmin } from "../_shared/requireAdmin.js";
import {
  runReadRpc,
  type JsonObject,
} from "../../packages/server/src/db/transactions.js";
import {
  buildAdminRpcContext,
  mapAdminRpcError,
  normalizeRequiredUuid,
} from "./_shared.js";

export default withApiHandler(
  async (req, _res, ctx) => {
    const admin = await requireAdmin(req, {
      permissions: ["market:read", "admin:read"],
      requireAll: false,
    });
    const listingId = normalizeRequiredUuid(req.query.listingId, "listingId");

    try {
      return await runReadRpc<JsonObject>({
        schema: "api",
        functionName: "admin_get_market_listing_detail",
        args: {
          p_admin_user_id: admin.adminId,
          p_listing_id: listingId,
          p_request_context: buildAdminRpcContext(admin, ctx),
        },
        traceId: ctx.requestId,
        label: "admin_get_market_listing_detail",
      });
    } catch (error) {
      throw mapAdminRpcError(error, "ADMIN_MARKET_LISTING_LOOKUP_FAILED");
    }
  },
  {
    methods: ["GET"],
    rateLimit: {
      action: "admin.read",
    },
  },
);
