import { buildBackendStatusContext } from "../payments/paymentEvents.js";

export const MINT_QUEUE_STATUSES = [
  "queued",
  "processing",
  "submitted",
  "confirming",
  "retrying",
  "manual_review",
  "minted",
  "failed",
  "cancelled",
] as const;

export type MintQueueStatus = (typeof MINT_QUEUE_STATUSES)[number];

export const ONCHAIN_TRANSACTION_STATUSES = [
  "pending",
  "confirmed",
  "failed",
  "expired",
] as const;

export type OnchainTransactionStatus =
  (typeof ONCHAIN_TRANSACTION_STATUSES)[number];

export interface MintWorkerStatusContextInput {
  requestId: string;
  source: "cron.retry_mint_queue" | "mint_worker" | "admin.retry_mint" | string;
  errorReason?: string | undefined;
  errorMessage?: string | undefined;
  txHash?: string | undefined;
  externalApiProvider?: string | undefined;
  details?: Record<string, unknown> | undefined;
}

const MINT_QUEUE_STATUS_SET = new Set<string>(MINT_QUEUE_STATUSES);
const ONCHAIN_TRANSACTION_STATUS_SET = new Set<string>(
  ONCHAIN_TRANSACTION_STATUSES,
);

const MINT_QUEUE_STATUS_ALIASES: Record<string, MintQueueStatus> = {
  pending: "queued",
  waiting_chain_confirmation: "confirming",
  waiting_confirmation: "confirming",
  confirmed: "minted",
  canceled: "cancelled",
  minting: "processing",
};

export const ACTIVE_MINT_QUEUE_STATUSES = [
  "queued",
  "processing",
  "submitted",
  "confirming",
  "retrying",
  "manual_review",
] as const satisfies readonly MintQueueStatus[];

export const TERMINAL_MINT_QUEUE_STATUSES = [
  "minted",
  "failed",
  "cancelled",
] as const satisfies readonly MintQueueStatus[];

const ACTIVE_MINT_QUEUE_STATUS_SET = new Set<MintQueueStatus>(
  ACTIVE_MINT_QUEUE_STATUSES,
);
const TERMINAL_MINT_QUEUE_STATUS_SET = new Set<MintQueueStatus>(
  TERMINAL_MINT_QUEUE_STATUSES,
);

export function normalizeMintQueueStatus(
  value: unknown,
): MintQueueStatus | null {
  const normalized = normalizeStatusText(value);

  if (!normalized) {
    return null;
  }

  const aliased = MINT_QUEUE_STATUS_ALIASES[normalized] ?? normalized;

  return MINT_QUEUE_STATUS_SET.has(aliased)
    ? (aliased as MintQueueStatus)
    : null;
}

export function normalizeOnchainTransactionStatus(
  value: unknown,
): OnchainTransactionStatus | null {
  const normalized = normalizeStatusText(value);

  if (!normalized) {
    return null;
  }

  const aliased =
    normalized === "sent" || normalized === "created"
      ? "pending"
      : normalized === "canceled"
        ? "expired"
        : normalized;

  return ONCHAIN_TRANSACTION_STATUS_SET.has(aliased)
    ? (aliased as OnchainTransactionStatus)
    : null;
}

export function isActiveMintQueueStatus(value: unknown): boolean {
  const status = normalizeMintQueueStatus(value);

  return status !== null && ACTIVE_MINT_QUEUE_STATUS_SET.has(status);
}

export function isTerminalMintQueueStatus(value: unknown): boolean {
  const status = normalizeMintQueueStatus(value);

  return status !== null && TERMINAL_MINT_QUEUE_STATUS_SET.has(status);
}

export function buildMintWorkerStatusMetadata(
  input: MintWorkerStatusContextInput,
): Record<string, unknown> {
  return buildBackendStatusContext({
    requestId: input.requestId,
    source: input.source,
    errorReason: input.errorReason,
    errorMessage: input.errorMessage,
    details: {
      tx_hash: normalizeOptionalText(input.txHash),
      external_api_provider: normalizeOptionalText(input.externalApiProvider),
      ...input.details,
    },
  });
}

function normalizeStatusText(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }

  const normalized = value.trim().toLowerCase();

  return normalized.length > 0 ? normalized : null;
}

function normalizeOptionalText(value: string | undefined): string | undefined {
  const normalized = value?.trim();

  return normalized ? normalized : undefined;
}
