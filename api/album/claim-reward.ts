import {
  AlbumClaimMilestoneRewardBodySchema,
  AlbumClaimMilestoneRewardResponseSchema,
  type AlbumClaimMilestoneRewardBody,
} from "../../packages/validation/src/album.schemas.js";
import { callRpcRaw, RpcError } from "../../packages/server/src/db/rpc.js";
import {
  ApiError,
  getIdempotencyKey,
  withApiHandler,
} from "../_shared/handler.js";
import { parseJsonBody } from "../_shared/parseBody.js";
import { requireSession } from "../_shared/requireSession.js";
import { validate } from "../_shared/validate.js";

type AlbumClaimMilestoneRpcPayload = Record<string, unknown>;

const ALBUM_REWARD_TYPES = new Set([
  "KCOIN",
  "FGEMS",
  "STAR_DISPLAY",
  "ITEM",
  "DECORATION",
]);

export default withApiHandler(
  async (req, _res, ctx) => {
    const session = await requireSession(req);
    const body = await parseJsonBody<unknown>(req, {
      maxBytes: 16 * 1024,
    });
    const input = validate(
      AlbumClaimMilestoneRewardBodySchema,
      normalizeAlbumClaimMilestoneInput(body, getIdempotencyKey(req)),
    );

    const payload = await callAlbumClaimMilestoneRpc(
      input,
      session.userId,
      ctx.requestId,
    );

    return normalizeAlbumClaimMilestonePayload(payload, input.milestone_id);
  },
  {
    methods: ["POST"],
    rateLimit: {
      action: "album.claim_reward",
    },
  },
);

export function normalizeAlbumClaimMilestoneInput(
  body: unknown,
  headerIdempotencyKey: string | null,
): Record<string, unknown> {
  if (!isRecord(body)) {
    return {
      idempotency_key: headerIdempotencyKey,
    };
  }

  return {
    milestone_id: body.milestone_id ?? body.milestoneId,
    book_id: body.book_id ?? body.bookId,
    expected_milestone_version:
      body.expected_milestone_version ?? body.expectedMilestoneVersion,
    idempotency_key:
      headerIdempotencyKey ?? body.idempotency_key ?? body.idempotencyKey,
    ...(body.user_id !== undefined ? { user_id: body.user_id } : {}),
    ...(body.owner_user_id !== undefined
      ? { owner_user_id: body.owner_user_id }
      : {}),
  };
}

async function callAlbumClaimMilestoneRpc(
  input: AlbumClaimMilestoneRewardBody,
  userId: string,
  requestId: string,
): Promise<AlbumClaimMilestoneRpcPayload> {
  try {
    return await callRpcRaw<AlbumClaimMilestoneRpcPayload>(
      "album_claim_milestone",
      {
        p_user_id: userId,
        p_milestone_id: input.milestone_id,
        p_idempotency_key: input.idempotency_key,
        p_expected_milestone_version: input.expected_milestone_version ?? null,
      },
      {
        schema: "api" as never,
        context: {
          requestId,
          userId,
          milestoneId: input.milestone_id,
          idempotencyKey: input.idempotency_key,
          expectedMilestoneVersion: input.expected_milestone_version,
        },
      },
    );
  } catch (error) {
    throw mapAlbumClaimMilestoneRpcError(error);
  }
}

export function normalizeAlbumClaimMilestonePayload(
  payload: unknown,
  fallbackMilestoneId: string,
) {
  const result = assertRecordPayload(
    payload,
    "ALBUM_CLAIM_REWARD_RESULT_INVALID",
    "图鉴奖励领取结果格式无效。",
  );
  const milestoneId = readString(result.milestone_id) ?? fallbackMilestoneId;
  const bookId = readString(result.book_id);
  const claimedAt = readIsoDateString(result.claimed_at);

  if (!bookId || !claimedAt) {
    throw invalidAlbumResult(
      "ALBUM_CLAIM_REWARD_RESULT_INVALID",
      "图鉴奖励领取结果缺少必要字段。",
      {
        book_id: result.book_id,
        claimed_at: result.claimed_at,
      },
    );
  }

  const balanceChanges = normalizeBalanceChanges(
    result.balance_changes ?? result.ledger_results,
  );
  const normalized = {
    milestone_id: milestoneId,
    book_id: bookId,
    status: "claimed" as const,
    rewards: normalizeRewards(result.rewards ?? result.reward),
    ...(balanceChanges.length > 0 ? { balance_changes: balanceChanges } : {}),
    claimed_at: claimedAt,
  };
  const parsed = AlbumClaimMilestoneRewardResponseSchema.safeParse(normalized);

  if (!parsed.success) {
    throw invalidAlbumResult(
      "ALBUM_CLAIM_REWARD_RESULT_INVALID",
      "图鉴奖励领取结果格式无效。",
      parsed.error.issues,
    );
  }

  return parsed.data;
}

function normalizeRewards(value: unknown): unknown[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.map(normalizeReward).filter((item) => item !== null);
}

function normalizeReward(value: unknown): Record<string, unknown> | null {
  if (!isRecord(value)) {
    return null;
  }

  const rewardType =
    readString(value.reward_type) ??
    readString(value.currency) ??
    readString(value.type);

  if (!rewardType || !ALBUM_REWARD_TYPES.has(rewardType)) {
    return null;
  }

  return compactRecord({
    reward_type: rewardType,
    amount: readNumber(value.amount),
    template_id: readString(value.template_id) ?? readString(value.templateId),
    label:
      readString(value.label) ??
      readString(value.reward_label) ??
      readString(value.currency) ??
      rewardType,
    icon_url: readString(value.icon_url) ?? readString(value.iconUrl),
  });
}

function normalizeBalanceChanges(value: unknown): unknown[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.map(normalizeBalanceChange).filter((item) => item !== null);
}

function normalizeBalanceChange(
  value: unknown,
): Record<string, unknown> | null {
  if (!isRecord(value)) {
    return null;
  }

  const currency =
    readString(value.currency) ?? readString(value.currency_code);

  if (currency !== "KCOIN" && currency !== "FGEMS") {
    return null;
  }

  const balanceBefore =
    readNumber(value.balance_before) ?? readNumber(value.available_before);
  const balanceAfter =
    readNumber(value.balance_after) ??
    readNumber(value.available_after) ??
    readNumber(value.available);
  const delta =
    readNumber(value.delta) ??
    readNumber(value.amount) ??
    (balanceBefore !== null && balanceAfter !== null
      ? balanceAfter - balanceBefore
      : null);

  if (delta === null || balanceAfter === null) {
    return null;
  }

  return {
    currency,
    delta,
    balance_after: balanceAfter,
  };
}

function mapAlbumClaimMilestoneRpcError(error: unknown): ApiError {
  if (error instanceof ApiError) {
    return error;
  }

  if (!(error instanceof RpcError)) {
    return ApiError.internal("领取图鉴奖励失败，请稍后重试。", {
      cause: getErrorMessage(error),
    });
  }

  const message = getRpcErrorText(error);

  if (message.includes("idempotency key is required")) {
    return new ApiError(400, "IDEMPOTENCY_KEY_REQUIRED", "缺少幂等键。");
  }

  if (
    message.includes("idempotency conflict") ||
    message.includes("milestone_claims_idempotency_key_uidx")
  ) {
    return new ApiError(
      409,
      "IDEMPOTENCY_CONFLICT",
      "幂等键已被其他图鉴奖励领取请求使用。",
    );
  }

  if (message.includes("milestone not found")) {
    return new ApiError(404, "MILESTONE_NOT_FOUND", "图鉴里程碑不存在。");
  }

  if (message.includes("milestone not reached")) {
    return new ApiError(409, "MILESTONE_NOT_REACHED", "图鉴里程碑尚未达成。");
  }

  if (message.includes("milestone version mismatch")) {
    return new ApiError(
      409,
      "MILESTONE_VERSION_MISMATCH",
      "图鉴里程碑奖励配置已变更，请刷新后重试。",
    );
  }

  if (
    message.includes("invalid reward config") ||
    (message.includes("invalid input syntax") && message.includes("numeric"))
  ) {
    return new ApiError(500, "REWARD_CONFIG_INVALID", "图鉴奖励配置无效。", {
      cause: error,
      expose: false,
    });
  }

  return new ApiError(
    500,
    "ALBUM_CLAIM_REWARD_RPC_FAILED",
    "领取图鉴奖励失败。",
    {
      cause: error,
      expose: false,
    },
  );
}

function assertRecordPayload(
  payload: unknown,
  code: string,
  message: string,
): Record<string, unknown> {
  if (!isRecord(payload)) {
    throw new ApiError(500, code, message, {
      expose: false,
      details: { payloadType: typeof payload },
    });
  }

  return payload;
}

function invalidAlbumResult(
  code: string,
  message: string,
  details?: unknown,
): ApiError {
  return new ApiError(500, code, message, {
    details,
    expose: false,
  });
}

function getRpcErrorText(error: RpcError): string {
  return [error.message, error.details, error.hint, error.code]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
}

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function readString(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }

  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function readIsoDateString(value: unknown): string | null {
  const text = readString(value);

  if (!text) {
    return null;
  }

  const timestamp = Date.parse(text);

  return Number.isFinite(timestamp) ? new Date(timestamp).toISOString() : null;
}

function readNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) {
    return Math.trunc(value);
  }

  if (typeof value === "string" && value.trim() !== "") {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? Math.trunc(parsed) : null;
  }

  return null;
}

function compactRecord(
  value: Record<string, unknown>,
): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(value).filter(([, entry]) => entry !== null),
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
