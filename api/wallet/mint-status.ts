import {
  getSupabaseAdminClient,
  type SupabaseAdminClient,
} from "../../packages/server/src/db/supabaseAdmin.js";
import { callRpcRaw } from "../../packages/server/src/db/rpc.js";
import {
  MintStatusQuerySchema,
  type MintQueueItem,
  type MintStatusQuery,
} from "../../packages/validation/src/wallet.schemas.js";
import { ApiError, withApiHandler } from "../_shared/handler.js";
import { requireSession } from "../_shared/requireSession.js";
import { validate } from "../_shared/validate.js";

type MintQueueSummary = Record<MintQueueItem["status"], number>;

type MintStatusResponse = {
  items: MintQueueItem[];
  summary: MintQueueSummary;
  nextCursor: string | null;
  serverTime: string;
};

export default withApiHandler(
  async (req, _res) => {
    const session = await requireSession(req);
    const input = validate(
      MintStatusQuerySchema,
      normalizeMintStatusQuery(req),
    );
    const offset = parseOffsetCursor(input.cursor);
    const limit = input.limit ?? 20;

    return await getMintStatusResponse(
      getSupabaseAdminClient(),
      session.userId,
      input,
      offset,
      limit,
    );
  },
  {
    methods: ["GET"],
    rateLimit: {
      action: "wallet.mint_status",
    },
  },
);

export function normalizeMintStatusQuery(req: {
  query: Record<string, unknown>;
}): Record<string, unknown> {
  const query = req.query;

  return {
    cursor: firstQueryValue(query.cursor),
    limit: firstQueryValue(query.limit),
    mintQueueId: firstQueryValue(query.mintQueueId ?? query.mint_queue_id),
    itemInstanceId: firstQueryValue(
      query.itemInstanceId ?? query.item_instance_id,
    ),
    statuses: query.statuses ?? query.status,
  };
}

async function getMintStatusResponse(
  db: SupabaseAdminClient,
  userId: string,
  input: MintStatusQuery,
  offset: number,
  limit: number,
): Promise<MintStatusResponse> {
  try {
    return await callRpcRaw<MintStatusResponse>(
      "wallet_get_mint_status",
      {
        p_user_id: userId,
        p_mint_queue_id: input.mintQueueId ?? null,
        p_item_instance_id: input.itemInstanceId ?? null,
        p_statuses: input.statuses ?? null,
        p_offset: offset,
        p_limit: limit,
      },
      {
        schema: "api" as never,
        client: db,
        context: {
          userId,
          mintQueueId: input.mintQueueId,
          itemInstanceId: input.itemInstanceId,
        },
      },
    );
  } catch (error) {
    throw new ApiError(
      500,
      "MINT_STATUS_LOOKUP_FAILED",
      "查询 Mint 队列失败。",
      {
        expose: false,
        cause: error,
      },
    );
  }
}

function parseOffsetCursor(cursor: string | undefined): number {
  if (!cursor) {
    return 0;
  }

  const offset = Number(cursor);

  if (!Number.isInteger(offset) || offset < 0) {
    throw new ApiError(400, "VALIDATION_ERROR", "请求参数校验失败。", {
      details: [
        {
          path: "cursor",
          message: "cursor 必须是非负整数偏移量。",
        },
      ],
    });
  }

  return offset;
}

function firstQueryValue(value: unknown): string | undefined {
  const firstValue = Array.isArray(value) ? value[0] : value;

  return readString(firstValue) ?? undefined;
}

function readString(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }

  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}
