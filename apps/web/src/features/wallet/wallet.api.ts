import { apiRequest } from "@/api/client";
import { API_ENDPOINTS } from "@/api/endpoints";

import type {
  ConnectWalletInput,
  VerifyWalletProofInput,
  WalletChallenge,
  WalletConnectionStatus,
  WalletMintQueueSummary,
  WalletStatusData,
  WalletSyncResult,
  WalletSyncStatus,
} from "./wallet.types";

type JsonRecord = Record<string, unknown>;

const EMPTY_MINT_QUEUE: WalletMintQueueSummary = {
  queued: 0,
  processing: 0,
  failed: 0,
  manualReview: 0,
};

export async function fetchWalletStatus(): Promise<WalletStatusData> {
  const response = await apiRequest<unknown>(API_ENDPOINTS.wallet.status, {
    method: "GET",
  });

  return normalizeWalletStatus(response);
}

export async function connectWallet(
  input: ConnectWalletInput,
): Promise<WalletStatusData> {
  const idempotencyKey =
    input.idempotencyKey ?? createIdempotencyKey("wallet:connect");
  const response = await apiRequest<unknown>(API_ENDPOINTS.wallet.connect, {
    method: "POST",
    body: compactRecord({
      address: input.address,
      raw_address: input.rawAddress,
      network: input.network,
      wallet_app_name: input.walletAppName,
      account: input.account,
      idempotency_key: idempotencyKey,
    }),
    headers: {
      "X-Idempotency-Key": idempotencyKey,
    },
  });

  return normalizeWalletStatus(response, {
    address: input.address,
    rawAddress: input.rawAddress ?? input.address,
    network: input.network ?? null,
    walletAppName: input.walletAppName ?? null,
    status: "connected_unverified",
  });
}

export async function requestWalletChallenge(): Promise<WalletChallenge> {
  const response = await apiRequest<unknown>(API_ENDPOINTS.wallet.challenge, {
    method: "POST",
  });

  return normalizeWalletChallenge(response);
}

export async function verifyWalletProof(
  input: VerifyWalletProofInput,
): Promise<WalletStatusData> {
  const idempotencyKey =
    input.idempotencyKey ?? createIdempotencyKey("wallet:proof");
  const response = await apiRequest<unknown>(API_ENDPOINTS.wallet.proof, {
    method: "POST",
    body: compactRecord({
      account: input.account,
      proof: input.proof,
      wallet_app_name: input.walletAppName,
      challenge: input.challenge,
      idempotency_key: idempotencyKey,
    }),
    headers: {
      "X-Idempotency-Key": idempotencyKey,
    },
  });

  return normalizeWalletStatus(response, {
    address: input.account.address,
    rawAddress: input.account.address,
    network: input.account.chain,
    walletAppName: input.walletAppName ?? null,
    status: "verified",
  });
}

export async function disconnectWallet(): Promise<WalletStatusData> {
  const idempotencyKey = createIdempotencyKey("wallet:disconnect");
  const response = await apiRequest<unknown>(API_ENDPOINTS.wallet.disconnect, {
    method: "POST",
    body: {
      idempotency_key: idempotencyKey,
    },
    headers: {
      "X-Idempotency-Key": idempotencyKey,
    },
  });

  return normalizeWalletStatus(response, {
    address: null,
    rawAddress: null,
    network: null,
    walletAppName: null,
    status: "disconnected",
  });
}

export async function syncWalletNfts(): Promise<WalletSyncResult> {
  const idempotencyKey = createIdempotencyKey("wallet:sync-nfts");
  const response = await apiRequest<unknown>(API_ENDPOINTS.wallet.syncNfts, {
    method: "POST",
    body: {
      idempotency_key: idempotencyKey,
    },
    headers: {
      "X-Idempotency-Key": idempotencyKey,
    },
  });

  return normalizeWalletSyncResult(response);
}

export async function fetchWalletMintQueue(): Promise<WalletMintQueueSummary> {
  const response = await apiRequest<unknown>(API_ENDPOINTS.wallet.mintStatus, {
    method: "GET",
  });

  return normalizeMintQueue(response) ?? EMPTY_MINT_QUEUE;
}

export function normalizeWalletStatus(
  response: unknown,
  fallback: Partial<WalletStatusData> = {},
): WalletStatusData {
  const payload = isRecord(response) ? response : {};
  const wallet = isRecord(payload.wallet) ? payload.wallet : payload;
  const address =
    readString(wallet.address) ??
    readString(wallet.user_friendly_address) ??
    readString(wallet.friendly_address) ??
    fallback.address ??
    null;
  const rawAddress =
    readString(wallet.raw_address) ??
    readString(wallet.rawAddress) ??
    readString(wallet.account_address) ??
    fallback.rawAddress ??
    address;
  const verifiedAt =
    readString(wallet.verified_at) ??
    readString(wallet.verifiedAt) ??
    fallback.verifiedAt ??
    null;
  const rawStatus =
    readString(wallet.status) ??
    readString(payload.status) ??
    fallback.status ??
    null;
  const verified =
    readBoolean(wallet.verified) ?? readBoolean(payload.verified) ?? false;

  return {
    status: normalizeConnectionStatus(rawStatus, {
      hasAddress: Boolean(address),
      verified: verified || Boolean(verifiedAt),
    }),
    address,
    rawAddress,
    network:
      readString(wallet.network) ??
      readString(wallet.chain) ??
      fallback.network ??
      null,
    walletAppName:
      readString(wallet.wallet_app_name) ??
      readString(wallet.walletAppName) ??
      readString(wallet.app_name) ??
      fallback.walletAppName ??
      null,
    verifiedAt,
    lastSyncAt:
      readString(wallet.last_sync_at) ??
      readString(wallet.lastSyncAt) ??
      fallback.lastSyncAt ??
      null,
    syncStatus: normalizeSyncStatus(
      payload.sync_status ?? wallet.sync_status ?? fallback.syncStatus,
    ),
    mintQueue:
      normalizeMintQueue(payload.mint_queue ?? wallet.mint_queue) ??
      fallback.mintQueue ??
      null,
    errorMessage:
      readString(wallet.error_message) ??
      readString(wallet.errorMessage) ??
      readString(payload.error_message) ??
      fallback.errorMessage ??
      null,
  };
}

function normalizeWalletChallenge(response: unknown): WalletChallenge {
  const payload = isRecord(response) ? response : {};
  const challenge =
    readString(payload.challenge) ??
    readString(payload.payload) ??
    readString(payload.ton_proof_payload) ??
    readString(payload.tonProofPayload);

  if (!challenge) {
    throw new Error("Wallet challenge response is missing challenge.");
  }

  return {
    challenge,
    tonProofPayload:
      readString(payload.ton_proof_payload) ??
      readString(payload.tonProofPayload) ??
      challenge,
    expiresAt:
      readString(payload.expires_at) ?? readString(payload.expiresAt) ?? null,
  };
}

function normalizeWalletSyncResult(response: unknown): WalletSyncResult {
  const payload = isRecord(response) ? response : {};

  return {
    status: normalizeSyncStatus(payload.status ?? payload.sync_status),
    jobId: readString(payload.job_id) ?? readString(payload.jobId) ?? null,
    lastSyncAt:
      readString(payload.last_sync_at) ??
      readString(payload.lastSyncAt) ??
      null,
    message: readString(payload.message),
  };
}

function normalizeMintQueue(value: unknown): WalletMintQueueSummary | null {
  const root = isRecord(value) ? value : null;
  const payload = isRecord(root?.mint_queue) ? root.mint_queue : root;

  if (!payload) {
    return null;
  }

  const summary = isRecord(payload.summary) ? payload.summary : payload;

  return {
    queued: readInteger(summary.queued) ?? EMPTY_MINT_QUEUE.queued,
    processing: readInteger(summary.processing) ?? EMPTY_MINT_QUEUE.processing,
    failed: readInteger(summary.failed) ?? EMPTY_MINT_QUEUE.failed,
    manualReview:
      readInteger(summary.manual_review) ??
      readInteger(summary.manualReview) ??
      EMPTY_MINT_QUEUE.manualReview,
  };
}

function normalizeConnectionStatus(
  value: unknown,
  options: { hasAddress: boolean; verified: boolean },
): WalletConnectionStatus {
  const normalized =
    typeof value === "string" ? value.trim().toLowerCase() : "";

  switch (normalized) {
    case "connecting":
      return "connecting";
    case "connected_unverified":
    case "invalid_proof":
    case "expired_proof":
    case "verified":
    case "not_connected":
    case "disconnected":
      return normalized;
    case "connected":
      return options.verified ? "verified" : "connected_unverified";
    case "revoked":
      return "disconnected";
    default:
      if (options.verified) {
        return "verified";
      }

      return options.hasAddress ? "connected_unverified" : "not_connected";
  }
}

function normalizeSyncStatus(value: unknown): WalletSyncStatus {
  const normalized =
    typeof value === "string" ? value.trim().toLowerCase() : "";

  switch (normalized) {
    case "queued":
    case "syncing":
    case "success":
    case "failed":
    case "disabled":
      return normalized;
    case "completed":
      return "success";
    case "processing":
      return "syncing";
    default:
      return "idle";
  }
}

function createIdempotencyKey(scope: string): string {
  const randomValue =
    globalThis.crypto?.randomUUID?.() ??
    `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;

  return `${scope}:${randomValue}`;
}

function compactRecord(value: JsonRecord): JsonRecord {
  return Object.fromEntries(
    Object.entries(value).filter(
      ([, item]) => item !== undefined && item !== null,
    ),
  );
}

function readString(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }

  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function readBoolean(value: unknown): boolean | null {
  if (typeof value === "boolean") {
    return value;
  }

  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();

    if (["true", "1", "yes", "y", "on"].includes(normalized)) {
      return true;
    }

    if (["false", "0", "no", "n", "off"].includes(normalized)) {
      return false;
    }
  }

  return null;
}

function readInteger(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) {
    return Math.trunc(value);
  }

  if (typeof value === "string" && value.trim().length > 0) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? Math.trunc(parsed) : null;
  }

  return null;
}

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
