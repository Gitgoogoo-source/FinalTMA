import { resolve } from "node:path";
import { loadEnvFile } from "node:process";
import { pathToFileURL } from "node:url";

import { callRpcRaw } from "../packages/server/src/db/rpc.js";

type JsonValue =
  | string
  | number
  | boolean
  | null
  | JsonValue[]
  | { [key: string]: JsonValue };

type JsonRecord = { [key: string]: JsonValue };

type EnvLike = Record<string, string | undefined>;

type CandidateRpcRow = {
  star_order_id?: unknown;
  status?: unknown;
  xtr_amount?: unknown;
  paid_at?: unknown;
  updated_at?: unknown;
  fulfilled_at?: unknown;
};

type PaymentRetryCandidatesPayload = {
  orders?: unknown;
};

export type PaymentRetryCandidate = {
  starOrderId: string;
  status: string;
  xtrAmount: number;
  paidAt: string | null;
  updatedAt: string | null;
  fulfilledAt: string | null;
};

export type RetryPaymentFulfillmentResult = {
  star_order_id?: string | null;
  status?: string | null;
  previous_status?: string | null;
  fulfilled?: boolean | string | null;
  fulfillment_status?: string | null;
  reason_code?: string | null;
  retryable?: string | null;
  payment_order_status?: string | null;
  result_count?: string | number | null;
  idempotent?: boolean | string | null;
  audit_log_id?: string | null;
};

export type RetryFailedPaymentsOptions = {
  dryRun: boolean;
  limit: number;
  requestId: string;
  systemAdminUserId: string | null;
};

export type RetryPaymentFulfillmentInput = {
  candidate: PaymentRetryCandidate;
  idempotencyKey: string;
  requestId: string;
  systemAdminUserId: string;
};

export type RetryFailedPaymentsDeps = {
  listCandidates: (limit: number) => Promise<PaymentRetryCandidate[]>;
  retryFulfillment: (
    input: RetryPaymentFulfillmentInput,
  ) => Promise<RetryPaymentFulfillmentResult>;
};

export type PaymentRetryError = {
  starOrderId: string | null;
  code: string;
  message: string;
};

export type PaymentRetryOrderResult = {
  starOrderId: string;
  action: "retried" | "skipped" | "failed";
  idempotencyKey: string | null;
  status: string | null;
  previousStatus: string | null;
  fulfilled: boolean | null;
  idempotent: boolean | null;
  auditLogId: string | null;
  error: PaymentRetryError | null;
};

export type RetryFailedPaymentsOutput = {
  ok: boolean;
  dryRun: boolean;
  limit: number;
  candidateCount: number;
  processed: number;
  retried: number;
  skipped: number;
  failed: number;
  candidates: PaymentRetryCandidate[];
  results: PaymentRetryOrderResult[];
  errors: PaymentRetryError[];
};

type RuntimeConfig = {
  dryRun: boolean;
  limit: number;
  systemAdminUserId: string | null;
};

class RetryFailedPaymentsScriptError extends Error {
  public readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = "RetryFailedPaymentsScriptError";
    this.code = code;
  }
}

const DEFAULT_PAYMENT_RETRY_LIMIT = 10;
const PAYMENT_RETRY_STATUSES = [
  "paid",
  "fulfilling",
  "failed",
] as const;
type PaymentRetryStatus = (typeof PAYMENT_RETRY_STATUSES)[number];
const PAYMENT_RETRY_SOURCE = "scripts.retry_failed_payments";
const PAYMENT_RETRY_REASON =
  "Automated payment fulfillment retry by retry-failed-payments script";
const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const SKIPPED_RETRY_ERROR_CODES = new Set([
  "ADMIN_PAYMENT_ALREADY_FULFILLED",
  "ADMIN_PAYMENT_NOT_RETRYABLE",
]);

async function main(): Promise<void> {
  const args = process.argv.slice(2);

  if (args.includes("--help") || args.includes("-h")) {
    console.log(getHelpText());
    return;
  }

  assertNoUnsupportedArgs(args);
  loadLocalEnvFile();

  const startedAt = Date.now();
  const requestId = `script-retry-failed-payments-${startedAt}`;
  const runtime = parsePaymentRetryRuntime(process.env);
  const output = await runRetryFailedPayments({
    ...runtime,
    requestId,
  });

  console.log(
    JSON.stringify(
      {
        ...output,
        requestId,
        elapsedMs: Date.now() - startedAt,
      },
      null,
      2,
    ),
  );

  if (!output.ok) {
    process.exitCode = 1;
  }
}

export function parsePaymentRetryRuntime(
  env: EnvLike = process.env,
): RuntimeConfig {
  const dryRun = parsePaymentRetryDryRun(env.PAYMENT_RETRY_DRY_RUN);
  const limit = parsePaymentRetryLimit(env.PAYMENT_RETRY_LIMIT);
  const systemAdminUserId = parseSystemAdminUserId(
    env.SYSTEM_ADMIN_USER_ID,
    dryRun,
  );

  return {
    dryRun,
    limit,
    systemAdminUserId,
  };
}

export function parsePaymentRetryDryRun(value: string | undefined): boolean {
  const normalized = value?.trim().toLowerCase();

  if (!normalized) {
    return false;
  }

  if (["1", "true", "yes", "on"].includes(normalized)) {
    return true;
  }

  if (["0", "false", "no", "off"].includes(normalized)) {
    return false;
  }

  throw new RetryFailedPaymentsScriptError(
    "PAYMENT_RETRY_DRY_RUN_INVALID",
    "PAYMENT_RETRY_DRY_RUN must be true or false.",
  );
}

export function parsePaymentRetryLimit(value: string | undefined): number {
  const normalized = value?.trim();

  if (!normalized) {
    return DEFAULT_PAYMENT_RETRY_LIMIT;
  }

  if (!/^\d+$/.test(normalized)) {
    throw new RetryFailedPaymentsScriptError(
      "PAYMENT_RETRY_LIMIT_INVALID",
      "PAYMENT_RETRY_LIMIT must be a positive integer.",
    );
  }

  const parsed = Number.parseInt(normalized, 10);

  if (!Number.isSafeInteger(parsed) || parsed <= 0) {
    throw new RetryFailedPaymentsScriptError(
      "PAYMENT_RETRY_LIMIT_INVALID",
      "PAYMENT_RETRY_LIMIT must be a positive integer.",
    );
  }

  return parsed;
}

export function buildPaymentRetryIdempotencyKey(starOrderId: string): string {
  return `script-retry-payment:${starOrderId}`;
}

export async function runRetryFailedPayments(
  options: RetryFailedPaymentsOptions,
  deps: RetryFailedPaymentsDeps = {
    listCandidates: listCandidatePaymentOrders,
    retryFulfillment: retryPaymentFulfillment,
  },
): Promise<RetryFailedPaymentsOutput> {
  const candidates = await deps.listCandidates(options.limit);
  const output: RetryFailedPaymentsOutput = {
    ok: true,
    dryRun: options.dryRun,
    limit: options.limit,
    candidateCount: candidates.length,
    processed: 0,
    retried: 0,
    skipped: 0,
    failed: 0,
    candidates,
    results: [],
    errors: [],
  };

  if (options.dryRun) {
    return output;
  }

  if (!options.systemAdminUserId) {
    throw new RetryFailedPaymentsScriptError(
      "SYSTEM_ADMIN_USER_ID_REQUIRED",
      "SYSTEM_ADMIN_USER_ID is required when PAYMENT_RETRY_DRY_RUN is not true.",
    );
  }

  for (const candidate of candidates) {
    output.processed += 1;

    const idempotencyKey = buildPaymentRetryIdempotencyKey(
      candidate.starOrderId,
    );

    try {
      const result = await deps.retryFulfillment({
        candidate,
        idempotencyKey,
        requestId: options.requestId,
        systemAdminUserId: options.systemAdminUserId,
      });

      const idempotent = normalizeBooleanResult(result.idempotent);
      const action = idempotent ? "skipped" : "retried";

      if (action === "skipped") {
        output.skipped += 1;
      } else {
        output.retried += 1;
      }

      output.results.push({
        starOrderId: candidate.starOrderId,
        action,
        idempotencyKey,
        status: normalizeOptionalString(result.status),
        previousStatus: normalizeOptionalString(result.previous_status),
        fulfilled: normalizeBooleanResult(result.fulfilled),
        idempotent,
        auditLogId: normalizeOptionalString(result.audit_log_id),
        error: null,
      });
    } catch (error) {
      const retryError = normalizeRetryError(error, candidate.starOrderId);

      if (SKIPPED_RETRY_ERROR_CODES.has(retryError.code)) {
        output.skipped += 1;
        output.results.push({
          starOrderId: candidate.starOrderId,
          action: "skipped",
          idempotencyKey,
          status: null,
          previousStatus: candidate.status,
          fulfilled: retryError.code === "ADMIN_PAYMENT_ALREADY_FULFILLED",
          idempotent: null,
          auditLogId: null,
          error: retryError,
        });
        continue;
      }

      output.failed += 1;
      output.ok = false;
      output.errors.push(retryError);
      output.results.push({
        starOrderId: candidate.starOrderId,
        action: "failed",
        idempotencyKey,
        status: null,
        previousStatus: candidate.status,
        fulfilled: null,
        idempotent: null,
        auditLogId: null,
        error: retryError,
      });
    }
  }

  return output;
}

async function listCandidatePaymentOrders(
  limit: number,
): Promise<PaymentRetryCandidate[]> {
  const payload = await callRpcRaw<PaymentRetryCandidatesPayload>(
    "admin_list_retryable_payment_orders",
    {
      p_limit: limit,
    },
    {
      schema: "api" as never,
      context: {
        source: PAYMENT_RETRY_SOURCE,
        operation: "list_retryable_payment_orders",
      },
    },
  );

  return normalizePaymentRetryCandidatesPayload(payload);
}

async function retryPaymentFulfillment(
  input: RetryPaymentFulfillmentInput,
): Promise<RetryPaymentFulfillmentResult> {
  const requestContext: JsonRecord = {
    source: PAYMENT_RETRY_SOURCE,
    request_id: input.requestId,
    star_order_id: input.candidate.starOrderId,
  };

  return callRpcRaw<RetryPaymentFulfillmentResult>(
    "admin_retry_payment_fulfillment",
    {
      p_admin_user_id: input.systemAdminUserId,
      p_star_order_id: input.candidate.starOrderId,
      p_reason: PAYMENT_RETRY_REASON,
      p_idempotency_key: input.idempotencyKey,
      p_request_context: requestContext,
    },
    {
      schema: "api" as never,
      context: {
        requestId: input.requestId,
        source: PAYMENT_RETRY_SOURCE,
        starOrderId: input.candidate.starOrderId,
      },
    },
  );
}

function parseSystemAdminUserId(
  value: string | undefined,
  dryRun: boolean,
): string | null {
  const normalized = value?.trim();

  if (!normalized) {
    return dryRun ? null : null;
  }

  if (!UUID_RE.test(normalized)) {
    throw new RetryFailedPaymentsScriptError(
      "SYSTEM_ADMIN_USER_ID_INVALID",
      "SYSTEM_ADMIN_USER_ID must be a UUID.",
    );
  }

  return normalized;
}

export function normalizePaymentRetryCandidatesPayload(
  payload: PaymentRetryCandidatesPayload,
): PaymentRetryCandidate[] {
  if (!Array.isArray(payload.orders)) {
    throw new RetryFailedPaymentsScriptError(
      "PAYMENT_RETRY_CANDIDATE_PAYLOAD_INVALID",
      "admin_list_retryable_payment_orders must return an orders array.",
    );
  }

  return payload.orders.map((row) => normalizeCandidateRow(row));
}

function normalizeCandidateRow(row: unknown): PaymentRetryCandidate {
  if (!isRecord(row)) {
    throw new RetryFailedPaymentsScriptError(
      "PAYMENT_RETRY_CANDIDATE_INVALID",
      "Candidate row must be an object.",
    );
  }

  const candidate = row as CandidateRpcRow;
  const starOrderId =
    typeof candidate.star_order_id === "string"
      ? candidate.star_order_id.trim()
      : "";
  const status =
    typeof candidate.status === "string" ? candidate.status.trim() : "";

  if (!UUID_RE.test(starOrderId)) {
    throw new RetryFailedPaymentsScriptError(
      "PAYMENT_RETRY_CANDIDATE_INVALID",
      "Candidate star order id must be a UUID.",
    );
  }

  if (!PAYMENT_RETRY_STATUSES.includes(status as PaymentRetryStatus)) {
    throw new RetryFailedPaymentsScriptError(
      "PAYMENT_RETRY_CANDIDATE_INVALID",
      `Candidate status must be one of ${PAYMENT_RETRY_STATUSES.join(", ")}.`,
    );
  }

  return {
    starOrderId,
    status,
    xtrAmount: normalizeXtrAmount(candidate.xtr_amount),
    paidAt: normalizeNullableIsoString(candidate.paid_at),
    updatedAt: normalizeNullableIsoString(candidate.updated_at),
    fulfilledAt: normalizeNullableIsoString(candidate.fulfilled_at),
  };
}

function normalizeXtrAmount(value: unknown): number {
  const parsed =
    typeof value === "number"
      ? value
      : typeof value === "string"
        ? Number.parseInt(value, 10)
        : Number.NaN;

  if (!Number.isSafeInteger(parsed) || parsed <= 0) {
    throw new RetryFailedPaymentsScriptError(
      "PAYMENT_RETRY_CANDIDATE_INVALID",
      "Candidate xtr_amount must be a positive integer.",
    );
  }

  return parsed;
}

function normalizeNullableIsoString(value: unknown): string | null {
  if (value === null) {
    return null;
  }

  if (typeof value !== "string") {
    throw new RetryFailedPaymentsScriptError(
      "PAYMENT_RETRY_CANDIDATE_INVALID",
      "Candidate timestamp must be an ISO date string.",
    );
  }

  const timestamp = Date.parse(value);

  if (!Number.isFinite(timestamp)) {
    throw new RetryFailedPaymentsScriptError(
      "PAYMENT_RETRY_CANDIDATE_INVALID",
      "Candidate timestamp must be an ISO date string.",
    );
  }

  return new Date(timestamp).toISOString();
}

function normalizeOptionalString(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0
    ? value.trim()
    : null;
}

function normalizeBooleanResult(value: unknown): boolean | null {
  if (typeof value === "boolean") {
    return value;
  }

  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();

    if (normalized === "true") {
      return true;
    }

    if (normalized === "false") {
      return false;
    }
  }

  return null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function normalizeRetryError(
  error: unknown,
  starOrderId: string | null,
): PaymentRetryError {
  const message = error instanceof Error ? error.message : String(error);

  return {
    starOrderId,
    code: extractRetryErrorCode(message, error),
    message,
  };
}

function extractRetryErrorCode(message: string, error: unknown): string {
  if (error instanceof RetryFailedPaymentsScriptError) {
    return error.code;
  }

  const match = message.match(/\b(ADMIN_[A-Z0-9_]+|IDEMPOTENCY_[A-Z0-9_]+)\b/);

  return match?.[1] ?? "PAYMENT_RETRY_FAILED";
}

function assertNoUnsupportedArgs(args: string[]): void {
  const unsupported = args.filter((arg) => arg !== "--help" && arg !== "-h");

  if (unsupported.length > 0) {
    throw new RetryFailedPaymentsScriptError(
      "UNKNOWN_ARGUMENT",
      `Unknown argument: ${unsupported[0]}`,
    );
  }
}

function normalizeCaughtErrors(error: unknown): PaymentRetryError[] {
  return [normalizeRetryError(error, null)];
}

function loadLocalEnvFile(): void {
  try {
    loadEnvFile();
  } catch (error) {
    if (!isFileNotFoundError(error)) {
      throw error;
    }
  }
}

function isFileNotFoundError(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code?: unknown }).code === "ENOENT"
  );
}

function getHelpText(): string {
  return [
    "Usage: pnpm ops:retry-payments",
    "",
    "Queries payments.star_orders where status is paid, fulfilling, or failed and fulfilled_at is null.",
    `Set PAYMENT_RETRY_LIMIT to control batch size. Default: ${DEFAULT_PAYMENT_RETRY_LIMIT}.`,
    "Set PAYMENT_RETRY_DRY_RUN=true to only print candidate orders.",
    "For non dry-run runs, SYSTEM_ADMIN_USER_ID must be an active ops.admin_users id.",
  ].join("\n");
}

function isMainModule(): boolean {
  const entry = process.argv[1];

  if (!entry) {
    return false;
  }

  return import.meta.url === pathToFileURL(resolve(entry)).href;
}

if (isMainModule()) {
  main().catch((error: unknown) => {
    console.error(
      JSON.stringify(
        {
          ok: false,
          dryRun: null,
          limit: null,
          candidateCount: 0,
          processed: 0,
          retried: 0,
          skipped: 0,
          failed: 1,
          candidates: [],
          results: [],
          errors: normalizeCaughtErrors(error),
        },
        null,
        2,
      ),
    );
    process.exitCode = 1;
  });
}
