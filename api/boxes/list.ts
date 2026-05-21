import {
  BoxListQuerySchema,
  type BoxListQuery,
} from "../../packages/validation/src/box.schemas.js";
import { callRpcRaw } from "../../packages/server/src/db/rpc.js";
import { ApiError, withApiHandler } from "../_shared/handler.js";
import { requireSession } from "../_shared/requireSession.js";
import { validate } from "../_shared/validate.js";

type DisplayableBoxStatus =
  | "not_started"
  | "active"
  | "paused"
  | "ended"
  | "sold_out";

type BoxTier = "normal" | "rare" | "legendary" | "event";
type BoxListPayload = Record<string, unknown>;

const DISPLAYABLE_BOX_STATUSES: DisplayableBoxStatus[] = [
  "not_started",
  "active",
  "paused",
  "ended",
  "sold_out",
];

export default withApiHandler(
  async (req, _res, ctx) => {
    const session = await requireSession(req);
    const query = validate(BoxListQuerySchema, req.query);
    const statuses = getRequestedStatuses(query);

    if (statuses.length === 0) {
      return {
        items: [],
        next_cursor: null,
        server_time: new Date().toISOString(),
      };
    }

    const payload = await callRpcRaw<BoxListPayload>(
      "gacha_list_boxes",
      {
        p_user_id: session.userId,
        p_statuses: statuses,
        p_tier: query.tier ? normalizeBoxTier(query.tier) : null,
        p_limit: query.limit,
      },
      {
        schema: "api" as never,
        context: {
          requestId: ctx.requestId,
          userId: session.userId,
        },
      },
    );

    if (!isRecord(payload) || !Array.isArray(payload.items)) {
      throw new ApiError(500, "BOX_LIST_RESULT_INVALID", "盲盒列表格式无效。", {
        expose: false,
      });
    }

    return payload;
  },
  {
    methods: ["GET"],
    rateLimit: {
      action: "boxes.list",
    },
  },
);

function normalizeBoxTier(value: string): BoxTier | string {
  return value === "ordinary" ? "normal" : value;
}

function getRequestedStatuses(query: BoxListQuery): DisplayableBoxStatus[] {
  if (!query.status) {
    return DISPLAYABLE_BOX_STATUSES;
  }

  return isDisplayableBoxStatus(query.status) ? [query.status] : [];
}

function isDisplayableBoxStatus(value: string): value is DisplayableBoxStatus {
  return (DISPLAYABLE_BOX_STATUSES as readonly string[]).includes(value);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
