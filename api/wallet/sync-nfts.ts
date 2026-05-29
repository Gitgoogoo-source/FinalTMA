import {
  getSupabaseAdminClient,
  type SupabaseAdminClient,
} from "../../packages/server/src/db/supabaseAdmin.js";
import { BackendOperationGuardError } from "../../packages/server/src/payments/paymentGuards.js";
import {
  createTonNftService,
  normalizeTonAddress,
  TonNftProviderError,
  type JsonRecord,
  type TonNftProviderAdapter,
  type TonNftWalletItem,
} from "../../packages/server/src/ton/nft.js";
import { assertWalletSyncEnabled } from "../../packages/server/src/ton/walletSyncGuards.js";
import {
  WalletNftSyncBodySchema,
  type WalletNftSyncBody,
} from "../../packages/validation/src/wallet.schemas.js";
import {
  ApiError,
  getIdempotencyKey,
  withApiHandler,
} from "../_shared/handler.js";
import { parseOptionalJsonBody } from "../_shared/parseBody.js";
import { requireSession } from "../_shared/requireSession.js";
import { validate } from "../_shared/validate.js";

type WalletNetwork = "mainnet" | "testnet";
type WalletSyncJobStatus = "queued" | "processing" | "success" | "failed";
type WalletSyncResponseStatus = "queued" | "syncing" | "success" | "failed";

type VerifiedWalletRow = {
  id: string;
  user_id: string;
  chain: string;
  network: string;
  address: string;
  address_raw: string | null;
  wallet_app_name: string | null;
  is_primary: boolean;
  status: string;
  verified_at: string | null;
  last_sync_at: string | null;
  updated_at: string;
  created_at: string;
};

type WalletSyncJobRow = {
  id: string;
  user_id: string;
  wallet_id: string;
  status: WalletSyncJobStatus | string;
  sync_type: string;
  started_at: string | null;
  finished_at: string | null;
  error_message: string | null;
  result: unknown;
  idempotency_key: string | null;
  retry_count: number | string;
  next_retry_at: string | null;
  cursor: string | null;
  created_at: string;
  updated_at: string;
};

type NftCollectionRow = {
  id: string;
  network: string;
  collection_address: string;
  status: string;
};

type KnownNftItemRow = {
  id: string;
  collection_id: string;
  item_address: string | null;
  owner_address: string | null;
  item_index: number | string | null;
};

type GameNftItem = TonNftWalletItem & {
  collection: NftCollectionRow;
};

type WalletNftSyncApiResponse = {
  accepted: boolean;
  status: WalletSyncResponseStatus;
  syncStatus: WalletSyncResponseStatus;
  mode: WalletNftSyncBody["mode"];
  jobId: string;
  syncedCount: number;
  linkedCount: number;
  ignoredCount: number;
  nextCursor: string | null;
  lastSyncAt: string | null;
  message: string | null;
  serverTime: string;
};

const WALLET_COLUMNS = [
  "id",
  "user_id",
  "chain",
  "network",
  "address",
  "address_raw",
  "wallet_app_name",
  "is_primary",
  "status",
  "verified_at",
  "last_sync_at",
  "updated_at",
  "created_at",
].join(",");

const JOB_COLUMNS = [
  "id",
  "user_id",
  "wallet_id",
  "status",
  "sync_type",
  "started_at",
  "finished_at",
  "error_message",
  "result",
  "idempotency_key",
  "retry_count",
  "next_retry_at",
  "cursor",
  "created_at",
  "updated_at",
].join(",");

const COLLECTION_COLUMNS = [
  "id",
  "network",
  "collection_address",
  "status",
].join(",");

const NFT_ITEM_COLUMNS = [
  "id",
  "collection_id",
  "item_address",
  "owner_address",
  "item_index",
].join(",");

const DEFAULT_RECENT_JOB_TTL_SECONDS = 300;
const DEFAULT_RETRY_DELAY_SECONDS = 300;

export default withApiHandler(
  async (req, _res, ctx) => {
    const session = await requireSession(req);
    const body = await parseOptionalJsonBody<unknown>(req, {
      maxBytes: 8 * 1024,
    });
    const input = validate(
      WalletNftSyncBodySchema,
      normalizeWalletNftSyncInput(body, getIdempotencyKey(req)),
    );
    const db = getSupabaseAdminClient();

    try {
      await assertWalletSyncEnabled({
        client: db,
      });

      return await syncWalletNftsForUser({
        db,
        provider: createTonNftService(),
        userId: session.userId,
        input,
        requestId: ctx.requestId,
        now: new Date(),
        env: process.env,
      });
    } catch (error) {
      throw mapWalletNftSyncError(error);
    }
  },
  {
    methods: ["POST"],
    rateLimit: {
      action: "wallet.sync_nfts",
    },
  },
);

export function normalizeWalletNftSyncInput(
  body: unknown,
  headerIdempotencyKey: string | null,
): Record<string, unknown> {
  if (!isRecord(body)) {
    return {
      idempotencyKey: headerIdempotencyKey,
    };
  }

  assertNoClientIdentityFields(body);

  return {
    address: body.address,
    chain: normalizeTonChainValue(body.chain ?? body.network),
    mode: normalizeSyncModeValue(body.mode),
    collectionAddress: body.collectionAddress ?? body.collection_address,
    force: body.force,
    idempotencyKey:
      body.idempotencyKey ?? body.idempotency_key ?? headerIdempotencyKey,
  };
}

export async function syncWalletNftsForUser(input: {
  db: SupabaseAdminClient;
  provider: TonNftProviderAdapter;
  userId: string;
  input: WalletNftSyncBody;
  requestId: string;
  now: Date;
  env?: NodeJS.ProcessEnv | undefined;
}): Promise<WalletNftSyncApiResponse> {
  const wallet = await findVerifiedWallet(input.db, input.userId, input.input);

  if (!wallet) {
    throw new ApiError(
      403,
      "WALLET_NOT_VERIFIED",
      "请先完成钱包验证后再同步 NFT。",
    );
  }

  const idempotentJob = input.input.idempotencyKey
    ? await findJobByIdempotencyKey(
        input.db,
        input.userId,
        input.input.idempotencyKey,
      )
    : null;

  if (idempotentJob) {
    return toWalletNftSyncResponse(idempotentJob, input.now, {
      accepted: false,
    });
  }

  if (!input.input.force) {
    const recentJob = await findRecentWalletSyncJob(
      input.db,
      wallet.id,
      input.now,
      readRecentJobTtlSeconds(input.env),
    );

    if (recentJob) {
      return toWalletNftSyncResponse(recentJob, input.now, {
        accepted:
          recentJob.status === "queued" || recentJob.status === "processing",
      });
    }
  }

  const job = await createWalletSyncJob(input.db, {
    userId: input.userId,
    walletId: wallet.id,
    idempotencyKey: input.input.idempotencyKey ?? null,
    mode: input.input.mode,
    collectionAddress: input.input.collectionAddress ?? null,
    requestId: input.requestId,
    now: input.now,
  });

  try {
    const providerResult = await input.provider.queryWalletNfts({
      requestId: input.requestId,
      wallet: {
        id: wallet.id,
        address: wallet.address,
        addressRaw: wallet.address_raw,
        network: normalizeWalletNetwork(wallet.network),
      },
      mode: input.input.mode,
      collectionAddress: input.input.collectionAddress ?? null,
      cursor: job.cursor,
      limit: readProviderLimit(input.env),
      rawPayload: {
        job_id: job.id,
      },
    });
    const collections = await listActiveCollections(
      input.db,
      normalizeWalletNetwork(wallet.network),
      input.input.collectionAddress ?? null,
    );
    const gameItems = filterGameNfts(providerResult.items, collections);
    const linkedCount = await updateKnownNftItems(input.db, gameItems, {
      userId: input.userId,
      jobId: job.id,
      now: input.now,
    });
    await upsertWalletNftSnapshots(input.db, gameItems, {
      userId: input.userId,
      walletId: wallet.id,
      seenAt: providerResult.checkedAt,
    });
    await updateWalletLastSyncAt(input.db, wallet, input.now);

    const completedJob = await updateSyncJobSuccess(input.db, job, {
      mode: input.input.mode,
      providerCount: providerResult.items.length,
      syncedCount: gameItems.length,
      linkedCount,
      ignoredCount: providerResult.items.length - gameItems.length,
      nextCursor: providerResult.nextCursor,
      externalApiProvider: providerResult.externalApiProvider,
      requestId: input.requestId,
      now: input.now,
    });

    return toWalletNftSyncResponse(completedJob, input.now, {
      accepted: true,
      lastSyncAt: input.now.toISOString(),
      message:
        gameItems.length === 0
          ? "未发现当前游戏 Collection NFT。"
          : "钱包 NFT 同步完成。",
    });
  } catch (error) {
    await markSyncJobFailed(input.db, job, error, {
      requestId: input.requestId,
      now: input.now,
      env: input.env,
    });
    throw error;
  }
}

async function findVerifiedWallet(
  db: SupabaseAdminClient,
  userId: string,
  input: Pick<WalletNftSyncBody, "address" | "chain">,
): Promise<VerifiedWalletRow | null> {
  let query = db
    .schema("core")
    .from("user_wallets")
    .select(WALLET_COLUMNS)
    .eq("user_id", userId)
    .eq("status", "connected")
    .not("verified_at", "is", null);

  if (input.address) {
    query = query.eq("address", input.address);
  }

  if (input.chain) {
    query = query.eq("network", chainToNetwork(input.chain));
  }

  const { data, error } = await query
    .order("is_primary", { ascending: false })
    .order("verified_at", { ascending: false, nullsFirst: false })
    .order("updated_at", { ascending: false })
    .limit(1)
    .maybeSingle<VerifiedWalletRow>();

  if (error) {
    throw new ApiError(
      500,
      "WALLET_SYNC_WALLET_LOOKUP_FAILED",
      "查询钱包状态失败。",
      {
        expose: false,
        cause: error,
      },
    );
  }

  return data ?? null;
}

async function findJobByIdempotencyKey(
  db: SupabaseAdminClient,
  userId: string,
  idempotencyKey: string,
): Promise<WalletSyncJobRow | null> {
  const { data, error } = await db
    .schema("onchain")
    .from("wallet_sync_jobs")
    .select(JOB_COLUMNS)
    .eq("user_id", userId)
    .eq("idempotency_key", idempotencyKey)
    .maybeSingle<WalletSyncJobRow>();

  if (error) {
    throw new ApiError(
      500,
      "WALLET_SYNC_JOB_LOOKUP_FAILED",
      "查询同步任务失败。",
      {
        expose: false,
        cause: error,
      },
    );
  }

  return data ?? null;
}

async function findRecentWalletSyncJob(
  db: SupabaseAdminClient,
  walletId: string,
  now: Date,
  ttlSeconds: number,
): Promise<WalletSyncJobRow | null> {
  const cutoff = new Date(now.getTime() - ttlSeconds * 1000).toISOString();
  const { data, error } = await db
    .schema("onchain")
    .from("wallet_sync_jobs")
    .select(JOB_COLUMNS)
    .eq("wallet_id", walletId)
    .eq("sync_type", "nft")
    .in("status", ["queued", "processing", "success"])
    .gte("created_at", cutoff)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle<WalletSyncJobRow>();

  if (error) {
    throw new ApiError(
      500,
      "WALLET_SYNC_JOB_LOOKUP_FAILED",
      "查询同步任务失败。",
      {
        expose: false,
        cause: error,
      },
    );
  }

  return data ?? null;
}

async function createWalletSyncJob(
  db: SupabaseAdminClient,
  input: {
    userId: string;
    walletId: string;
    idempotencyKey: string | null;
    mode: WalletNftSyncBody["mode"];
    collectionAddress: string | null;
    requestId: string;
    now: Date;
  },
): Promise<WalletSyncJobRow> {
  const nowIso = input.now.toISOString();
  const { data, error } = await db
    .schema("onchain")
    .from("wallet_sync_jobs")
    .insert({
      user_id: input.userId,
      wallet_id: input.walletId,
      status: "processing",
      sync_type: "nft",
      started_at: nowIso,
      idempotency_key: input.idempotencyKey,
      result: {
        mode: input.mode,
        collection_address: input.collectionAddress,
        request_id: input.requestId,
      },
      updated_at: nowIso,
    })
    .select(JOB_COLUMNS)
    .single<WalletSyncJobRow>();

  if (error) {
    throw new ApiError(
      500,
      "WALLET_SYNC_JOB_CREATE_FAILED",
      "创建同步任务失败。",
      {
        expose: false,
        cause: error,
      },
    );
  }

  return data;
}

async function listActiveCollections(
  db: SupabaseAdminClient,
  network: WalletNetwork,
  requestedCollectionAddress: string | null,
): Promise<NftCollectionRow[]> {
  const { data, error } = await db
    .schema("onchain")
    .from("nft_collections")
    .select(COLLECTION_COLUMNS)
    .eq("network", network)
    .eq("status", "active");

  if (error) {
    throw new ApiError(
      500,
      "WALLET_SYNC_COLLECTION_LOOKUP_FAILED",
      "查询 NFT Collection 配置失败。",
      {
        expose: false,
        cause: error,
      },
    );
  }

  const rows = Array.isArray(data)
    ? (data as unknown as NftCollectionRow[])
    : [];
  const requestedAddress = normalizeTonAddress(requestedCollectionAddress);

  if (!requestedAddress) {
    return rows;
  }

  return rows.filter(
    (row) => normalizeTonAddress(row.collection_address) === requestedAddress,
  );
}

function filterGameNfts(
  items: TonNftWalletItem[],
  collections: NftCollectionRow[],
): GameNftItem[] {
  const collectionByAddress = new Map(
    collections
      .map(
        (collection) =>
          [
            normalizeTonAddress(collection.collection_address),
            collection,
          ] as const,
      )
      .filter(
        (entry): entry is [string, NftCollectionRow] => entry[0] !== null,
      ),
  );

  return items.flatMap((item) => {
    const collectionAddress = normalizeTonAddress(item.collectionAddress);
    const collection = collectionAddress
      ? collectionByAddress.get(collectionAddress)
      : undefined;

    return collection ? [{ ...item, collection }] : [];
  });
}

async function upsertWalletNftSnapshots(
  db: SupabaseAdminClient,
  items: GameNftItem[],
  input: {
    userId: string;
    walletId: string;
    seenAt: string;
  },
): Promise<void> {
  if (items.length === 0) {
    return;
  }

  const { error } = await db
    .schema("onchain")
    .from("wallet_nft_snapshots")
    .upsert(
      items.map((item) => ({
        wallet_id: input.walletId,
        user_id: input.userId,
        collection_address:
          item.collectionAddress ?? item.collection.collection_address,
        item_address: item.itemAddress,
        owner_address: item.ownerAddress,
        metadata_url: item.metadataUrl,
        raw_payload: {
          ...item.rawPayload,
          item_index: item.itemIndex,
          name: item.name,
          image_url: item.imageUrl,
          wallet_sync: {
            item_index: item.itemIndex,
            name: item.name,
            image_url: item.imageUrl,
          },
        },
        seen_at: input.seenAt,
      })),
      {
        onConflict: "wallet_id,item_address",
      },
    );

  if (error) {
    throw new ApiError(
      500,
      "WALLET_NFT_SNAPSHOT_WRITE_FAILED",
      "写入钱包 NFT 快照失败。",
      {
        expose: false,
        cause: error,
      },
    );
  }
}

async function updateKnownNftItems(
  db: SupabaseAdminClient,
  items: GameNftItem[],
  input: {
    userId: string;
    jobId: string;
    now: Date;
  },
): Promise<number> {
  const itemAddresses = uniqueStrings(items.map((item) => item.itemAddress));

  if (itemAddresses.length === 0) {
    return 0;
  }

  const { data, error } = await db
    .schema("onchain")
    .from("nft_items")
    .select(NFT_ITEM_COLUMNS)
    .in("item_address", itemAddresses);

  if (error) {
    throw new ApiError(
      500,
      "WALLET_SYNC_NFT_ITEM_LOOKUP_FAILED",
      "查询已知 NFT 失败。",
      {
        expose: false,
        cause: error,
      },
    );
  }

  const itemByAddress = new Map(
    (Array.isArray(data) ? (data as unknown as KnownNftItemRow[]) : [])
      .filter((row) => row.item_address)
      .map((row) => [row.item_address as string, row]),
  );
  let linkedCount = 0;

  for (const item of items) {
    const known = itemByAddress.get(item.itemAddress);

    if (!known) {
      continue;
    }

    linkedCount += 1;

    if (
      known.owner_address &&
      normalizeTonAddress(known.owner_address) !==
        normalizeTonAddress(item.ownerAddress)
    ) {
      await recordOwnerMismatchRiskEvent(db, known, item, {
        userId: input.userId,
        jobId: input.jobId,
      });
    }

    const { error: updateError } = await db
      .schema("onchain")
      .from("nft_items")
      .update({
        owner_address: item.ownerAddress,
        last_seen_at: input.now.toISOString(),
        updated_at: input.now.toISOString(),
      })
      .eq("id", known.id);

    if (updateError) {
      throw new ApiError(
        500,
        "WALLET_SYNC_NFT_ITEM_UPDATE_FAILED",
        "更新链上 NFT 状态失败。",
        {
          expose: false,
          cause: updateError,
        },
      );
    }
  }

  return linkedCount;
}

async function recordOwnerMismatchRiskEvent(
  db: SupabaseAdminClient,
  known: KnownNftItemRow,
  item: GameNftItem,
  context: {
    userId: string;
    jobId: string;
  },
): Promise<void> {
  const { error } = await db
    .schema("ops")
    .from("risk_events")
    .insert({
      user_id: context.userId,
      event_type: "onchain_nft_owner_mismatch",
      severity: "medium",
      status: "open",
      source_type: "wallet_sync_job",
      source_id: context.jobId,
      detail: {
        nft_item_id: known.id,
        item_address: item.itemAddress,
        previous_owner_address: known.owner_address,
        observed_owner_address: item.ownerAddress,
        collection_id: known.collection_id,
      },
    });

  if (error) {
    throw new ApiError(
      500,
      "WALLET_SYNC_RISK_EVENT_WRITE_FAILED",
      "记录链上同步风险事件失败。",
      {
        expose: false,
        cause: error,
      },
    );
  }
}

async function updateWalletLastSyncAt(
  db: SupabaseAdminClient,
  wallet: VerifiedWalletRow,
  now: Date,
): Promise<void> {
  const nowIso = now.toISOString();
  const { error } = await db
    .schema("core")
    .from("user_wallets")
    .update({
      last_sync_at: nowIso,
      updated_at: nowIso,
    })
    .eq("id", wallet.id)
    .eq("user_id", wallet.user_id);

  if (error) {
    throw new ApiError(
      500,
      "WALLET_SYNC_WALLET_UPDATE_FAILED",
      "更新钱包同步时间失败。",
      {
        expose: false,
        cause: error,
      },
    );
  }
}

async function updateSyncJobSuccess(
  db: SupabaseAdminClient,
  job: WalletSyncJobRow,
  input: {
    mode: WalletNftSyncBody["mode"];
    providerCount: number;
    syncedCount: number;
    linkedCount: number;
    ignoredCount: number;
    nextCursor: string | null;
    externalApiProvider: string;
    requestId: string;
    now: Date;
  },
): Promise<WalletSyncJobRow> {
  const nowIso = input.now.toISOString();
  const { data, error } = await db
    .schema("onchain")
    .from("wallet_sync_jobs")
    .update({
      status: "success",
      finished_at: nowIso,
      cursor: input.nextCursor,
      result: {
        mode: input.mode,
        provider_count: input.providerCount,
        synced_count: input.syncedCount,
        linked_count: input.linkedCount,
        ignored_count: input.ignoredCount,
        next_cursor: input.nextCursor,
        external_api_provider: input.externalApiProvider,
        request_id: input.requestId,
      },
      updated_at: nowIso,
    })
    .eq("id", job.id)
    .select(JOB_COLUMNS)
    .single<WalletSyncJobRow>();

  if (error) {
    throw new ApiError(
      500,
      "WALLET_SYNC_JOB_UPDATE_FAILED",
      "更新同步任务失败。",
      {
        expose: false,
        cause: error,
      },
    );
  }

  return data;
}

async function markSyncJobFailed(
  db: SupabaseAdminClient,
  job: WalletSyncJobRow,
  error: unknown,
  input: {
    requestId: string;
    now: Date;
    env?: NodeJS.ProcessEnv | undefined;
  },
): Promise<void> {
  const providerError =
    error instanceof TonNftProviderError ? error : undefined;
  const retryable = providerError?.retryable ?? true;
  const nowIso = input.now.toISOString();
  const { error: updateError } = await db
    .schema("onchain")
    .from("wallet_sync_jobs")
    .update({
      status: "failed",
      finished_at: nowIso,
      error_message:
        providerError?.code ??
        (error instanceof Error ? error.message : "wallet sync failed"),
      retry_count: Number(job.retry_count ?? 0) + 1,
      next_retry_at: retryable
        ? new Date(
            input.now.getTime() + readRetryDelaySeconds(input.env) * 1000,
          ).toISOString()
        : null,
      result: {
        ...toRecord(job.result),
        request_id: input.requestId,
        error_code:
          providerError?.code ??
          (error instanceof ApiError ? error.code : "WALLET_SYNC_FAILED"),
        retryable,
      },
      updated_at: nowIso,
    })
    .eq("id", job.id);

  if (updateError) {
    throw new ApiError(
      500,
      "WALLET_SYNC_JOB_UPDATE_FAILED",
      "更新同步任务失败。",
      {
        expose: false,
        cause: updateError,
      },
    );
  }
}

function toWalletNftSyncResponse(
  job: WalletSyncJobRow,
  now: Date,
  overrides: {
    accepted?: boolean | undefined;
    lastSyncAt?: string | null | undefined;
    message?: string | null | undefined;
  } = {},
): WalletNftSyncApiResponse {
  const result = toRecord(job.result);
  const status = normalizeJobResponseStatus(job.status);

  return {
    accepted:
      overrides.accepted ?? (status === "queued" || status === "syncing"),
    status,
    syncStatus: status,
    mode:
      normalizeSyncModeValue(result.mode) === "FULL" ? "FULL" : "INCREMENTAL",
    jobId: job.id,
    syncedCount: readInteger(result.synced_count) ?? 0,
    linkedCount: readInteger(result.linked_count) ?? 0,
    ignoredCount: readInteger(result.ignored_count) ?? 0,
    nextCursor: readString(result.next_cursor) ?? job.cursor ?? null,
    lastSyncAt:
      overrides.lastSyncAt ??
      (job.status === "success" ? job.finished_at : null),
    message:
      overrides.message ??
      job.error_message ??
      (status === "success" ? "钱包 NFT 同步完成。" : null),
    serverTime: now.toISOString(),
  };
}

function mapWalletNftSyncError(error: unknown): ApiError {
  if (error instanceof ApiError) {
    return error;
  }

  if (error instanceof BackendOperationGuardError) {
    return new ApiError(error.statusCode, error.code, error.message, {
      details: error.details,
      expose: error.expose,
      cause: error,
    });
  }

  if (error instanceof TonNftProviderError) {
    return new ApiError(
      error.retryable ? 503 : 500,
      error.code === "TON_NFT_PROVIDER_NOT_CONFIGURED"
        ? "WALLET_NFT_SYNC_PROVIDER_UNAVAILABLE"
        : "WALLET_NFT_SYNC_FAILED",
      "链上 NFT 同步暂不可用，请稍后重试。",
      {
        details: {
          providerCode: error.code,
          retryable: error.retryable,
        },
        expose: true,
        cause: error,
      },
    );
  }

  return new ApiError(500, "WALLET_NFT_SYNC_FAILED", "链上 NFT 同步失败。", {
    expose: false,
    cause: error,
  });
}

function normalizeJobResponseStatus(value: unknown): WalletSyncResponseStatus {
  const normalized = readString(value)?.toLowerCase();

  if (normalized === "queued") {
    return "queued";
  }

  if (normalized === "success") {
    return "success";
  }

  if (normalized === "failed") {
    return "failed";
  }

  return "syncing";
}

function normalizeTonChainValue(value: unknown): unknown {
  const normalized =
    typeof value === "string" ? value.trim().toLowerCase() : "";

  if (
    normalized === "mainnet" ||
    normalized === "ton" ||
    normalized === "-239"
  ) {
    return "MAINNET";
  }

  if (normalized === "testnet" || normalized === "-3") {
    return "TESTNET";
  }

  return value;
}

function normalizeSyncModeValue(value: unknown): unknown {
  const normalized =
    typeof value === "string" ? value.trim().toUpperCase() : "";

  if (normalized === "FULL") {
    return "FULL";
  }

  if (normalized === "INCREMENTAL") {
    return "INCREMENTAL";
  }

  return value;
}

function chainToNetwork(chain: WalletNftSyncBody["chain"]): WalletNetwork {
  return chain === "TESTNET" ? "testnet" : "mainnet";
}

function normalizeWalletNetwork(value: string): WalletNetwork {
  return value === "testnet" ? "testnet" : "mainnet";
}

function readProviderLimit(env: NodeJS.ProcessEnv | undefined): number {
  return Math.min(
    100,
    Math.max(1, readPositiveInteger(env?.WALLET_SYNC_BATCH_SIZE, 50)),
  );
}

function readRecentJobTtlSeconds(env: NodeJS.ProcessEnv | undefined): number {
  return readPositiveInteger(
    env?.WALLET_SYNC_CACHE_TTL_SECONDS,
    DEFAULT_RECENT_JOB_TTL_SECONDS,
  );
}

function readRetryDelaySeconds(env: NodeJS.ProcessEnv | undefined): number {
  return readPositiveInteger(
    env?.WALLET_SYNC_RETRY_DELAY_SECONDS,
    DEFAULT_RETRY_DELAY_SECONDS,
  );
}

function readPositiveInteger(
  value: string | undefined,
  fallback: number,
): number {
  const parsed = Number(value);

  return Number.isFinite(parsed) && parsed > 0 ? Math.trunc(parsed) : fallback;
}

function readInteger(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) {
    return Math.trunc(value);
  }

  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? Math.trunc(parsed) : null;
  }

  return null;
}

function readString(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }

  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

function toRecord(value: unknown): JsonRecord {
  return isRecord(value) ? value : {};
}

function uniqueStrings(values: Array<string | null | undefined>): string[] {
  return Array.from(
    new Set(values.filter((value): value is string => Boolean(value))),
  );
}

function assertNoClientIdentityFields(body: Record<string, unknown>): void {
  const forbiddenFields = [
    "user_id",
    "userId",
    "telegram_user_id",
    "telegramUserId",
    "wallet_id",
    "walletId",
    "nft_item_id",
    "nftItemId",
    "owner_user_id",
    "ownerUserId",
  ].filter((field) => body[field] !== undefined);

  if (forbiddenFields.length > 0) {
    throw new ApiError(400, "VALIDATION_ERROR", "请求参数校验失败。", {
      details: forbiddenFields.map((field) => ({
        path: field,
        message: "同步 NFT 请求不能携带身份或链上归属事实字段。",
      })),
    });
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
