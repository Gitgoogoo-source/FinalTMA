import { BoxRewardsQuerySchema } from "../../packages/validation/src/box.schemas.js";
import { callRpcRaw } from "../../packages/server/src/db/rpc.js";
import { ApiError, withApiHandler } from "../_shared/handler.js";
import { requireSession } from "../_shared/requireSession.js";
import { validate } from "../_shared/validate.js";

type BoxRewardsPayload = Record<string, unknown>;

export default withApiHandler(
  async (req, _res, ctx) => {
    const session = await requireSession(req);
    const query = validate(
      BoxRewardsQuerySchema,
      normalizeRewardsQuery(req.query),
    );

    const payload = await callRpcRaw<BoxRewardsPayload>(
      "gacha_get_box_rewards",
      {
        p_box_id: query.boxId,
        p_pool_version_id: query.poolVersionId ?? null,
        p_include_inactive: query.includeInactive,
        p_include_sold_out: query.includeSoldOut,
      },
      {
        schema: "api" as never,
        context: {
          requestId: ctx.requestId,
          userId: session.userId,
          boxId: query.boxId,
        },
      },
    );

    if (!isRecord(payload)) {
      throw new ApiError(
        500,
        "BOX_REWARDS_RESULT_INVALID",
        "盲盒奖励格式无效。",
        {
          expose: false,
        },
      );
    }

    if (payload.not_found === true) {
      throw ApiError.notFound(getNotFoundMessage(payload.reason));
    }

    if (!Array.isArray(payload.items)) {
      throw new ApiError(
        500,
        "BOX_REWARDS_RESULT_INVALID",
        "盲盒奖励格式无效。",
        {
          expose: false,
        },
      );
    }

    return payload;
  },
  {
    methods: ["GET"],
    rateLimit: {
      action: "boxes.rewards",
    },
  },
);

function normalizeRewardsQuery(
  query: Record<string, unknown>,
): Record<string, unknown> {
  return {
    boxId: query.boxId ?? query.box_id,
    poolVersionId: query.poolVersionId ?? query.pool_version_id,
    includeInactive: query.includeInactive ?? query.include_inactive,
    includeSoldOut: query.includeSoldOut ?? query.include_sold_out,
  };
}

function getNotFoundMessage(reason: unknown): string {
  return reason === "pool"
    ? "当前盲盒没有可展示的 active 奖励池。"
    : "盲盒不存在或不可展示。";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
