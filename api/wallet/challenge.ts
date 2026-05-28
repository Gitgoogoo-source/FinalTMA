import {
  getSupabaseAdminClient,
  type SupabaseAdminClient,
} from "../../packages/server/src/db/supabaseAdmin.js";
import { createTonProofChallenge } from "../../packages/server/src/ton/tonConnect.js";
import { ApiError, withApiHandler } from "../_shared/handler.js";
import { requireSession } from "../_shared/requireSession.js";

type WalletChallengeRow = {
  id: string;
  challenge: string;
  expires_at: string;
};

type WalletChallengeResponse = {
  challenge: string;
  ton_proof_payload: string;
  tonProofPayload: string;
  expires_at: string;
  expiresAt: string;
  server_time: string;
  serverTime: string;
};

const DEFAULT_CHALLENGE_BYTES = 32;
const DEFAULT_TTL_SECONDS = 5 * 60;
const MAX_INSERT_ATTEMPTS = 3;

export default withApiHandler(
  async (req, _res, ctx) => {
    const session = await requireSession(req);
    const now = new Date();
    const ttlSeconds = readPositiveIntegerEnv(
      "TON_PROOF_TTL_SECONDS",
      DEFAULT_TTL_SECONDS,
    );
    const challengeBytes = readPositiveIntegerEnv(
      "TON_PROOF_CHALLENGE_BYTES",
      DEFAULT_CHALLENGE_BYTES,
    );
    const expiresAt = new Date(now.getTime() + ttlSeconds * 1000);
    const row = await createWalletChallenge(getSupabaseAdminClient(), {
      userId: session.userId,
      sessionId: session.sessionId,
      requestId: ctx.requestId,
      challengeBytes,
      ttlSeconds,
      expiresAt,
    });

    return toWalletChallengeResponse(row, now);
  },
  {
    methods: ["POST"],
    rateLimit: {
      action: "wallet.connect",
    },
  },
);

export async function createWalletChallenge(
  db: SupabaseAdminClient,
  input: {
    userId: string;
    sessionId: string;
    requestId: string;
    challengeBytes: number;
    ttlSeconds: number;
    expiresAt: Date;
  },
): Promise<WalletChallengeRow> {
  let lastError: unknown = null;

  for (let attempt = 0; attempt < MAX_INSERT_ATTEMPTS; attempt += 1) {
    const challenge = createChallenge(input.challengeBytes);
    const { data, error } = await db
      .schema("core")
      .from("wallet_proofs")
      .insert({
        user_id: input.userId,
        challenge,
        proof_nonce: challenge,
        status: "pending",
        expires_at: input.expiresAt.toISOString(),
        request_id: input.requestId,
        payload: {
          purpose: "ton_proof",
          session_id: input.sessionId,
          ttl_seconds: input.ttlSeconds,
        },
      })
      .select("id,challenge,expires_at")
      .single<WalletChallengeRow>();

    if (!error && data) {
      return data;
    }

    lastError = error;

    if (!isUniqueViolation(error)) {
      break;
    }
  }

  throw new ApiError(
    500,
    "WALLET_CHALLENGE_CREATE_FAILED",
    "创建钱包验证 challenge 失败。",
    {
      expose: false,
      cause: lastError,
    },
  );
}

function toWalletChallengeResponse(
  row: WalletChallengeRow,
  now: Date,
): WalletChallengeResponse {
  return {
    challenge: row.challenge,
    ton_proof_payload: row.challenge,
    tonProofPayload: row.challenge,
    expires_at: row.expires_at,
    expiresAt: row.expires_at,
    server_time: now.toISOString(),
    serverTime: now.toISOString(),
  };
}

function createChallenge(byteLength: number): string {
  return createTonProofChallenge({
    bytes: byteLength,
  });
}

function readPositiveIntegerEnv(name: string, fallback: number): number {
  const value = process.env[name];

  if (!value) {
    return fallback;
  }

  const parsed = Number.parseInt(value, 10);

  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
