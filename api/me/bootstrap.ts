import { callRpcRaw } from "../../packages/server/src/db/rpc.js";
import { ApiError, withApiHandler } from "../_shared/handler.js";
import { requireSession } from "../_shared/requireSession.js";

type UserBootstrapPayload = Record<string, unknown>;

export default withApiHandler(
  async (req, _res, ctx) => {
    const session = await requireSession(req);
    const bootstrap = await callRpcRaw<UserBootstrapPayload>(
      "get_user_bootstrap",
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

    if (!isRecord(bootstrap)) {
      throw new ApiError(
        500,
        "BOOTSTRAP_RESULT_INVALID",
        "首屏数据格式无效。",
        {
          expose: false,
        },
      );
    }

    return bootstrap;
  },
  {
    methods: ["GET"],
    rateLimit: {
      action: "me.bootstrap",
    },
  },
);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
