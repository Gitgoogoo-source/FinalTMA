import { apiRequest } from "@/api/client";
import { API_ENDPOINTS } from "@/api/endpoints";

import type {
  ConnectWalletInput,
  CreateMintInput,
  CreateMintResult,
  VerifyWalletProofInput,
  WalletChallenge,
  WalletConnectionStatus,
  WalletMintQueueItem,
  WalletMintQueueResponse,
  WalletMintQueueSummary,
  WalletMintQueueStatus,
  WalletNftItem,
  WalletNftListResponse,
  WalletStatusData,
  WalletSyncResult,
  WalletSyncStatus,
} from "./wallet.types";

type JsonRecord = Record<string, unknown>;

const EMPTY_MINT_QUEUE: WalletMintQueueSummary = {
  queued: 0,
  processing: 0,
  submitted: 0,
  confirming: 0,
  retrying: 0,
  minted: 0,
  cancelled: 0,
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

export async function fetchWalletNfts(): Promise<WalletNftListResponse> {
  const response = await apiRequest<unknown>(API_ENDPOINTS.wallet.nfts, {
    method: "GET",
  });

  return normalizeWalletNftListResponse(response);
}

export async function createWalletMint(
  input: CreateMintInput,
): Promise<CreateMintResult> {
  const idempotencyKey =
    input.idempotencyKey ?? createIdempotencyKey("wallet:mint");
  const response = await apiRequest<unknown>(API_ENDPOINTS.wallet.mint, {
    method: "POST",
    body: compactRecord({
      item_instance_id: input.itemInstanceId,
      target_address: input.targetAddress,
      chain: input.chain,
      idempotency_key: idempotencyKey,
    }),
    headers: {
      "X-Idempotency-Key": idempotencyKey,
    },
  });

  return normalizeCreateMintResult(response);
}

export async function fetchWalletMintQueue(): Promise<WalletMintQueueResponse> {
  const response = await apiRequest<unknown>(API_ENDPOINTS.wallet.mintStatus, {
    method: "GET",
  });

  return normalizeMintQueueResponse(response);
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
    syncedCount:
      readInteger(payload.synced_count) ??
      readInteger(payload.syncedCount) ??
      0,
    linkedCount:
      readInteger(payload.linked_count) ??
      readInteger(payload.linkedCount) ??
      0,
    ignoredCount:
      readInteger(payload.ignored_count) ??
      readInteger(payload.ignoredCount) ??
      0,
  };
}

function normalizeWalletNftListResponse(
  response: unknown,
): WalletNftListResponse {
  const payload = isRecord(response) ? response : {};
  const items = Array.isArray(payload.items)
    ? payload.items.map(normalizeWalletNftItem).filter(isWalletNftItem)
    : [];

  return {
    items,
    nextCursor:
      readString(payload.nextCursor) ?? readString(payload.next_cursor),
    serverTime:
      readString(payload.serverTime) ?? readString(payload.server_time),
  };
}

function normalizeWalletNftItem(value: unknown): WalletNftItem | null {
  if (!isRecord(value)) {
    return null;
  }

  const itemAddress =
    readString(value.itemAddress) ?? readString(value.item_address);
  const ownerAddress =
    readString(value.ownerAddress) ?? readString(value.owner_address);
  const syncedAt = readString(value.syncedAt) ?? readString(value.synced_at);

  if (!itemAddress || !ownerAddress || !syncedAt) {
    return null;
  }

  return {
    nftItemId: readString(value.nftItemId) ?? readString(value.nft_item_id),
    itemAddress,
    collectionAddress:
      readString(value.collectionAddress) ??
      readString(value.collection_address),
    ownerAddress,
    itemIndex: readInteger(value.itemIndex) ?? readInteger(value.item_index),
    name: readString(value.name),
    imageUrl: readString(value.imageUrl) ?? readString(value.image_url),
    metadataUrl:
      readString(value.metadataUrl) ?? readString(value.metadata_url),
    linkedItemInstanceId:
      readString(value.linkedItemInstanceId) ??
      readString(value.linked_item_instance_id),
    syncedAt,
  };
}

function isWalletNftItem(value: WalletNftItem | null): value is WalletNftItem {
  return value !== null;
}

function normalizeCreateMintResult(response: unknown): CreateMintResult {
  if (!isRecord(response)) {
    throw new Error("Invalid Mint response.");
  }

  const mintQueueId =
    readString(response.mintQueueId) ?? readString(response.mint_queue_id);
  const itemInstanceId =
    readString(response.itemInstanceId) ??
    readString(response.item_instance_id);

  if (!mintQueueId || !itemInstanceId) {
    throw new Error("Mint response is missing required fields.");
  }

  return {
    accepted: readBoolean(response.accepted) ?? true,
    mintQueueId,
    status: normalizeMintQueueStatus(response.status),
    itemInstanceId,
    metadataUrl:
      readString(response.metadataUrl) ?? readString(response.metadata_url),
    idempotent: readBoolean(response.idempotent) ?? false,
  };
}

function normalizeMintQueueResponse(
  response: unknown,
): WalletMintQueueResponse {
  const payload = isRecord(response) ? response : {};
  const items = Array.isArray(payload.items)
    ? payload.items.map(normalizeMintQueueItem).filter(isMintQueueItem)
    : [];
  const summary =
    normalizeMintQueue(payload.summary ?? payload.mint_queue) ??
    summarizeMintQueueItems(items);

  return {
    items,
    summary,
    nextCursor:
      readString(payload.nextCursor) ?? readString(payload.next_cursor),
    serverTime:
      readString(payload.serverTime) ?? readString(payload.server_time),
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
    submitted: readInteger(summary.submitted) ?? 0,
    confirming: readInteger(summary.confirming) ?? 0,
    retrying: readInteger(summary.retrying) ?? 0,
    minted: readInteger(summary.minted) ?? 0,
    cancelled: readInteger(summary.cancelled) ?? 0,
    failed: readInteger(summary.failed) ?? EMPTY_MINT_QUEUE.failed,
    manualReview:
      readInteger(summary.manual_review) ??
      readInteger(summary.manualReview) ??
      EMPTY_MINT_QUEUE.manualReview,
  };
}

function normalizeMintQueueItem(value: unknown): WalletMintQueueItem | null {
  if (!isRecord(value)) {
    return null;
  }

  const mintQueueId =
    readString(value.mintQueueId) ?? readString(value.mint_queue_id);
  const itemInstanceId =
    readString(value.itemInstanceId) ?? readString(value.item_instance_id);

  if (!mintQueueId || !itemInstanceId) {
    return null;
  }

  return {
    mintQueueId,
    itemInstanceId,
    status: normalizeMintQueueStatus(value.status),
    chain: normalizeTonChain(value.chain),
    collectionAddress:
      readString(value.collectionAddress) ??
      readString(value.collection_address),
    itemAddress:
      readString(value.itemAddress) ?? readString(value.item_address),
    targetAddress:
      readString(value.targetAddress) ?? readString(value.target_address),
    transactionHash:
      readString(value.transactionHash) ??
      readString(value.transaction_hash) ??
      readString(value.tx_hash),
    errorCode: readString(value.errorCode) ?? readString(value.error_code),
    errorMessage:
      readString(value.errorMessage) ?? readString(value.error_message),
    retryCount:
      readInteger(value.retryCount) ?? readInteger(value.retry_count) ?? 0,
    createdAt:
      readString(value.createdAt) ??
      readString(value.created_at) ??
      new Date(0).toISOString(),
    updatedAt:
      readString(value.updatedAt) ??
      readString(value.updated_at) ??
      readString(value.createdAt) ??
      readString(value.created_at) ??
      new Date(0).toISOString(),
    mintedAt: readString(value.mintedAt) ?? readString(value.minted_at),
  };
}

function isMintQueueItem(
  value: WalletMintQueueItem | null,
): value is WalletMintQueueItem {
  return value !== null;
}

function summarizeMintQueueItems(
  items: WalletMintQueueItem[],
): WalletMintQueueSummary {
  const summary = { ...EMPTY_MINT_QUEUE };

  for (const item of items) {
    if (item.status === "manual_review") {
      summary.manualReview += 1;
      continue;
    }

    summary[item.status] += 1;
  }

  return summary;
}

function normalizeMintQueueStatus(value: unknown): WalletMintQueueStatus {
  const normalized =
    typeof value === "string" ? value.trim().toLowerCase() : "";

  switch (normalized) {
    case "queued":
    case "processing":
    case "submitted":
    case "confirming":
    case "retrying":
    case "manual_review":
    case "minted":
    case "failed":
    case "cancelled":
      return normalized;
    case "pending":
      return "queued";
    case "minting":
      return "processing";
    case "confirmed":
      return "minted";
    case "canceled":
      return "cancelled";
    default:
      return "queued";
  }
}

function normalizeTonChain(value: unknown): "MAINNET" | "TESTNET" {
  const normalized =
    typeof value === "string" ? value.trim().toLowerCase() : "";

  return normalized === "testnet" ? "TESTNET" : "MAINNET";
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
