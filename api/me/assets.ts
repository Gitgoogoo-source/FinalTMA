import {
  meAssetsResponseSchema,
  type MeAssetsResponse,
} from "../../packages/validation/src/me.schemas.js";
import { callRpcRaw } from "../../packages/server/src/db/rpc.js";
import { ApiError, withApiHandler } from "../_shared/handler.js";
import { requireSession } from "../_shared/requireSession.js";

type AssetPayload = Record<string, unknown>;

export default withApiHandler(
  async (req, _res, ctx) => {
    const session = await requireSession(req);
    const payload = await callRpcRaw<AssetPayload>(
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

    return normalizeAssetPayload(payload);
  },
  {
    methods: ["GET"],
    rateLimit: {
      action: "me.assets",
    },
  },
);

function normalizeAssetPayload(payload: unknown): MeAssetsResponse {
  if (!isRecord(payload)) {
    throw invalidAssetResult();
  }

  const balances = isRecord(payload.balances) ? payload.balances : {};
  const normalized = {
    userId: payload.userId,
    balances: {
      KCOIN: normalizeBalance(balances.KCOIN),
      FGEMS: normalizeBalance(balances.FGEMS),
    },
    assets: {
      kcoin: normalizeBalance(balances.KCOIN),
      fgems: normalizeBalance(balances.FGEMS),
    },
    updatedAt: payload.updatedAt ?? null,
  };

  const parsed = meAssetsResponseSchema.safeParse(normalized);

  if (!parsed.success) {
    throw invalidAssetResult(parsed.error.issues);
  }

  return parsed.data;
}

function normalizeBalance(value: unknown): unknown {
  if (!isRecord(value)) {
    return value;
  }

  return {
    currencyCode: value.currencyCode,
    available: value.available,
    locked: value.locked,
  };
}

function invalidAssetResult(details?: unknown): ApiError {
  return new ApiError(500, "ASSET_RESULT_INVALID", "资产数据格式无效。", {
    details,
    expose: false,
  });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
