import { resolve } from "node:path";
import { loadEnvFile } from "node:process";
import { pathToFileURL } from "node:url";

import type { JsonObject } from "../packages/server/src/db/transactions.js";
import {
  runManagedWorker,
  type WorkerRunSummary,
} from "../packages/server/src/jobs/workerRuntime.js";
import { getSupabaseAdminClient } from "../packages/server/src/db/supabaseAdmin.js";
import { createTonNftService } from "../packages/server/src/ton/nft.js";
import {
  runMintQueueWorker,
  type MintQueueRetryStatus,
} from "../api/cron/retry-mint-queue.js";

type EnvLike = Record<string, string | undefined>;

type MintRetryStatus = MintQueueRetryStatus;

type MintRetryCandidate = {
  id: string;
  status: MintRetryStatus;
  attemptCount: number;
  maxAttempts: number;
  nextAttemptAt: string | null;
  priority: number;
  errorMessage: string | null;
};

type RetryFailedMintsOptions = {
  dryRun: boolean;
  limit: number;
  onlyStatus: MintRetryStatus[] | null;
  requestId: string;
};

type RetryFailedMintsOutput = {
  ok: boolean;
  dryRun: boolean;
  limit: number;
  onlyStatus: MintRetryStatus[] | null;
  candidateCount: number;
  processed: number;
  retried: number;
  skipped: number;
  failed: number;
  candidates: MintRetryCandidate[];
  result: Record<string, unknown> | null;
  errors: Array<{ code: string; message: string }>;
};

type RuntimeConfig = Omit<RetryFailedMintsOptions, "requestId">;

const DEFAULT_MINT_RETRY_LIMIT = 10;
const MINT_RETRY_STATUSES = ["queued", "retrying"] as const;

async function main(): Promise<void> {
  const args = process.argv.slice(2);

  if (args.includes("--help") || args.includes("-h")) {
    console.log(getHelpText());
    return;
  }

  assertNoUnsupportedArgs(args);
  loadLocalEnvFile();

  const startedAt = Date.now();
  const startedAtIso = new Date(startedAt).toISOString();
  const requestId = `script-retry-failed-mints-${startedAt}`;
  const summary = await runRetryFailedMintsManaged({
    ...parseMintRetryRuntime(process.env),
    requestId,
  });

  console.log(
    JSON.stringify(
      {
        ...summary,
        ...(summary.result ?? {}),
        started_at: summary.started_at ?? startedAtIso,
        requestId,
        elapsedMs: Date.now() - startedAt,
      },
      null,
      2,
    ),
  );

  if (summary.status === "failed" || summary.status === "partial_failed") {
    process.exitCode = 1;
  }
}

export function parseMintRetryRuntime(
  env: EnvLike = process.env,
): RuntimeConfig {
  return {
    dryRun: parseBoolean(env.MINT_RETRY_DRY_RUN ?? env.DRY_RUN, false),
    limit: parseLimit(env.MINT_RETRY_LIMIT ?? env.LIMIT),
    onlyStatus: parseOnlyStatus(env.MINT_RETRY_ONLY_STATUS ?? env.ONLY_STATUS),
  };
}

export async function runRetryFailedMints(
  options: RetryFailedMintsOptions,
): Promise<RetryFailedMintsOutput> {
  const candidates = filterCandidatesByStatus(
    await listRetryableMintQueue(options.limit, options.onlyStatus),
    options.onlyStatus,
  );
  const output: RetryFailedMintsOutput = {
    ok: true,
    dryRun: options.dryRun,
    limit: options.limit,
    onlyStatus: options.onlyStatus,
    candidateCount: candidates.length,
    processed: 0,
    retried: 0,
    skipped: 0,
    failed: 0,
    candidates,
    result: null,
    errors: [],
  };

  if (options.dryRun || candidates.length === 0) {
    return output;
  }

  try {
    const result = await runMintQueueWorker({
      db: getSupabaseAdminClient(),
      provider: createTonNftService(),
      requestId: options.requestId,
      env: {
        ...process.env,
        TON_MINT_BATCH_SIZE: String(options.limit),
      },
      statusFilter: options.onlyStatus ?? undefined,
    });

    output.result = result as unknown as Record<string, unknown>;
    output.processed = result.claimed;
    output.retried = result.submitted + result.confirming + result.minted;
    output.skipped = result.skipped;
    output.failed = result.errors.length;
    output.ok = output.failed === 0;
    output.errors = result.errors.map((error) => ({
      code: error.code,
      message: `Mint queue ${error.mintQueueId} failed with ${error.code}`,
    }));

    return output;
  } catch (error) {
    output.ok = false;
    output.failed = 1;
    output.errors.push(normalizeError(error));

    return output;
  }
}

export async function runRetryFailedMintsManaged(
  options: RetryFailedMintsOptions,
): Promise<WorkerRunSummary> {
  return runManagedWorker({
    jobName: "retry_mints",
    requestId: options.requestId,
    triggeredBy: "script",
    idempotencyKey: `script-retry-mints:${options.requestId}`,
    params: toJsonObject({
      dryRun: options.dryRun,
      limit: options.limit,
      onlyStatus: options.onlyStatus,
    }),
    task: async () => {
      const output = await runRetryFailedMints(options);

      return {
        status: getMintRetryOutputStatus(output),
        processedCount: output.processed,
        failedCount: output.failed,
        errorMessage: output.errors[0]?.message ?? null,
        result: toJsonObject(output as unknown as Record<string, unknown>),
      };
    },
  });
}

async function listRetryableMintQueue(
  limit: number,
  onlyStatus: readonly MintRetryStatus[] | null,
): Promise<MintRetryCandidate[]> {
  const now = new Date().toISOString();
  const { data, error } = await getSupabaseAdminClient()
    .schema("onchain")
    .from("mint_queue")
    .select(
      "id,status,attempt_count,max_attempts,next_attempt_at,priority,error_message",
    )
    .in(
      "status",
      onlyStatus && onlyStatus.length > 0
        ? [...onlyStatus]
        : ["queued", "retrying"],
    )
    .or(`next_attempt_at.is.null,next_attempt_at.lte.${now}`)
    .order("priority", { ascending: true })
    .order("created_at", { ascending: true })
    .limit(limit);

  if (error) {
    throw new Error(error.message);
  }

  return Array.isArray(data)
    ? (data as Array<Record<string, unknown>>).map(normalizeCandidate)
    : [];
}

function normalizeCandidate(row: Record<string, unknown>): MintRetryCandidate {
  const status = typeof row.status === "string" ? row.status : "";

  if (!MINT_RETRY_STATUSES.includes(status as MintRetryStatus)) {
    throw new Error("Mint retry candidate status is invalid.");
  }

  return {
    id: readRequiredString(row.id, "id"),
    status: status as MintRetryStatus,
    attemptCount: readNonNegativeInteger(row.attempt_count),
    maxAttempts: readNonNegativeInteger(row.max_attempts),
    nextAttemptAt: readNullableIso(row.next_attempt_at),
    priority: readNonNegativeInteger(row.priority),
    errorMessage:
      typeof row.error_message === "string" && row.error_message.trim()
        ? row.error_message.trim()
        : null,
  };
}

function filterCandidatesByStatus(
  candidates: MintRetryCandidate[],
  onlyStatus: MintRetryStatus[] | null,
): MintRetryCandidate[] {
  if (!onlyStatus || onlyStatus.length === 0) {
    return candidates;
  }

  const allowed = new Set(onlyStatus);

  return candidates.filter((candidate) => allowed.has(candidate.status));
}

export function parseOnlyStatus(
  value: string | undefined,
): MintRetryStatus[] | null {
  const raw = value?.trim();

  if (!raw) {
    return null;
  }

  const statuses = raw
    .split(",")
    .map((item) => item.trim().toLowerCase())
    .filter(Boolean);

  if (statuses.length === 0) {
    return null;
  }

  for (const status of statuses) {
    if (!MINT_RETRY_STATUSES.includes(status as MintRetryStatus)) {
      throw new Error(
        `ONLY_STATUS must contain only ${MINT_RETRY_STATUSES.join(", ")}.`,
      );
    }
  }

  return [...new Set(statuses)] as MintRetryStatus[];
}

function parseLimit(value: string | undefined): number {
  const raw = value?.trim();

  if (!raw) {
    return DEFAULT_MINT_RETRY_LIMIT;
  }

  const parsed = Number.parseInt(raw, 10);

  if (!Number.isSafeInteger(parsed) || parsed <= 0) {
    throw new Error("MINT_RETRY_LIMIT or LIMIT must be a positive integer.");
  }

  return parsed;
}

function parseBoolean(
  value: string | undefined,
  defaultValue: boolean,
): boolean {
  const raw = value?.trim().toLowerCase();

  if (!raw) {
    return defaultValue;
  }

  if (["1", "true", "yes", "on"].includes(raw)) {
    return true;
  }

  if (["0", "false", "no", "off"].includes(raw)) {
    return false;
  }

  throw new Error("Boolean env value must be true or false.");
}

function readRequiredString(value: unknown, field: string): string {
  if (typeof value === "string" && value.trim().length > 0) {
    return value.trim();
  }

  throw new Error(`Mint retry candidate ${field} is required.`);
}

function readNonNegativeInteger(value: unknown): number {
  const parsed =
    typeof value === "number"
      ? value
      : typeof value === "string"
        ? Number.parseInt(value, 10)
        : Number.NaN;

  if (!Number.isSafeInteger(parsed) || parsed < 0) {
    throw new Error("Mint retry candidate integer field is invalid.");
  }

  return parsed;
}

function readNullableIso(value: unknown): string | null {
  if (value === null) {
    return null;
  }

  if (typeof value !== "string") {
    throw new Error("Mint retry candidate timestamp is invalid.");
  }

  const timestamp = Date.parse(value);

  if (!Number.isFinite(timestamp)) {
    throw new Error("Mint retry candidate timestamp is invalid.");
  }

  return new Date(timestamp).toISOString();
}

function normalizeError(error: unknown): { code: string; message: string } {
  const message = error instanceof Error ? error.message : String(error);

  return {
    code: "MINT_RETRY_FAILED",
    message,
  };
}

function getMintRetryOutputStatus(
  output: RetryFailedMintsOutput,
): "success" | "partial_failed" | "failed" {
  if (output.ok) {
    return "success";
  }

  return output.processed > output.failed ? "partial_failed" : "failed";
}

function toJsonObject(value: Record<string, unknown>): JsonObject {
  return JSON.parse(JSON.stringify(value)) as JsonObject;
}

function assertNoUnsupportedArgs(args: string[]): void {
  const unsupported = args.filter((arg) => arg !== "--help" && arg !== "-h");

  if (unsupported.length > 0) {
    throw new Error(`Unknown argument: ${unsupported[0]}`);
  }
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
    "Usage: pnpm ops:retry-mints",
    "",
    "Processes due onchain.mint_queue rows through the Mint worker.",
    `Set MINT_RETRY_LIMIT or LIMIT to control batch size. Default: ${DEFAULT_MINT_RETRY_LIMIT}.`,
    "Set MINT_RETRY_DRY_RUN=true or DRY_RUN=true to only print candidate queue rows.",
    "Set MINT_RETRY_ONLY_STATUS or ONLY_STATUS to queued,retrying filter candidates.",
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
    const startedAt = Date.now();
    const requestId = `script-retry-failed-mints-${startedAt}`;
    console.error(
      JSON.stringify(
        {
          job_name: "retry_mints",
          request_id: requestId,
          started_at: new Date(startedAt).toISOString(),
          finished_at: new Date().toISOString(),
          status: "failed",
          processed_count: 0,
          failed_count: 1,
          error_message: error instanceof Error ? error.message : String(error),
          ok: false,
          errors: [normalizeError(error)],
        },
        null,
        2,
      ),
    );
    process.exitCode = 1;
  });
}
