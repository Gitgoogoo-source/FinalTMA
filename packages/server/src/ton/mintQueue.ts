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
  source: "cron.retry_mint_queue" | "mint_worker" | string;
  errorReason?: string | undefined;
  errorMessage?: string | undefined;
  txHash?: string | undefined;
  externalApiProvider?: string | undefined;
  details?: Record<string, unknown> | undefined;
}

export interface MintRetryStrategy {
  maxAttempts: number;
  retryDelaySeconds: number;
  backoffMultiplier: number;
}

export interface MintRetryDecision {
  status: Extract<MintQueueStatus, "retrying" | "manual_review">;
  nextAttemptAt: Date | null;
  attemptCount: number;
  maxAttempts: number;
}

const DEFAULT_MINT_RETRY_STRATEGY: MintRetryStrategy = {
  maxAttempts: 5,
  retryDelaySeconds: 300,
  backoffMultiplier: 2,
};

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

export function readMintRetryStrategy(
  env: NodeJS.ProcessEnv = process.env,
): MintRetryStrategy {
  return {
    maxAttempts: readPositiveInteger(
      env.TON_MINT_MAX_RETRIES,
      DEFAULT_MINT_RETRY_STRATEGY.maxAttempts,
    ),
    retryDelaySeconds: readPositiveInteger(
      env.TON_MINT_RETRY_DELAY_SECONDS,
      DEFAULT_MINT_RETRY_STRATEGY.retryDelaySeconds,
    ),
    backoffMultiplier: readPositiveNumber(
      env.TON_MINT_RETRY_BACKOFF_MULTIPLIER,
      DEFAULT_MINT_RETRY_STRATEGY.backoffMultiplier,
    ),
  };
}

export function buildMintRetryDecision(input: {
  attemptCount: number;
  maxAttempts?: number | null | undefined;
  now?: Date | undefined;
  strategy?: Partial<MintRetryStrategy> | undefined;
}): MintRetryDecision {
  const now = input.now ?? new Date();
  const strategy = {
    ...DEFAULT_MINT_RETRY_STRATEGY,
    ...input.strategy,
  };
  const attemptCount = Math.max(0, Math.trunc(input.attemptCount));
  const maxAttempts = Math.max(
    1,
    Math.trunc(input.maxAttempts ?? strategy.maxAttempts),
  );

  if (attemptCount >= maxAttempts) {
    return {
      status: "manual_review",
      nextAttemptAt: null,
      attemptCount,
      maxAttempts,
    };
  }

  return {
    status: "retrying",
    nextAttemptAt: new Date(
      now.getTime() + calculateRetryDelayMs(attemptCount, strategy),
    ),
    attemptCount,
    maxAttempts,
  };
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

function calculateRetryDelayMs(
  attemptCount: number,
  strategy: MintRetryStrategy,
): number {
  const exponent = Math.max(0, attemptCount - 1);
  const delaySeconds =
    strategy.retryDelaySeconds *
    Math.pow(Math.max(1, strategy.backoffMultiplier), exponent);

  return Math.round(delaySeconds * 1000);
}

function readPositiveInteger(
  value: string | undefined,
  fallback: number,
): number {
  const parsed = Number(value);

  if (!Number.isFinite(parsed) || parsed <= 0) {
    return fallback;
  }

  return Math.trunc(parsed);
}

function readPositiveNumber(
  value: string | undefined,
  fallback: number,
): number {
  const parsed = Number(value);

  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}
