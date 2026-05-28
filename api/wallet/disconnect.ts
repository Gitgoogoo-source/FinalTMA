import {
  WalletDisconnectBodySchema,
  type WalletDisconnectBody,
} from "../../packages/validation/src/wallet.schemas.js";
import {
  getSupabaseAdminClient,
  type SupabaseAdminClient,
} from "../../packages/server/src/db/supabaseAdmin.js";
import {
  IdempotencyError,
  withIdempotency,
} from "../../packages/server/src/db/idempotency.js";
import type { JsonValue } from "../../packages/server/src/db/transactions.js";
import {
  ApiError,
  getIdempotencyKey,
  withApiHandler,
} from "../_shared/handler.js";
import { parseOptionalJsonBody } from "../_shared/parseBody.js";
import { requireSession } from "../_shared/requireSession.js";
import { validate } from "../_shared/validate.js";
import { toWalletStatusResponse } from "./status.js";

type WalletRow = {
  id: string;
  user_id: string;
  chain: string;
  network: string;
  address: string;
  wallet_app_name: string | null;
  is_primary: boolean;
  status: string;
  verified_at: string | null;
  disconnected_at: string | null;
  last_sync_at: string | null;
  created_at: string;
  updated_at: string;
};

type WalletDisconnectResponse = ReturnType<typeof toWalletStatusResponse>;

const WALLET_COLUMNS = [
  "id",
  "user_id",
  "chain",
  "network",
  "address",
  "wallet_app_name",
  "is_primary",
  "status",
  "verified_at",
  "disconnected_at",
  "last_sync_at",
  "created_at",
  "updated_at",
].join(",");

export default withApiHandler(
  async (req, _res, ctx) => {
    const session = await requireSession(req);
    const body = await parseOptionalJsonBody<unknown>(req, {
      maxBytes: 8 * 1024,
    });
    const input = validate(
      WalletDisconnectBodySchema,
      normalizeWalletDisconnectInput(body, getIdempotencyKey(req)),
    );
    const idempotencyKey = requireWalletDisconnectIdempotencyKey(input);
    const db = getSupabaseAdminClient();

    try {
      const result = await withIdempotency<JsonValue>({
        scope: "wallet.disconnect",
        key: idempotencyKey,
        userId: session.userId,
        requestPayload: {
          address: input.address ?? null,
          reason: input.reason ?? null,
        },
        traceId: ctx.requestId,
        handler: async () => {
          const response = await disconnectWalletForUser(
            db,
            session.userId,
            input,
            new Date(),
          );

          return response as unknown as JsonValue;
        },
      });

      return result.data as WalletDisconnectResponse;
    } catch (error) {
      throw mapWalletDisconnectError(error);
    }
  },
  {
    methods: ["POST"],
    rateLimit: {
      action: "wallet.disconnect",
    },
  },
);

export function normalizeWalletDisconnectInput(
  body: unknown,
  headerIdempotencyKey: string | null,
): Record<string, unknown> {
  if (!isRecord(body)) {
    return {
      idempotencyKey: headerIdempotencyKey,
    };
  }

  assertNoClientIdentityFields(body);

  return {
    address: body.address,
    reason: body.reason,
    idempotencyKey:
      body.idempotencyKey ?? body.idempotency_key ?? headerIdempotencyKey,
  };
}

export async function disconnectWalletForUser(
  db: SupabaseAdminClient,
  userId: string,
  input: Pick<WalletDisconnectBody, "address">,
  now: Date,
): Promise<WalletDisconnectResponse> {
  const targetWallet = await findDisconnectTargetWallet(db, userId, input);

  if (!targetWallet) {
    const latestWallet = await findLatestWallet(db, userId);

    return toWalletStatusResponse(latestWallet, now);
  }

  const disconnectedAt = now.toISOString();
  const { data, error } = await db
    .schema("core")
    .from("user_wallets")
    .update({
      status: "disconnected",
      disconnected_at: disconnectedAt,
      is_primary: false,
      updated_at: disconnectedAt,
    })
    .eq("id", targetWallet.id)
    .eq("user_id", userId)
    .eq("status", "connected")
    .select(WALLET_COLUMNS)
    .maybeSingle<WalletRow>();

  if (error) {
    throw new ApiError(
      500,
      "WALLET_DISCONNECT_UPDATE_FAILED",
      "断开钱包失败，请稍后重试。",
      {
        cause: error,
        expose: false,
      },
    );
  }

  if (!data) {
    const latestWallet = await findLatestWallet(db, userId);

    return toWalletStatusResponse(latestWallet, now);
  }

  return toWalletStatusResponse(data, now);
}

async function findDisconnectTargetWallet(
  db: SupabaseAdminClient,
  userId: string,
  input: Pick<WalletDisconnectBody, "address">,
): Promise<WalletRow | null> {
  let query = db
    .schema("core")
    .from("user_wallets")
    .select(WALLET_COLUMNS)
    .eq("user_id", userId)
    .eq("status", "connected");

  if (input.address) {
    query = query.eq("address", input.address);
  }

  const { data, error } = await query
    .order("is_primary", { ascending: false })
    .order("verified_at", { ascending: false, nullsFirst: false })
    .order("updated_at", { ascending: false })
    .limit(1)
    .maybeSingle<WalletRow>();

  if (error) {
    throw new ApiError(
      500,
      "WALLET_DISCONNECT_LOOKUP_FAILED",
      "查询钱包状态失败。",
      {
        cause: error,
        expose: false,
      },
    );
  }

  return data ?? null;
}

async function findLatestWallet(
  db: SupabaseAdminClient,
  userId: string,
): Promise<WalletRow | null> {
  const { data, error } = await db
    .schema("core")
    .from("user_wallets")
    .select(WALLET_COLUMNS)
    .eq("user_id", userId)
    .order("updated_at", { ascending: false })
    .limit(1)
    .maybeSingle<WalletRow>();

  if (error) {
    throw new ApiError(
      500,
      "WALLET_DISCONNECT_LOOKUP_FAILED",
      "查询钱包状态失败。",
      {
        cause: error,
        expose: false,
      },
    );
  }

  return data ?? null;
}

function requireWalletDisconnectIdempotencyKey(
  input: WalletDisconnectBody,
): string {
  const key = input.idempotencyKey?.trim();

  if (!key) {
    throw new ApiError(400, "IDEMPOTENCY_KEY_REQUIRED", "缺少幂等键。");
  }

  return key;
}

function mapWalletDisconnectError(error: unknown): ApiError {
  if (error instanceof ApiError) {
    return error;
  }

  if (error instanceof IdempotencyError) {
    return new ApiError(
      error.status,
      error.code,
      mapIdempotencyMessage(error.code),
      {
        details: error.details,
        expose: error.status < 500,
        cause: error,
      },
    );
  }

  return new ApiError(
    500,
    "WALLET_DISCONNECT_FAILED",
    "断开钱包失败，请稍后重试。",
    {
      cause: error,
      expose: false,
    },
  );
}

function mapIdempotencyMessage(code: string): string {
  switch (code) {
    case "IDEMPOTENCY_KEY_REQUIRED":
      return "缺少幂等键。";
    case "IDEMPOTENCY_REQUEST_MISMATCH":
      return "幂等键已被其他断开钱包请求使用。";
    case "IDEMPOTENCY_IN_PROGRESS":
      return "断开钱包请求正在处理中，请稍后重试。";
    case "IDEMPOTENCY_PREVIOUSLY_FAILED":
      return "相同断开钱包请求此前失败，请重新发起。";
    default:
      return "断开钱包请求幂等校验失败。";
  }
}

function assertNoClientIdentityFields(body: Record<string, unknown>): void {
  const forbiddenFields = [
    "user_id",
    "userId",
    "telegram_user_id",
    "telegramUserId",
    "wallet_id",
    "walletId",
  ].filter((field) => body[field] !== undefined);

  if (forbiddenFields.length > 0) {
    throw new ApiError(400, "VALIDATION_ERROR", "请求参数校验失败。", {
      details: forbiddenFields.map((field) => ({
        path: field,
        message: "断开钱包请求不能携带身份或钱包归属字段。",
      })),
    });
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
