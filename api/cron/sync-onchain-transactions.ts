import {
  getSupabaseAdminClient,
  type SupabaseAdminClient,
} from "../../packages/server/src/db/supabaseAdmin.js";
import type { Json } from "../../packages/server/src/db/database.js";
import { callRpcRaw, RpcError } from "../../packages/server/src/db/rpc.js";
import { BackendOperationGuardError } from "../../packages/server/src/payments/paymentGuards.js";
import { assertMintWorkerEnabled } from "../../packages/server/src/ton/mintGuards.js";
import {
  buildMintRetryDecision,
  buildMintWorkerStatusMetadata,
  readMintRetryStrategy,
  type MintRetryStrategy,
} from "../../packages/server/src/ton/mintQueue.js";
import {
  createTonNftService,
  TonNftProviderError,
  type JsonRecord,
  type TonNftProviderAdapter,
  type TonNftTransactionQueryResult,
} from "../../packages/server/src/ton/nft.js";
import { assertCronRequest } from "../_shared/cron.js";
import { ApiError, withApiHandler } from "../_shared/handler.js";
import { recordMintRetryExceededRisk } from "../_shared/mintRiskEvents.js";

type OnchainTransactionRow = {
  id: string;
  network: string;
  tx_hash: string | null;
  query_id: string | null;
  user_id: string | null;
  wallet_id: string | null;
  related_type: string | null;
  related_id: string | null;
  status: string;
  payload: unknown;
  raw_response: unknown;
  external_api_provider: string | null;
  error_message: string | null;
  submitted_at: string | null;
  confirmed_at: string | null;
  last_checked_at: string | null;
  check_count: number | string;
  created_at: string;
};

type MintQueueRow = {
  id: string;
  user_id: string;
  wallet_id: string | null;
  collection_id: string;
  item_instance_id: string;
  template_id: string;
  form_id: string | null;
  status: string;
  attempt_count: number | string;
  max_attempts: number | string;
  tx_hash: string | null;
  error_message: string | null;
  metadata: unknown;
};

type NftCollectionRow = {
  id: string;
  network: string;
  collection_address: string;
};

type WalletRow = {
  id: string;
  address: string;
  address_raw: string | null;
};

type SyncResult = {
  scanned: number;
  checked: number;
  pending: number;
  confirmed: number;
  failed: number;
  expired: number;
  retrying: number;
  manualReview: number;
  skipped: number;
  errors: Array<{
    transactionId: string;
    code: string;
  }>;
  serverTime: string;
};

const TRANSACTION_COLUMNS = [
  "id",
  "network",
  "tx_hash",
  "query_id",
  "user_id",
  "wallet_id",
  "related_type",
  "related_id",
  "status",
  "payload",
  "raw_response",
  "external_api_provider",
  "error_message",
  "submitted_at",
  "confirmed_at",
  "last_checked_at",
  "check_count",
  "created_at",
].join(",");

const MINT_QUEUE_COLUMNS = [
  "id",
  "user_id",
  "wallet_id",
  "collection_id",
  "item_instance_id",
  "template_id",
  "form_id",
  "status",
  "attempt_count",
  "max_attempts",
  "tx_hash",
  "error_message",
  "metadata",
].join(",");

const COLLECTION_COLUMNS = ["id", "network", "collection_address"].join(",");
const WALLET_COLUMNS = ["id", "address", "address_raw"].join(",");
const DEFAULT_BATCH_SIZE = 20;
const MAX_BATCH_SIZE = 100;

export default withApiHandler(
  async (req, _res, ctx) => {
    assertCronRequest(req);

    const db = getSupabaseAdminClient();
    const provider = createTonNftService();

    try {
      await assertMintWorkerEnabled({
        client: db,
      });

      return await runOnchainTransactionSync({
        db,
        provider,
        requestId: ctx.requestId,
        env: process.env,
      });
    } catch (error) {
      throw mapSyncError(error);
    }
  },
  {
    methods: ["GET", "POST"],
    rateLimit: {
      action: "cron.job",
    },
  },
);

export async function runOnchainTransactionSync(input: {
  db: SupabaseAdminClient;
  provider: TonNftProviderAdapter;
  requestId: string;
  env?: NodeJS.ProcessEnv | undefined;
  now?: Date | undefined;
}): Promise<SyncResult> {
  const env = input.env ?? process.env;
  const now = input.now ?? new Date();
  const strategy = readMintRetryStrategy(env);
  const rows = await listMintTransactionsToSync(
    input.db,
    readBatchSize(env, "TON_TX_SYNC_BATCH_SIZE", DEFAULT_BATCH_SIZE),
  );
  const result: SyncResult = {
    scanned: rows.length,
    checked: 0,
    pending: 0,
    confirmed: 0,
    failed: 0,
    expired: 0,
    retrying: 0,
    manualReview: 0,
    skipped: 0,
    errors: [],
    serverTime: now.toISOString(),
  };

  for (const transaction of rows) {
    try {
      const context = await loadMintTransactionContext(input.db, transaction);

      if (!context) {
        result.skipped += 1;
        continue;
      }

      if (
        transaction.status === "confirmed" &&
        context.queue.status === "minted"
      ) {
        result.skipped += 1;
        continue;
      }

      const queryResult = await input.provider.queryTransaction({
        requestId: input.requestId,
        transactionId: transaction.id,
        txHash: transaction.tx_hash,
        queryId: transaction.query_id,
        network: normalizeNetwork(transaction.network),
        collectionAddress: context.collection.collection_address,
        relatedId: transaction.related_id,
        rawPayload: toRecord(transaction.payload),
      });

      result.checked += 1;
      await updateTransactionFromProvider(input.db, transaction, queryResult);

      if (queryResult.status === "pending") {
        await markQueueConfirming(input.db, context.queue, {
          requestId: input.requestId,
          txHash: queryResult.txHash ?? transaction.tx_hash,
          queryId: queryResult.queryId ?? transaction.query_id,
          provider: queryResult.externalApiProvider,
          now,
        });
        result.pending += 1;
        continue;
      }

      if (queryResult.status === "confirmed") {
        const outcome = await markMintSuccess(
          input.db,
          context,
          transaction,
          queryResult,
          input.requestId,
        );

        if (outcome === "manual_review") {
          result.manualReview += 1;
        } else {
          result.confirmed += 1;
        }
        continue;
      }

      const decision = await moveQueueToRetryOrReview(input.db, context.queue, {
        error: new TonNftProviderError(
          `TON_NFT_TRANSACTION_${queryResult.status.toUpperCase()}`,
          queryResult.errorMessage ?? `Mint transaction ${queryResult.status}.`,
          {
            retryable: queryResult.status !== "expired",
            rawResponse: queryResult.rawResponse,
          },
        ),
        requestId: input.requestId,
        strategy,
        now,
        txHash: queryResult.txHash ?? transaction.tx_hash,
        provider: queryResult.externalApiProvider,
      });

      result[queryResult.status] += 1;
      result[decision.status === "retrying" ? "retrying" : "manualReview"] += 1;
    } catch (error) {
      await recordTransactionCheckError(input.db, transaction, {
        error,
        requestId: input.requestId,
      });
      result.errors.push({
        transactionId: transaction.id,
        code: getSyncErrorCode(error),
      });
    }
  }

  return result;
}

async function listMintTransactionsToSync(
  db: SupabaseAdminClient,
  limit: number,
): Promise<OnchainTransactionRow[]> {
  const { data, error } = await db
    .schema("onchain")
    .from("transactions")
    .select(TRANSACTION_COLUMNS)
    .eq("related_type", "mint_queue")
    .in("status", ["pending", "confirmed"])
    .order("last_checked_at", { ascending: true, nullsFirst: true })
    .order("created_at", { ascending: true })
    .limit(limit);

  if (error) {
    throw new ApiError(
      500,
      "ONCHAIN_TRANSACTION_LOOKUP_FAILED",
      "查询待同步链上交易失败。",
      {
        expose: false,
        cause: error,
      },
    );
  }

  return Array.isArray(data)
    ? (data as unknown as OnchainTransactionRow[])
    : [];
}

async function loadMintTransactionContext(
  db: SupabaseAdminClient,
  transaction: OnchainTransactionRow,
): Promise<{
  queue: MintQueueRow;
  collection: NftCollectionRow;
  wallet: WalletRow | null;
} | null> {
  if (!transaction.related_id) {
    return null;
  }

  const queue = await fetchMintQueue(db, transaction.related_id);

  if (!queue) {
    return null;
  }

  const [collection, wallet] = await Promise.all([
    fetchCollection(db, queue.collection_id),
    queue.wallet_id ? fetchWallet(db, queue.wallet_id) : Promise.resolve(null),
  ]);

  return {
    queue,
    collection,
    wallet,
  };
}

async function fetchMintQueue(
  db: SupabaseAdminClient,
  mintQueueId: string,
): Promise<MintQueueRow | null> {
  const { data, error } = await db
    .schema("onchain")
    .from("mint_queue")
    .select(MINT_QUEUE_COLUMNS)
    .eq("id", mintQueueId)
    .maybeSingle();

  if (error) {
    throw new ApiError(
      500,
      "MINT_QUEUE_LOOKUP_FAILED",
      "查询 Mint 队列失败。",
      {
        expose: false,
        cause: error,
      },
    );
  }

  return data ? (data as unknown as MintQueueRow) : null;
}

async function fetchCollection(
  db: SupabaseAdminClient,
  collectionId: string,
): Promise<NftCollectionRow> {
  const { data, error } = await db
    .schema("onchain")
    .from("nft_collections")
    .select(COLLECTION_COLUMNS)
    .eq("id", collectionId)
    .maybeSingle();

  if (error || !data) {
    throw new ApiError(
      500,
      "MINT_COLLECTION_LOOKUP_FAILED",
      "查询 Mint Collection 失败。",
      {
        expose: false,
        cause: error,
      },
    );
  }

  return data as unknown as NftCollectionRow;
}

async function fetchWallet(
  db: SupabaseAdminClient,
  walletId: string,
): Promise<WalletRow | null> {
  const { data, error } = await db
    .schema("core")
    .from("user_wallets")
    .select(WALLET_COLUMNS)
    .eq("id", walletId)
    .maybeSingle();

  if (error) {
    throw new ApiError(500, "MINT_WALLET_LOOKUP_FAILED", "查询钱包失败。", {
      expose: false,
      cause: error,
    });
  }

  return data ? (data as unknown as WalletRow) : null;
}

async function updateTransactionFromProvider(
  db: SupabaseAdminClient,
  transaction: OnchainTransactionRow,
  result: TonNftTransactionQueryResult,
): Promise<void> {
  const { error } = await db
    .schema("onchain")
    .from("transactions")
    .update({
      tx_hash: result.txHash ?? transaction.tx_hash,
      query_id: result.queryId ?? transaction.query_id,
      status: toTransactionStatus(result.status),
      error_message: result.errorMessage,
      confirmed_at:
        result.status === "confirmed"
          ? result.checkedAt
          : transaction.confirmed_at,
      external_api_provider: result.externalApiProvider,
      last_checked_at: result.checkedAt,
      check_count: readInteger(transaction.check_count, 0) + 1,
      raw_response: asDbJson(result.rawResponse),
      updated_at: new Date().toISOString(),
    })
    .eq("id", transaction.id);

  if (error) {
    throw new ApiError(
      500,
      "ONCHAIN_TRANSACTION_UPDATE_FAILED",
      "更新链上交易状态失败。",
      {
        expose: false,
        cause: error,
      },
    );
  }
}

async function markQueueConfirming(
  db: SupabaseAdminClient,
  queue: MintQueueRow,
  input: {
    requestId: string;
    txHash: string | null;
    queryId: string | null;
    provider: string;
    now: Date;
  },
): Promise<void> {
  const { error } = await db
    .schema("onchain")
    .from("mint_queue")
    .update({
      status: "confirming",
      tx_hash: input.txHash,
      error_message: null,
      next_attempt_at: null,
      metadata: mergeMintWorkerMetadata(queue.metadata, {
        request_id: input.requestId,
        synced_at: input.now.toISOString(),
        query_id: input.queryId,
        external_api_provider: input.provider,
      }) as Json,
      updated_at: input.now.toISOString(),
    })
    .eq("id", queue.id)
    .in("status", ["submitted", "confirming", "processing"]);

  if (error) {
    throw new ApiError(
      500,
      "MINT_QUEUE_UPDATE_FAILED",
      "更新 Mint 队列失败。",
      {
        expose: false,
        cause: error,
      },
    );
  }
}

async function markMintSuccess(
  db: SupabaseAdminClient,
  context: {
    queue: MintQueueRow;
    wallet: WalletRow | null;
  },
  transaction: OnchainTransactionRow,
  result: TonNftTransactionQueryResult,
  requestId: string,
): Promise<"minted" | "manual_review"> {
  const txHash = result.txHash ?? transaction.tx_hash;
  const ownerAddress =
    result.ownerAddress ??
    context.wallet?.address ??
    context.wallet?.address_raw ??
    null;

  if (
    !txHash ||
    !ownerAddress ||
    !result.itemAddress ||
    result.itemIndex === null
  ) {
    await moveQueueToManualReview(db, context.queue, {
      requestId,
      errorReason: "TON_NFT_CONFIRMED_RESULT_INCOMPLETE",
      errorMessage:
        "Confirmed transaction did not include tx hash, owner address, NFT item address or item index.",
      txHash,
      provider: result.externalApiProvider,
    });
    return "manual_review";
  }

  await callRpcRaw(
    "onchain_mark_mint_success",
    {
      p_mint_queue_id: context.queue.id,
      p_item_address: result.itemAddress,
      p_item_index: result.itemIndex,
      p_owner_address: ownerAddress,
      p_tx_hash: txHash,
      p_metadata_url: result.metadataUrl,
    },
    {
      schema: "api" as never,
      client: db,
      context: {
        mintQueueId: context.queue.id,
        transactionId: transaction.id,
      },
    },
  );

  return "minted";
}

async function moveQueueToRetryOrReview(
  db: SupabaseAdminClient,
  queue: MintQueueRow,
  input: {
    error: unknown;
    requestId: string;
    strategy: MintRetryStrategy;
    now: Date;
    txHash: string | null;
    provider: string;
  },
): Promise<{
  status: "retrying" | "manual_review";
}> {
  const retryable = isRetryableSyncError(input.error);
  const decision = retryable
    ? buildMintRetryDecision({
        attemptCount: readInteger(queue.attempt_count, 1),
        maxAttempts: readInteger(
          queue.max_attempts,
          input.strategy.maxAttempts,
        ),
        now: input.now,
        strategy: input.strategy,
      })
    : {
        status: "manual_review" as const,
        nextAttemptAt: null,
        attemptCount: readInteger(queue.attempt_count, 1),
        maxAttempts: readInteger(
          queue.max_attempts,
          input.strategy.maxAttempts,
        ),
      };
  const errorMessage = getSyncErrorMessage(input.error);
  const { error } = await db
    .schema("onchain")
    .from("mint_queue")
    .update({
      status: decision.status,
      tx_hash: input.txHash,
      error_message: errorMessage,
      next_attempt_at: decision.nextAttemptAt?.toISOString() ?? null,
      metadata: mergeMintWorkerMetadata(queue.metadata, {
        ...buildMintWorkerStatusMetadata({
          requestId: input.requestId,
          source: "cron.sync_onchain_transactions",
          errorReason: getSyncErrorCode(input.error),
          errorMessage,
          txHash: input.txHash ?? undefined,
          externalApiProvider: input.provider,
        }),
        retry_attempt_count: decision.attemptCount,
        retry_max_attempts: decision.maxAttempts,
      }) as Json,
      updated_at: input.now.toISOString(),
    })
    .eq("id", queue.id);

  if (error) {
    throw new ApiError(
      500,
      "MINT_QUEUE_UPDATE_FAILED",
      "更新 Mint 队列失败。",
      {
        expose: false,
        cause: error,
      },
    );
  }

  if (decision.status === "manual_review") {
    await recordMintRetryExceededRisk({
      userId: queue.user_id,
      mintQueueId: queue.id,
      itemInstanceId: queue.item_instance_id,
      walletId: queue.wallet_id,
      requestId: input.requestId,
      action: "cron.sync_onchain_transactions",
      status: "manual_review",
      attemptCount: decision.attemptCount,
      maxAttempts: decision.maxAttempts,
      errorCode: getSyncErrorCode(input.error),
      errorMessage,
      retryable,
      txHash: input.txHash,
      provider: input.provider,
    });
  }

  return {
    status: decision.status,
  };
}

async function moveQueueToManualReview(
  db: SupabaseAdminClient,
  queue: MintQueueRow,
  input: {
    requestId: string;
    errorReason: string;
    errorMessage: string;
    txHash: string | null;
    provider: string;
  },
): Promise<void> {
  const { error } = await db
    .schema("onchain")
    .from("mint_queue")
    .update({
      status: "manual_review",
      tx_hash: input.txHash,
      error_message: input.errorMessage,
      next_attempt_at: null,
      metadata: mergeMintWorkerMetadata(queue.metadata, {
        ...buildMintWorkerStatusMetadata({
          requestId: input.requestId,
          source: "cron.sync_onchain_transactions",
          errorReason: input.errorReason,
          errorMessage: input.errorMessage,
          txHash: input.txHash ?? undefined,
          externalApiProvider: input.provider,
        }),
      }) as Json,
      updated_at: new Date().toISOString(),
    })
    .eq("id", queue.id);

  if (error) {
    throw new ApiError(
      500,
      "MINT_QUEUE_UPDATE_FAILED",
      "更新 Mint 队列失败。",
      {
        expose: false,
        cause: error,
      },
    );
  }

  await recordMintRetryExceededRisk({
    userId: queue.user_id,
    mintQueueId: queue.id,
    itemInstanceId: queue.item_instance_id,
    walletId: queue.wallet_id,
    requestId: input.requestId,
    action: "cron.sync_onchain_transactions",
    status: "manual_review",
    attemptCount: readInteger(queue.attempt_count, 1),
    maxAttempts: readInteger(queue.max_attempts, 1),
    errorCode: input.errorReason,
    errorMessage: input.errorMessage,
    retryable: false,
    txHash: input.txHash,
    provider: input.provider,
  });
}

async function recordTransactionCheckError(
  db: SupabaseAdminClient,
  transaction: OnchainTransactionRow,
  input: {
    error: unknown;
    requestId: string;
  },
): Promise<void> {
  const errorMessage = getSyncErrorMessage(input.error);
  const { error } = await db
    .schema("onchain")
    .from("transactions")
    .update({
      error_message: errorMessage,
      last_checked_at: new Date().toISOString(),
      check_count: readInteger(transaction.check_count, 0) + 1,
      raw_response: asDbJson({
        request_id: input.requestId,
        error_code: getSyncErrorCode(input.error),
        error_message: errorMessage,
      }),
      updated_at: new Date().toISOString(),
    })
    .eq("id", transaction.id);

  if (error) {
    throw new ApiError(
      500,
      "ONCHAIN_TRANSACTION_CHECK_ERROR_SAVE_FAILED",
      "保存链上交易查询错误失败。",
      {
        expose: false,
        cause: error,
      },
    );
  }
}

function toTransactionStatus(
  status: TonNftTransactionQueryResult["status"],
): "pending" | "confirmed" | "failed" | "expired" {
  return status;
}

function mapSyncError(error: unknown): ApiError {
  if (error instanceof ApiError) {
    return error;
  }

  if (error instanceof BackendOperationGuardError) {
    return new ApiError(error.statusCode, error.code, error.message, {
      expose: error.expose,
      details: error.details,
    });
  }

  if (error instanceof RpcError) {
    return new ApiError(500, "ONCHAIN_SYNC_RPC_FAILED", "链上同步 RPC 失败。", {
      expose: false,
      cause: error,
    });
  }

  return ApiError.internal("链上交易同步失败。", {
    cause: getSyncErrorMessage(error),
  });
}

function getSyncErrorCode(error: unknown): string {
  if (error instanceof TonNftProviderError) {
    return error.code;
  }

  if (error instanceof ApiError) {
    return error.code;
  }

  if (error instanceof RpcError) {
    return "ONCHAIN_SYNC_RPC_FAILED";
  }

  if (error instanceof Error) {
    return error.name || "ONCHAIN_SYNC_ERROR";
  }

  return "ONCHAIN_SYNC_ERROR";
}

function getSyncErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }

  return String(error);
}

function isRetryableSyncError(error: unknown): boolean {
  if (error instanceof TonNftProviderError) {
    return error.retryable;
  }

  if (error instanceof ApiError) {
    return error.statusCode >= 500;
  }

  return !(error instanceof BackendOperationGuardError);
}

function normalizeNetwork(value: unknown): "mainnet" | "testnet" {
  return String(value ?? "mainnet").toLowerCase() === "testnet"
    ? "testnet"
    : "mainnet";
}

function mergeMintWorkerMetadata(
  current: unknown,
  workerPatch: JsonRecord,
): JsonRecord {
  const currentRecord = toRecord(current);
  const currentWorker = toRecord(currentRecord.mint_worker);

  return {
    ...currentRecord,
    mint_worker: {
      ...currentWorker,
      ...workerPatch,
    },
  };
}

function readBatchSize(
  env: NodeJS.ProcessEnv,
  name: string,
  fallback: number,
): number {
  const value = Number.parseInt(env[name] ?? "", 10);

  if (!Number.isFinite(value) || value <= 0) {
    return fallback;
  }

  return Math.min(value, MAX_BATCH_SIZE);
}

function readInteger(value: unknown, fallback: number): number {
  const numberValue =
    typeof value === "number"
      ? value
      : typeof value === "string"
        ? Number.parseInt(value, 10)
        : NaN;

  return Number.isFinite(numberValue) ? Math.trunc(numberValue) : fallback;
}

function asDbJson(value: unknown): Json {
  return value as Json;
}

function toRecord(value: unknown): JsonRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as JsonRecord)
    : {};
}
