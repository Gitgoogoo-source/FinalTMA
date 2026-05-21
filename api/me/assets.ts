import { callRpcRaw } from "../../packages/server/src/db/rpc.js";
import { ApiError, withApiHandler } from "../_shared/handler.js";
import { requireSession } from "../_shared/requireSession.js";

type AssetPayload = Record<string, unknown>;

export default withApiHandler(
  async (req, _res, ctx) => {
    const session = await requireSession(req);
    const assets = await callRpcRaw<AssetPayload>(
      "get_user_asset_balances",
      {
        p_user_id: session.userId,
      },
      {
        schema: "api" as never,
        context: {
          requestId: ctx.requestId,
          userId: session.userId,
        },
      },
    );

    if (!isRecord(assets)) {
      throw new ApiError(500, "ASSET_RESULT_INVALID", "资产数据格式无效。", {
        expose: false,
      });
    }

    return assets;
  },
  {
    methods: ["GET"],
    rateLimit: {
      action: "me.assets",
    },
  },
);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
