import { MarketSellRulesResponseSchema } from "../../packages/validation/src/market.schemas.js";
import { callRpcRaw, RpcError } from "../../packages/server/src/db/rpc.js";
import { ApiError, withApiHandler } from "../_shared/handler.js";
import { requireSession } from "../_shared/requireSession.js";

type MarketSellRulesRpcPayload = Record<string, unknown>;
type MarketSellRulesResponse = {
  fee_type: "market_sell";
  currency_code: "KCOIN";
  fee_bps: number;
  source?: "active_rule" | "fallback";
};

export default withApiHandler(
  async (req, _res, ctx) => {
    const session = await requireSession(req);
    const payload = await callMarketGetSellRules(session.userId, ctx.requestId);

    return normalizeMarketSellRulesPayload(payload);
  },
  {
    methods: ["GET"],
    rateLimit: {
      action: "market.sell_rules",
    },
  },
);

async function callMarketGetSellRules(
  userId: string,
  requestId: string,
): Promise<MarketSellRulesRpcPayload> {
  try {
    return await callRpcRaw<MarketSellRulesRpcPayload>(
      "market_get_sell_rules",
      {
        p_user_id: userId,
      },
      {
        schema: "api" as never,
        context: {
          requestId,
          userId,
        },
      },
    );
  } catch (error) {
    throw mapMarketSellRulesRpcError(error);
  }
}

function normalizeMarketSellRulesPayload(
  payload: unknown,
): MarketSellRulesResponse {
  if (!isRecord(payload)) {
    throw invalidMarketSellRulesResult();
  }

  const normalized = {
    fee_type: payload.fee_type ?? "market_sell",
    currency_code: payload.currency_code ?? "KCOIN",
    fee_bps: payload.fee_bps,
    source: payload.source,
  };

  const parsed = MarketSellRulesResponseSchema.safeParse(normalized);

  if (!parsed.success) {
    throw invalidMarketSellRulesResult(parsed.error.issues);
  }

  return {
    fee_type: parsed.data.fee_type,
    currency_code: parsed.data.currency_code,
    fee_bps: parsed.data.fee_bps,
    ...(parsed.data.source !== undefined ? { source: parsed.data.source } : {}),
  };
}

function invalidMarketSellRulesResult(details?: unknown): ApiError {
  return new ApiError(
    500,
    "MARKET_SELL_RULES_RESULT_INVALID",
    "市场出售规则格式无效。",
    {
      details,
      expose: false,
    },
  );
}

function mapMarketSellRulesRpcError(error: unknown): ApiError {
  if (error instanceof ApiError) {
    return error;
  }

  if (error instanceof RpcError) {
    return new ApiError(
      500,
      "MARKET_SELL_RULES_RPC_FAILED",
      "读取市场出售规则失败，请稍后重试。",
      {
        cause: error,
        expose: false,
      },
    );
  }

  return ApiError.internal("读取市场出售规则失败，请稍后重试。", {
    cause: getErrorMessage(error),
  });
}

function getErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }

  return String(error);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
