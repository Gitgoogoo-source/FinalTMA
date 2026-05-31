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
  buildMintQueryId,
  createTonNftService,
  TonNftProviderError,
  type JsonRecord,
  type TonNftCollectionContext,
  type TonNftProviderAdapter,
  type TonNftSubmitMintResult,
  type TonNftWalletContext,
} from "../../packages/server/src/ton/nft.js";
import { assertCronRequest } from "../_shared/cron.js";
import { ApiError, withApiHandler } from "../_shared/handler.js";
import { recordMintRetryExceededRisk } from "../_shared/mintRiskEvents.js";

type MintQueueRow = {
  id: string;
  user_id: string;
  wallet_id: string | null;
  collection_id: string;
  item_instance_id: string;
  template_id: string;
  form_id: string | null;
  status: string;
  priority: number | string | null;
  attempt_count: number | string;
  max_attempts: number | string;
  next_attempt_at: string | null;
  nft_item_id: string | null;
  tx_hash: string | null;
  error_message: string | null;
  idempotency_key: string;
  metadata: unknown;
  created_at: string;
  updated_at: string;
  completed_at: string | null;
};

type NftCollectionRow = {
  id: string;
  network: string;
  collection_address: string;
  owner_address: string | null;
  metadata_url: string | null;
  content_base_url: string | null;
  contract_version: string | null;
  metadata: unknown;
};

type WalletRow = {
  id: string;
  address: string;
  address_raw: string | null;
  network: string;
};

type MintWorkerResult = {
  scanned: number;
  claimed: number;
  submitted: number;
  confirming: number;
  minted: number;
  retrying: number;
  manualReview: number;
  skipped: number;
  errors: Array<{
    mintQueueId: string;
    code: string;
  }>;
  serverTime: string;
};

type MintExecutionContext = {
  queue: MintQueueRow;
  collection: NftCollectionRow;
  wallet: WalletRow;
  metadata: JsonRecord;
  metadataUrl: string | null;
};

type TransactionStatus = "pending" | "confirmed" | "failed" | "expired";

type ExistingMintTransactionRow = {
  id: string;
  related_type: string | null;
  related_id: string | null;
  tx_hash: string | null;
  query_id: string | null;
};

const MINT_QUEUE_COLUMNS = [
  "id",
  "user_id",
  "wallet_id",
  "collection_id",
  "item_instance_id",
  "template_id",
  "form_id",
  "status",
  "priority",
  "attempt_count",
  "max_attempts",
  "next_attempt_at",
  "nft_item_id",
  "tx_hash",
  "error_message",
  "idempotency_key",
  "metadata",
  "created_at",
  "updated_at",
  "completed_at",
].join(",");

const COLLECTION_COLUMNS = [
  "id",
  "network",
  "collection_address",
  "owner_address",
  "metadata_url",
  "content_base_url",
  "contract_version",
  "metadata",
].join(",");

const WALLET_COLUMNS = ["id", "address", "address_raw", "network"].join(",");
const DEFAULT_BATCH_SIZE = 10;
const MAX_BATCH_SIZE = 50;

export default withApiHandler(
  async (req, _res, ctx) => {
    assertCronRequest(req);

    const db = getSupabaseAdminClient();
    const provider = createTonNftService();

    try {
      await assertMintWorkerEnabled({
        client: db,
      });

      return await runMintQueueWorker({
        db,
        provider,
        requestId: ctx.requestId,
        env: process.env,
      });
    } catch (error) {
      throw mapMintWorkerError(error);
    }
  },
  {
    methods: ["GET", "POST"],
    rateLimit: {
      action: "cron.job",
    },
  },
);

export async function runMintQueueWorker(input: {
  db: SupabaseAdminClient;
  provider: TonNftProviderAdapter;
  requestId: string;
  env?: NodeJS.ProcessEnv | undefined;
  now?: Date | undefined;
}): Promise<MintWorkerResult> {
  const env = input.env ?? process.env;
  const now = input.now ?? new Date();
  const strategy = readMintRetryStrategy(env);
  const rows = await listDueMintQueueRows(
    input.db,
    now,
    readBatchSize(env, "TON_MINT_BATCH_SIZE", DEFAULT_BATCH_SIZE),
  );
  const result: MintWorkerResult = {
    scanned: rows.length,
    claimed: 0,
    submitted: 0,
    confirming: 0,
    minted: 0,
    retrying: 0,
    manualReview: 0,
    skipped: 0,
    errors: [],
    serverTime: now.toISOString(),
  };

  for (const row of rows) {
    const claimed = await claimMintQueueRow(input.db, row, {
      now,
      requestId: input.requestId,
    });

    if (!claimed) {
      result.skipped += 1;
      continue;
    }

    result.claimed += 1;

    try {
      const context = await loadMintExecutionContext(input.db, claimed);
      const recovery = await recoverPossiblySubmittedMint({
        db: input.db,
        provider: input.provider,
        requestId: input.requestId,
        context,
        strategy,
        now,
      });

      if (recovery) {
        incrementResult(result, recovery);
        continue;
      }

      const queryId =
        readWorkerQueryId(claimed) ??
        buildMintQueryId({
          mintQueueId: claimed.id,
          attemptCount: readInteger(claimed.attempt_count, 1),
        });
      const submitResult = await input.provider.submitMint({
        requestId: input.requestId,
        queryId,
        queue: toMintQueueContext(claimed),
        collection: toCollectionContext(context.collection),
        wallet: toWalletContext(context.wallet),
        metadataUrl: context.metadataUrl,
        metadata: context.metadata,
      });

      await upsertMintTransaction(input.db, context, {
        status: submitResult.status === "minted" ? "confirmed" : "pending",
        txHash: submitResult.txHash,
        queryId: submitResult.queryId ?? queryId,
        externalApiProvider: submitResult.externalApiProvider,
        rawResponse: submitResult.rawResponse,
        submittedAt: submitResult.submittedAt ?? now.toISOString(),
        confirmedAt:
          submitResult.status === "minted" ? now.toISOString() : null,
        errorMessage: null,
      });

      if (submitResult.status === "minted") {
        await markMintSuccess(input.db, context, submitResult);
        result.minted += 1;
      } else {
        const queueStatus =
          submitResult.status === "confirming" ? "confirming" : "submitted";
        await updateMintQueueAfterSubmit(input.db, claimed, submitResult, {
          requestId: input.requestId,
          queryId,
          status: queueStatus,
          now,
        });
        result[queueStatus] += 1;
      }
    } catch (error) {
      const recovery = await moveMintQueueToRetryOrReview(input.db, claimed, {
        error,
        requestId: input.requestId,
        strategy,
        now,
      });

      result[recovery.status === "retrying" ? "retrying" : "manualReview"] += 1;
      result.errors.push({
        mintQueueId: claimed.id,
        code: getMintWorkerErrorCode(error),
      });
    }
  }

  return result;
}

async function listDueMintQueueRows(
  db: SupabaseAdminClient,
  now: Date,
  limit: number,
): Promise<MintQueueRow[]> {
  const nowIso = now.toISOString();
  const { data, error } = await db
    .schema("onchain")
    .from("mint_queue")
    .select(MINT_QUEUE_COLUMNS)
    .in("status", ["queued", "retrying"])
    .or(`next_attempt_at.is.null,next_attempt_at.lte.${nowIso}`)
    .order("priority", { ascending: true })
    .order("created_at", { ascending: true })
    .limit(limit);

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

  return Array.isArray(data) ? (data as unknown as MintQueueRow[]) : [];
}

async function claimMintQueueRow(
  db: SupabaseAdminClient,
  row: MintQueueRow,
  input: {
    now: Date;
    requestId: string;
  },
): Promise<MintQueueRow | null> {
  const attemptCount = readInteger(row.attempt_count, 0) + 1;
  const queryId = readClaimQueryId(row, attemptCount);
  const nowIso = input.now.toISOString();
  const { data, error } = await db
    .schema("onchain")
    .from("mint_queue")
    .update({
      status: "processing",
      attempt_count: attemptCount,
      next_attempt_at: null,
      error_message: null,
      metadata: mergeMintWorkerMetadata(row.metadata, {
        request_id: input.requestId,
        claimed_at: nowIso,
        query_id: queryId,
        attempt_count: attemptCount,
      }) as Json,
      updated_at: nowIso,
    })
    .eq("id", row.id)
    .in("status", ["queued", "retrying"])
    .or(`next_attempt_at.is.null,next_attempt_at.lte.${nowIso}`)
    .select(MINT_QUEUE_COLUMNS)
    .maybeSingle();

  if (error) {
    throw new ApiError(500, "MINT_QUEUE_CLAIM_FAILED", "领取 Mint 任务失败。", {
      expose: false,
      cause: error,
    });
  }

  return data ? (data as unknown as MintQueueRow) : null;
}

async function loadMintExecutionContext(
  db: SupabaseAdminClient,
  queue: MintQueueRow,
): Promise<MintExecutionContext> {
  if (!queue.wallet_id) {
    throw new TonNftProviderError(
      "MINT_QUEUE_WALLET_MISSING",
      "Mint queue is missing wallet_id.",
      {
        retryable: false,
      },
    );
  }

  const [collection, wallet] = await Promise.all([
    fetchNftCollection(db, queue.collection_id),
    fetchWallet(db, queue.wallet_id),
  ]);
  const metadata = readMetadataSnapshot(queue.metadata);

  return {
    queue,
    collection,
    wallet,
    metadata,
    metadataUrl: readMetadataUrl(queue.metadata),
  };
}

async function fetchNftCollection(
  db: SupabaseAdminClient,
  collectionId: string,
): Promise<NftCollectionRow> {
  const { data, error } = await db
    .schema("onchain")
    .from("nft_collections")
    .select(COLLECTION_COLUMNS)
    .eq("id", collectionId)
    .maybeSingle();

  if (error) {
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

  if (!data) {
    throw new TonNftProviderError(
      "MINT_COLLECTION_NOT_FOUND",
      "Mint collection not found.",
      {
        retryable: false,
      },
    );
  }

  return data as unknown as NftCollectionRow;
}

async function fetchWallet(
  db: SupabaseAdminClient,
  walletId: string,
): Promise<WalletRow> {
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

  if (!data) {
    throw new TonNftProviderError(
      "MINT_WALLET_NOT_FOUND",
      "Wallet not found.",
      {
        retryable: false,
      },
    );
  }

  return data as unknown as WalletRow;
}

async function recoverPossiblySubmittedMint(input: {
  db: SupabaseAdminClient;
  provider: TonNftProviderAdapter;
  requestId: string;
  context: MintExecutionContext;
  strategy: MintRetryStrategy;
  now: Date;
}): Promise<"confirming" | "minted" | "retrying" | "manualReview" | null> {
  const queryId = readWorkerQueryId(input.context.queue);
  const possibleSubmission = readPossibleSubmission(input.context.queue);

  if (!possibleSubmission || !queryId) {
    return null;
  }

  try {
    const queryResult = await input.provider.queryTransaction({
      requestId: input.requestId,
      queryId,
      txHash: input.context.queue.tx_hash,
      network: normalizeNetwork(input.context.collection.network),
      collectionAddress: input.context.collection.collection_address,
      relatedId: input.context.queue.id,
    });

    await upsertMintTransaction(input.db, input.context, {
      status: queryResult.status === "confirmed" ? "confirmed" : "pending",
      txHash: queryResult.txHash,
      queryId: queryResult.queryId ?? queryId,
      externalApiProvider: queryResult.externalApiProvider,
      rawResponse: queryResult.rawResponse,
      submittedAt: null,
      confirmedAt:
        queryResult.status === "confirmed" ? input.now.toISOString() : null,
      errorMessage: queryResult.errorMessage,
    });

    if (queryResult.status === "confirmed") {
      await markMintSuccess(input.db, input.context, {
        txHash: queryResult.txHash,
        itemAddress: queryResult.itemAddress,
        itemIndex: queryResult.itemIndex,
        ownerAddress: queryResult.ownerAddress,
        metadataUrl: queryResult.metadataUrl,
        rawResponse: queryResult.rawResponse,
      });
      return "minted";
    }

    if (queryResult.status === "pending") {
      await updateMintQueueStatus(input.db, input.context.queue, {
        status: "confirming",
        txHash: queryResult.txHash ?? input.context.queue.tx_hash,
        errorMessage: null,
        nextAttemptAt: null,
        metadata: {
          request_id: input.requestId,
          recovery_checked_at: input.now.toISOString(),
          query_id: queryId,
          possible_submission: false,
        },
      });
      return "confirming";
    }

    return await moveMintQueueToRetryOrReview(input.db, input.context.queue, {
      error: new TonNftProviderError(
        `TON_NFT_TRANSACTION_${queryResult.status.toUpperCase()}`,
        queryResult.errorMessage ?? `Mint transaction ${queryResult.status}.`,
        {
          retryable: queryResult.status !== "expired",
          rawResponse: queryResult.rawResponse,
        },
      ),
      requestId: input.requestId,
      strategy: input.strategy,
      now: input.now,
    }).then((decision) =>
      decision.status === "retrying" ? "retrying" : "manualReview",
    );
  } catch (error) {
    return await moveMintQueueToRetryOrReview(input.db, input.context.queue, {
      error,
      requestId: input.requestId,
      strategy: input.strategy,
      now: input.now,
      forceNoSubmit: true,
    }).then((decision) =>
      decision.status === "retrying" ? "retrying" : "manualReview",
    );
  }
}

async function upsertMintTransaction(
  db: SupabaseAdminClient,
  context: MintExecutionContext,
  input: {
    status: TransactionStatus;
    txHash: string | null;
    queryId: string | null;
    externalApiProvider: string;
    rawResponse: JsonRecord;
    submittedAt: string | null;
    confirmedAt: string | null;
    errorMessage: string | null;
  },
): Promise<void> {
  const now = new Date().toISOString();
  const row = {
    chain: "TON",
    network: normalizeNetwork(context.collection.network),
    tx_hash: input.txHash,
    query_id: input.queryId,
    user_id: context.queue.user_id,
    wallet_id: context.queue.wallet_id,
    related_type: "mint_queue",
    related_id: context.queue.id,
    direction: "outbound",
    status: input.status,
    payload: asDbJson({
      mint_queue_id: context.queue.id,
      item_instance_id: context.queue.item_instance_id,
      metadata_url: context.metadataUrl,
      query_id: input.queryId,
    }),
    error_message: input.errorMessage,
    submitted_at: input.submittedAt,
    confirmed_at: input.confirmedAt,
    transaction_type: "mint",
    external_api_provider: input.externalApiProvider,
    last_checked_at: input.status === "pending" ? null : now,
    raw_response: asDbJson(input.rawResponse),
    updated_at: now,
  };

  const existingByHash = input.txHash
    ? await findExistingMintTransactionByTxHash(db, input.txHash)
    : null;

  if (
    existingByHash &&
    (existingByHash.related_type !== "mint_queue" ||
      existingByHash.related_id !== context.queue.id)
  ) {
    throw new TonNftProviderError(
      "ONCHAIN_TRANSACTION_HASH_CONFLICT",
      "Transaction hash is already linked to another operation.",
      {
        retryable: false,
        rawResponse: {
          tx_hash: input.txHash,
          existing_related_type: existingByHash.related_type,
          existing_related_id: existingByHash.related_id,
          mint_queue_id: context.queue.id,
        },
      },
    );
  }

  const existingId =
    existingByHash?.id ??
    (await findExistingMintTransactionId(db, {
      mintQueueId: context.queue.id,
      txHash: input.txHash,
      queryId: input.queryId,
    }));

  if (existingId) {
    const { error } = await db
      .schema("onchain")
      .from("transactions")
      .update(row)
      .eq("id", existingId);

    if (error) {
      throw new ApiError(
        500,
        "ONCHAIN_TRANSACTION_UPDATE_FAILED",
        "更新链上交易失败。",
        {
          expose: false,
          cause: error,
        },
      );
    }

    return;
  }

  const query = db.schema("onchain").from("transactions");
  const { error } = input.txHash
    ? await query.upsert(row, {
        onConflict: "tx_hash",
      })
    : await query.insert(row);

  if (error) {
    throw new ApiError(
      500,
      "ONCHAIN_TRANSACTION_SAVE_FAILED",
      "保存链上交易失败。",
      {
        expose: false,
        cause: error,
      },
    );
  }
}

async function findExistingMintTransactionByTxHash(
  db: SupabaseAdminClient,
  txHash: string,
): Promise<ExistingMintTransactionRow | null> {
  const { data, error } = await db
    .schema("onchain")
    .from("transactions")
    .select("id,related_type,related_id,tx_hash,query_id")
    .eq("tx_hash", txHash)
    .maybeSingle();

  if (error) {
    throw new ApiError(
      500,
      "ONCHAIN_TRANSACTION_LOOKUP_FAILED",
      "查询链上交易失败。",
      {
        expose: false,
        cause: error,
      },
    );
  }

  return data ? (data as unknown as ExistingMintTransactionRow) : null;
}

async function findExistingMintTransactionId(
  db: SupabaseAdminClient,
  input: {
    mintQueueId: string;
    txHash: string | null;
    queryId: string | null;
  },
): Promise<string | null> {
  let query = db
    .schema("onchain")
    .from("transactions")
    .select("id")
    .eq("related_type", "mint_queue")
    .eq("related_id", input.mintQueueId);

  if (input.txHash) {
    query = query.eq("tx_hash", input.txHash);
  } else if (input.queryId) {
    query = query.eq("query_id", input.queryId);
  } else {
    return null;
  }

  const { data, error } = await query.maybeSingle();

  if (error) {
    throw new ApiError(
      500,
      "ONCHAIN_TRANSACTION_LOOKUP_FAILED",
      "查询链上交易失败。",
      {
        expose: false,
        cause: error,
      },
    );
  }

  return readString((data as { id?: unknown } | null)?.id);
}

async function updateMintQueueAfterSubmit(
  db: SupabaseAdminClient,
  queue: MintQueueRow,
  submitResult: TonNftSubmitMintResult,
  input: {
    requestId: string;
    queryId: string;
    status: "submitted" | "confirming";
    now: Date;
  },
): Promise<void> {
  await updateMintQueueStatus(db, queue, {
    status: input.status,
    txHash: submitResult.txHash ?? queue.tx_hash,
    errorMessage: null,
    nextAttemptAt: null,
    metadata: {
      request_id: input.requestId,
      submitted_at: input.now.toISOString(),
      query_id: submitResult.queryId ?? input.queryId,
      external_api_provider: submitResult.externalApiProvider,
      possible_submission: false,
      raw_response: submitResult.rawResponse,
    },
  });
}

async function markMintSuccess(
  db: SupabaseAdminClient,
  context: MintExecutionContext,
  result: Pick<
    TonNftSubmitMintResult,
    | "txHash"
    | "itemAddress"
    | "itemIndex"
    | "ownerAddress"
    | "metadataUrl"
    | "rawResponse"
  >,
): Promise<void> {
  if (!result.txHash || !result.itemAddress || result.itemIndex === null) {
    throw new TonNftProviderError(
      "TON_NFT_SUCCESS_RESULT_INCOMPLETE",
      "Confirmed Mint result is missing tx_hash, item_address or item_index.",
      {
        retryable: false,
        rawResponse: result.rawResponse,
      },
    );
  }

  await callRpcRaw(
    "onchain_mark_mint_success",
    {
      p_mint_queue_id: context.queue.id,
      p_item_address: result.itemAddress,
      p_item_index: result.itemIndex,
      p_owner_address:
        result.ownerAddress ??
        context.wallet.address ??
        context.wallet.address_raw,
      p_tx_hash: result.txHash,
      p_metadata_url: result.metadataUrl ?? context.metadataUrl,
    },
    {
      schema: "api" as never,
      client: db,
      context: {
        mintQueueId: context.queue.id,
        itemInstanceId: context.queue.item_instance_id,
      },
    },
  );
}

async function moveMintQueueToRetryOrReview(
  db: SupabaseAdminClient,
  queue: MintQueueRow,
  input: {
    error: unknown;
    requestId: string;
    strategy: MintRetryStrategy;
    now: Date;
    forceNoSubmit?: boolean | undefined;
  },
): Promise<{
  status: "retrying" | "manual_review";
}> {
  const retryable = isRetryableMintWorkerError(input.error);
  const decision =
    retryable && !input.forceNoSubmit
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
  const errorMessage = getMintWorkerErrorMessage(input.error);
  const possibleSubmission =
    input.error instanceof TonNftProviderError &&
    input.error.submissionUncertain;

  await updateMintQueueStatus(db, queue, {
    status: decision.status,
    txHash: queue.tx_hash,
    errorMessage,
    nextAttemptAt: decision.nextAttemptAt?.toISOString() ?? null,
    metadata: {
      ...buildMintWorkerStatusMetadata({
        requestId: input.requestId,
        source: "cron.retry_mint_queue",
        errorReason: getMintWorkerErrorCode(input.error),
        errorMessage,
        txHash: queue.tx_hash ?? undefined,
      }),
      possible_submission: possibleSubmission,
      retry_attempt_count: decision.attemptCount,
      retry_max_attempts: decision.maxAttempts,
    },
  });

  if (decision.status === "manual_review") {
    await recordMintRetryExceededRisk({
      userId: queue.user_id,
      mintQueueId: queue.id,
      itemInstanceId: queue.item_instance_id,
      walletId: queue.wallet_id,
      requestId: input.requestId,
      action: "cron.retry_mint_queue",
      status: "manual_review",
      attemptCount: decision.attemptCount,
      maxAttempts: decision.maxAttempts,
      errorCode: getMintWorkerErrorCode(input.error),
      errorMessage,
      retryable,
      txHash: queue.tx_hash,
      possibleSubmission,
      forceNoSubmit: input.forceNoSubmit ?? false,
    });
  }

  return {
    status: decision.status,
  };
}

async function updateMintQueueStatus(
  db: SupabaseAdminClient,
  queue: MintQueueRow,
  input: {
    status: "submitted" | "confirming" | "retrying" | "manual_review";
    txHash: string | null;
    errorMessage: string | null;
    nextAttemptAt: string | null;
    metadata: JsonRecord;
  },
): Promise<void> {
  const { error } = await db
    .schema("onchain")
    .from("mint_queue")
    .update({
      status: input.status,
      tx_hash: input.txHash,
      error_message: input.errorMessage,
      next_attempt_at: input.nextAttemptAt,
      metadata: mergeMintWorkerMetadata(queue.metadata, input.metadata) as Json,
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
}

function toMintQueueContext(row: MintQueueRow) {
  return {
    id: row.id,
    userId: row.user_id,
    walletId: row.wallet_id,
    collectionId: row.collection_id,
    itemInstanceId: row.item_instance_id,
    templateId: row.template_id,
    formId: row.form_id,
    attemptCount: readInteger(row.attempt_count, 1),
    maxAttempts: readInteger(row.max_attempts, 5),
    txHash: row.tx_hash,
    idempotencyKey: row.idempotency_key,
    metadata: toRecord(row.metadata),
  };
}

function toCollectionContext(row: NftCollectionRow): TonNftCollectionContext {
  return {
    id: row.id,
    network: normalizeNetwork(row.network),
    collectionAddress: row.collection_address,
    ownerAddress: row.owner_address,
    metadataUrl: row.metadata_url,
    contentBaseUrl: row.content_base_url,
    contractVersion: row.contract_version,
    metadata: toRecord(row.metadata),
  };
}

function toWalletContext(row: WalletRow): TonNftWalletContext {
  return {
    id: row.id,
    address: row.address,
    addressRaw: row.address_raw,
    network: normalizeNetwork(row.network),
  };
}

function readMetadataSnapshot(value: unknown): JsonRecord {
  const record = toRecord(value);
  const snapshot = record.metadata_snapshot;

  return toRecord(snapshot);
}

function readMetadataUrl(value: unknown): string | null {
  const record = toRecord(value);

  return readString(record.metadata_url) ?? readString(record.metadataUrl);
}

function readWorkerQueryId(row: MintQueueRow): string | null {
  const worker = toRecord(toRecord(row.metadata).mint_worker);

  return readString(worker.query_id) ?? readString(worker.queryId);
}

function readClaimQueryId(row: MintQueueRow, attemptCount: number): string {
  const previousQueryId = readWorkerQueryId(row);

  if (readPossibleSubmission(row) && previousQueryId) {
    return previousQueryId;
  }

  return buildMintQueryId({
    mintQueueId: row.id,
    attemptCount,
  });
}

function readPossibleSubmission(row: MintQueueRow): boolean {
  const worker = toRecord(toRecord(row.metadata).mint_worker);

  return worker.possible_submission === true;
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

function incrementResult(
  result: MintWorkerResult,
  status: "confirming" | "minted" | "retrying" | "manualReview",
): void {
  result[status] += 1;
}

function mapMintWorkerError(error: unknown): ApiError {
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
    return new ApiError(
      500,
      "MINT_WORKER_RPC_FAILED",
      "Mint worker RPC 失败。",
      {
        expose: false,
        cause: error,
      },
    );
  }

  return ApiError.internal("Mint worker 执行失败。", {
    cause: getMintWorkerErrorMessage(error),
  });
}

function getMintWorkerErrorCode(error: unknown): string {
  if (error instanceof TonNftProviderError) {
    return error.code;
  }

  if (error instanceof ApiError) {
    return error.code;
  }

  if (error instanceof RpcError) {
    return "MINT_WORKER_RPC_FAILED";
  }

  if (error instanceof Error) {
    return error.name || "MINT_WORKER_ERROR";
  }

  return "MINT_WORKER_ERROR";
}

function getMintWorkerErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }

  return String(error);
}

function isRetryableMintWorkerError(error: unknown): boolean {
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

function readString(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }

  const trimmed = value.trim();

  return trimmed.length > 0 ? trimmed : null;
}

function asDbJson(value: unknown): Json {
  return value as Json;
}

function toRecord(value: unknown): JsonRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as JsonRecord)
    : {};
}
