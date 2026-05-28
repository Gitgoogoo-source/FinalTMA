import { createHash } from "node:crypto";

import { WalletProofBodySchema } from "../../packages/validation/src/wallet.schemas.js";
import { callRpcRaw, RpcError } from "../../packages/server/src/db/rpc.js";
import type { Json } from "../../packages/server/src/db/database.js";
import {
  getSupabaseAdminClient,
  type SupabaseAdminClient,
} from "../../packages/server/src/db/supabaseAdmin.js";
import {
  createTonProofHash,
  normalizeTonNetwork,
  resolveExpectedTonProofDomain,
  TonProofVerificationError,
  type TonProofVerificationResult,
  verifyTonProof as verifyTonConnectProof,
} from "../../packages/server/src/ton/tonConnect.js";
import { resolveVerifiedTonWalletPublicKey } from "../../packages/server/src/ton/walletPublicKey.js";
import {
  ApiError,
  getHeaderValue,
  getIdempotencyKey,
  withApiHandler,
} from "../_shared/handler.js";
import { parseJsonBody } from "../_shared/parseBody.js";
import { requireSession } from "../_shared/requireSession.js";
import { validate } from "../_shared/validate.js";

type WalletProofBody = {
  account: {
    address: string;
    chain: "MAINNET" | "TESTNET";
    publicKey?: string | undefined;
    walletStateInit?: string | undefined;
  };
  proof: {
    timestamp: number;
    domain: {
      lengthBytes: number;
      value: string;
    };
    payload: string;
    signature: string;
  };
  walletAppName?: string | undefined;
  device?: unknown;
  idempotencyKey: string;
};

type WalletProofRow = {
  id: string;
  user_id: string;
  wallet_id: string | null;
  challenge: string;
  status: string;
  expires_at: string;
  used_at: string | null;
};

type WalletSaveRpcResult = {
  wallet_id?: unknown;
  address?: unknown;
  network?: unknown;
  task_progress?: unknown;
};

type WalletProofResponse = {
  verified: boolean;
  connected: boolean;
  status: "verified";
  address: string;
  chain: "MAINNET" | "TESTNET";
  network: "mainnet" | "testnet";
  walletId?: string;
  verifiedAt: string;
};

const DEFAULT_PROOF_TTL_SECONDS = 5 * 60;

export default withApiHandler(
  async (req, _res, ctx) => {
    const session = await requireSession(req);
    const body = await parseJsonBody<unknown>(req, {
      maxBytes: 32 * 1024,
    });
    const challenge = readSubmittedChallenge(body);
    const input = validate(
      WalletProofBodySchema,
      normalizeWalletProofBody(body, getIdempotencyKey(req)),
    ) as WalletProofBody;

    if (challenge && challenge !== input.proof.payload) {
      throw new ApiError(
        400,
        "WALLET_PROOF_INVALID",
        "钱包 proof challenge 不匹配。",
      );
    }

    const response = await verifyAndSaveWalletProof(
      getSupabaseAdminClient(),
      input,
      {
        userId: session.userId,
        requestId: ctx.requestId,
        requestHost: getHeaderValue(req.headers.host) ?? null,
      },
    );

    return response;
  },
  {
    methods: ["POST"],
    rateLimit: {
      action: "wallet.proof",
    },
  },
);

export async function verifyAndSaveWalletProof(
  db: SupabaseAdminClient,
  input: WalletProofBody,
  context: {
    userId: string;
    requestId: string;
    requestHost: string | null;
  },
): Promise<WalletProofResponse> {
  const now = new Date();
  const proofHash = createProofHash(input);
  const claimedProof = await claimPendingProof(db, input, {
    ...context,
    now,
    proofHash,
  });
  let verification: TonProofVerificationResult;

  try {
    verification = await verifyTonProof(input, {
      now,
      requestHost: context.requestHost,
    });
  } catch (error) {
    await markProofFailed(db, claimedProof.id, getPublicErrorCode(error));
    throw error;
  }

  let rpcResult: WalletSaveRpcResult;

  try {
    rpcResult = await callRpcRaw<WalletSaveRpcResult>(
      "wallet_save_verified_address",
      {
        p_user_id: context.userId,
        p_address: input.account.address,
        p_address_raw: input.account.address,
        p_network: toWalletNetwork(input.account.chain),
        p_wallet_app_name: input.walletAppName ?? null,
        p_is_primary: true,
      },
      {
        schema: "api" as never,
        context: {
          requestId: context.requestId,
          userId: context.userId,
          proofId: claimedProof.id,
        },
      },
    );
  } catch (error) {
    await markProofFailed(db, claimedProof.id, "wallet_save_failed");
    throw mapWalletSaveRpcError(error);
  }

  const walletId = readString(rpcResult.wallet_id);
  const verifiedAt = new Date().toISOString();
  await markProofVerified(
    db,
    claimedProof.id,
    walletId,
    verifiedAt,
    verification.walletPublicKey,
  );

  return {
    verified: true,
    connected: true,
    status: "verified",
    address: readString(rpcResult.address) ?? input.account.address,
    chain: input.account.chain,
    network: toWalletNetwork(input.account.chain),
    ...(walletId ? { walletId } : {}),
    verifiedAt,
  };
}

export function normalizeWalletProofBody(
  body: unknown,
  headerIdempotencyKey: string | null,
): Record<string, unknown> {
  const payload = isRecord(body) ? body : {};
  const account = isRecord(payload.account) ? payload.account : {};

  return {
    account: {
      address: account.address,
      chain: normalizeTonChainValue(account.chain ?? payload.chain),
      publicKey: account.publicKey ?? account.public_key,
      walletStateInit: account.walletStateInit ?? account.wallet_state_init,
    },
    proof: payload.proof,
    walletAppName: payload.walletAppName ?? payload.wallet_app_name,
    device: payload.device,
    idempotencyKey:
      headerIdempotencyKey ?? payload.idempotencyKey ?? payload.idempotency_key,
  };
}

export async function verifyTonProof(
  input: WalletProofBody,
  options: {
    now: Date;
    requestHost: string | null;
  },
): Promise<TonProofVerificationResult> {
  assertExpectedNetwork(input.account.chain);
  const expectedDomain = resolveExpectedProofDomain(options.requestHost);

  try {
    return await verifyTonConnectProof({
      account: input.account,
      proof: input.proof,
      expectedDomain,
      expectedPayload: input.proof.payload,
      now: options.now,
      maxAgeSeconds: readPositiveIntegerEnv(
        "TON_PROOF_TTL_SECONDS",
        DEFAULT_PROOF_TTL_SECONDS,
      ),
      resolvePublicKey: (resolveInput) =>
        resolveVerifiedTonWalletPublicKey(resolveInput),
    });
  } catch (error) {
    throw mapTonProofVerificationError(error);
  }
}

async function claimPendingProof(
  db: SupabaseAdminClient,
  input: WalletProofBody,
  context: {
    userId: string;
    requestId: string;
    now: Date;
    proofHash: string;
  },
): Promise<WalletProofRow> {
  const payload = buildProofAuditPayload(input);
  const { data, error } = await db
    .schema("core")
    .from("wallet_proofs")
    .update({
      used_at: context.now.toISOString(),
      address: input.account.address,
      domain: input.proof.domain.value,
      payload,
      proof_signature: input.proof.signature,
      proof_hash: context.proofHash,
      request_id: context.requestId,
    })
    .eq("user_id", context.userId)
    .eq("challenge", input.proof.payload)
    .eq("status", "pending")
    .is("used_at", null)
    .gt("expires_at", context.now.toISOString())
    .select("id,user_id,wallet_id,challenge,status,expires_at,used_at")
    .maybeSingle<WalletProofRow>();

  if (error) {
    if (isUniqueViolation(error)) {
      throw new ApiError(
        409,
        "WALLET_PROOF_REPLAYED",
        "钱包 proof 已被使用，请重新连接钱包。",
      );
    }

    throw new ApiError(
      500,
      "WALLET_PROOF_CLAIM_FAILED",
      "钱包 proof 状态更新失败。",
      {
        expose: false,
        cause: error,
      },
    );
  }

  if (data) {
    return data;
  }

  return await throwProofUnavailableError(
    db,
    context.userId,
    input.proof.payload,
  );
}

async function throwProofUnavailableError(
  db: SupabaseAdminClient,
  userId: string,
  challenge: string,
): Promise<never> {
  const { data, error } = await db
    .schema("core")
    .from("wallet_proofs")
    .select("id,user_id,wallet_id,challenge,status,expires_at,used_at")
    .eq("user_id", userId)
    .eq("challenge", challenge)
    .maybeSingle<WalletProofRow>();

  if (error) {
    throw new ApiError(
      500,
      "WALLET_PROOF_LOOKUP_FAILED",
      "查询钱包 proof 失败。",
      {
        expose: false,
        cause: error,
      },
    );
  }

  if (!data) {
    throw new ApiError(
      400,
      "WALLET_PROOF_INVALID",
      "钱包 proof challenge 不存在。",
    );
  }

  if (isExpired(data.expires_at)) {
    await markProofExpired(db, data.id);
    throw new ApiError(
      400,
      "WALLET_PROOF_EXPIRED",
      "钱包 proof 已过期，请重新连接钱包。",
    );
  }

  throw new ApiError(
    409,
    "WALLET_PROOF_REPLAYED",
    "钱包 proof 已被使用，请重新连接钱包。",
  );
}

async function markProofVerified(
  db: SupabaseAdminClient,
  proofId: string,
  walletId: string | null,
  verifiedAt: string,
  walletPublicKey: string,
): Promise<void> {
  const { error } = await db
    .schema("core")
    .from("wallet_proofs")
    .update({
      status: "verified",
      wallet_id: walletId,
      verified_at: verifiedAt,
      wallet_public_key: walletPublicKey,
      error_message: null,
    })
    .eq("id", proofId);

  if (error) {
    throw new ApiError(
      500,
      "WALLET_PROOF_UPDATE_FAILED",
      "钱包 proof 验证状态保存失败。",
      {
        expose: false,
        cause: error,
      },
    );
  }
}

async function markProofFailed(
  db: SupabaseAdminClient,
  proofId: string,
  errorCode: string,
): Promise<void> {
  const { error } = await db
    .schema("core")
    .from("wallet_proofs")
    .update({
      status: "failed",
      error_message: errorCode,
    })
    .eq("id", proofId);

  if (error) {
    throw new ApiError(
      500,
      "WALLET_PROOF_UPDATE_FAILED",
      "钱包 proof 失败状态保存失败。",
      {
        expose: false,
        cause: error,
      },
    );
  }
}

async function markProofExpired(
  db: SupabaseAdminClient,
  proofId: string,
): Promise<void> {
  const { error } = await db
    .schema("core")
    .from("wallet_proofs")
    .update({
      status: "expired",
      used_at: new Date().toISOString(),
      error_message: "expired",
    })
    .eq("id", proofId);

  if (error) {
    throw new ApiError(
      500,
      "WALLET_PROOF_UPDATE_FAILED",
      "钱包 proof 过期状态保存失败。",
      {
        expose: false,
        cause: error,
      },
    );
  }
}

function buildProofAuditPayload(input: WalletProofBody): Json {
  return {
    ton_proof: {
      timestamp: input.proof.timestamp,
      domain: input.proof.domain,
      payload: input.proof.payload,
    },
    account: {
      address: input.account.address,
      chain: input.account.chain,
      public_key_present: Boolean(input.account.publicKey),
      wallet_state_init_present: Boolean(input.account.walletStateInit),
    },
    wallet_app_name: input.walletAppName ?? null,
    idempotency_key_hash: sha256Hex(input.idempotencyKey),
  };
}

function readSubmittedChallenge(body: unknown): string | null {
  if (!isRecord(body)) {
    return null;
  }

  return readString(body.challenge) ?? readString(body.tonProofPayload);
}

function normalizeTonChainValue(value: unknown): string | undefined {
  const normalized =
    typeof value === "string" ? value.trim() : String(value ?? "");

  switch (normalized.toLowerCase()) {
    case "mainnet":
    case "main":
    case "-239":
      return "MAINNET";
    case "testnet":
    case "test":
    case "-3":
      return "TESTNET";
    default:
      return normalized || undefined;
  }
}

function assertExpectedNetwork(chain: "MAINNET" | "TESTNET"): void {
  const expectedNetwork = readExpectedNetwork();

  if (toWalletNetwork(chain) !== expectedNetwork) {
    throw new ApiError(
      400,
      "WALLET_NETWORK_MISMATCH",
      "钱包网络与当前应用网络不匹配。",
      {
        details: {
          expected: expectedNetwork,
          received: toWalletNetwork(chain),
        },
      },
    );
  }
}

function createProofHash(input: WalletProofBody): string {
  return createTonProofHash(input.account, input.proof);
}

function resolveExpectedProofDomain(requestHost: string | null): string {
  try {
    return resolveExpectedTonProofDomain();
  } catch (error) {
    const fallbackDomain = normalizeDomainCandidate(requestHost);

    if (fallbackDomain) {
      return fallbackDomain;
    }

    throw mapTonProofVerificationError(error);
  }
}

function normalizeDomainCandidate(
  value: string | null | undefined,
): string | null {
  if (!value) {
    return null;
  }

  const trimmed = value.trim();

  if (!trimmed) {
    return null;
  }

  try {
    return new URL(
      trimmed.includes("://") ? trimmed : `https://${trimmed}`,
    ).hostname.toLowerCase();
  } catch {
    return trimmed.split(":")[0]?.toLowerCase() ?? null;
  }
}

function sha256Hex(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function readExpectedNetwork(): "mainnet" | "testnet" {
  return process.env.TON_NETWORK === "mainnet" ? "mainnet" : "testnet";
}

function toWalletNetwork(chain: "MAINNET" | "TESTNET"): "mainnet" | "testnet" {
  return normalizeTonNetwork(chain);
}

function readPositiveIntegerEnv(name: string, fallback: number): number {
  const value = process.env[name];

  if (!value) {
    return fallback;
  }

  const parsed = Number.parseInt(value, 10);

  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function isExpired(expiresAt: string): boolean {
  const expiresAtMs = new Date(expiresAt).getTime();

  return !Number.isFinite(expiresAtMs) || expiresAtMs <= Date.now();
}

function mapWalletSaveRpcError(error: unknown): ApiError {
  if (error instanceof ApiError) {
    return error;
  }

  if (error instanceof RpcError) {
    return new ApiError(
      500,
      "WALLET_SAVE_FAILED",
      "保存钱包地址失败，请稍后重试。",
      {
        expose: false,
        cause: error,
      },
    );
  }

  return new ApiError(
    500,
    "WALLET_SAVE_FAILED",
    "保存钱包地址失败，请稍后重试。",
    {
      expose: false,
      cause: error,
    },
  );
}

function mapTonProofVerificationError(error: unknown): ApiError {
  if (error instanceof ApiError) {
    return error;
  }

  if (error instanceof TonProofVerificationError) {
    const code =
      error.code === "TON_PROOF_EXPIRED"
        ? "WALLET_PROOF_EXPIRED"
        : "WALLET_PROOF_INVALID";

    return new ApiError(
      400,
      code,
      code === "WALLET_PROOF_EXPIRED"
        ? "钱包 proof 已过期，请重新连接钱包。"
        : "钱包 proof 校验失败。",
      {
        details: {
          reason: error.code,
          ...(error.details ? { proof: error.details } : {}),
        },
      },
    );
  }

  return new ApiError(400, "WALLET_PROOF_INVALID", "钱包 proof 校验失败。", {
    cause: error,
  });
}

function getPublicErrorCode(error: unknown): string {
  return error instanceof ApiError ? error.code : "wallet_proof_invalid";
}

function isUniqueViolation(error: unknown): boolean {
  return (
    isRecord(error) &&
    (error.code === "23505" ||
      String(error.message ?? "")
        .toLowerCase()
        .includes("duplicate key"))
  );
}

function readString(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }

  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
