import {
  getSupabaseAdminClient,
  type SupabaseAdminClient,
} from "../../packages/server/src/db/supabaseAdmin.js";
import {
  normalizeMintQueueStatus,
  type MintQueueStatus,
} from "../../packages/server/src/ton/mintQueue.js";
import {
  MintStatusQuerySchema,
  type MintQueueItem,
  type MintStatusQuery,
} from "../../packages/validation/src/wallet.schemas.js";
import { ApiError, withApiHandler } from "../_shared/handler.js";
import { requireSession } from "../_shared/requireSession.js";
import { validate } from "../_shared/validate.js";

type JsonRecord = Record<string, unknown>;

type MintQueueRow = {
  id: string;
  user_id: string;
  wallet_id: string | null;
  collection_id: string;
  item_instance_id: string;
  status: string;
  attempt_count: number | string;
  nft_item_id: string | null;
  tx_hash: string | null;
  error_message: string | null;
  metadata: unknown;
  created_at: string;
  updated_at: string;
  completed_at: string | null;
};

type NftCollectionRow = {
  id: string;
  network: string;
  collection_address: string;
};

type WalletRow = {
  id: string;
  address: string;
  network: string;
};

type NftItemRow = {
  id: string;
  item_address: string | null;
  owner_address: string | null;
  minted_tx_hash: string | null;
  minted_at: string | null;
};

type OnchainTransactionRow = {
  related_id: string | null;
  tx_hash: string | null;
  status: string;
  created_at: string;
};

type MintQueueSummary = Record<MintQueueStatus, number>;

type MintStatusResponse = {
  items: MintQueueItem[];
  summary: MintQueueSummary;
  nextCursor: string | null;
  serverTime: string;
};

const MINT_QUEUE_COLUMNS = [
  "id",
  "user_id",
  "wallet_id",
  "collection_id",
  "item_instance_id",
  "status",
  "attempt_count",
  "nft_item_id",
  "tx_hash",
  "error_message",
  "metadata",
  "created_at",
  "updated_at",
  "completed_at",
].join(",");

const COLLECTION_COLUMNS = ["id", "network", "collection_address"].join(",");
const WALLET_COLUMNS = ["id", "address", "network"].join(",");
const NFT_ITEM_COLUMNS = [
  "id",
  "item_address",
  "owner_address",
  "minted_tx_hash",
  "minted_at",
].join(",");
const TRANSACTION_COLUMNS = [
  "related_id",
  "tx_hash",
  "status",
  "created_at",
].join(",");

export default withApiHandler(
  async (req, _res) => {
    const session = await requireSession(req);
    const input = validate(
      MintStatusQuerySchema,
      normalizeMintStatusQuery(req),
    );
    const db = getSupabaseAdminClient();
    const offset = parseOffsetCursor(input.cursor);
    const limit = input.limit ?? 20;
    const rows = await listMintQueueRows(
      db,
      session.userId,
      input,
      offset,
      limit,
    );
    const pageRows = rows.slice(0, limit);
    const maps = await loadMintQueueMaps(db, pageRows);
    const items = pageRows.map((row) => toMintQueueItem(row, maps));

    return {
      items,
      summary: summarizeMintQueueItems(items),
      nextCursor: rows.length > limit ? String(offset + limit) : null,
      serverTime: new Date().toISOString(),
    } satisfies MintStatusResponse;
  },
  {
    methods: ["GET"],
    rateLimit: {
      action: "wallet.mint_status",
    },
  },
);

export function normalizeMintStatusQuery(req: {
  query: Record<string, unknown>;
}): Record<string, unknown> {
  const query = req.query;

  return {
    cursor: firstQueryValue(query.cursor),
    limit: firstQueryValue(query.limit),
    mintQueueId: firstQueryValue(query.mintQueueId ?? query.mint_queue_id),
    itemInstanceId: firstQueryValue(
      query.itemInstanceId ?? query.item_instance_id,
    ),
    statuses: query.statuses ?? query.status,
  };
}

async function listMintQueueRows(
  db: SupabaseAdminClient,
  userId: string,
  input: MintStatusQuery,
  offset: number,
  limit: number,
): Promise<MintQueueRow[]> {
  let query = db
    .schema("onchain")
    .from("mint_queue")
    .select(MINT_QUEUE_COLUMNS)
    .eq("user_id", userId);

  if (input.mintQueueId) {
    query = query.eq("id", input.mintQueueId);
  }

  if (input.itemInstanceId) {
    query = query.eq("item_instance_id", input.itemInstanceId);
  }

  if (input.statuses && input.statuses.length > 0) {
    query = query.in("status", input.statuses);
  }

  const { data, error } = await query
    .order("created_at", { ascending: false })
    .order("id", { ascending: false })
    .range(offset, offset + limit);

  if (error) {
    throw new ApiError(
      500,
      "MINT_STATUS_LOOKUP_FAILED",
      "查询 Mint 队列失败。",
      {
        expose: false,
        cause: error,
      },
    );
  }

  return Array.isArray(data) ? (data as unknown as MintQueueRow[]) : [];
}

async function loadMintQueueMaps(
  db: SupabaseAdminClient,
  rows: MintQueueRow[],
) {
  const [collections, wallets, nftItems, transactions] = await Promise.all([
    fetchCollectionMap(db, uniqueStrings(rows.map((row) => row.collection_id))),
    fetchWalletMap(db, uniqueStrings(rows.map((row) => row.wallet_id))),
    fetchNftItemMap(db, uniqueStrings(rows.map((row) => row.nft_item_id))),
    fetchTransactionMap(db, uniqueStrings(rows.map((row) => row.id))),
  ]);

  return {
    collections,
    wallets,
    nftItems,
    transactions,
  };
}

async function fetchCollectionMap(
  db: SupabaseAdminClient,
  ids: string[],
): Promise<Map<string, NftCollectionRow>> {
  if (ids.length === 0) {
    return new Map();
  }

  const { data, error } = await db
    .schema("onchain")
    .from("nft_collections")
    .select(COLLECTION_COLUMNS)
    .in("id", ids);

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

  return mapById(data as unknown as NftCollectionRow[]);
}

async function fetchWalletMap(
  db: SupabaseAdminClient,
  ids: string[],
): Promise<Map<string, WalletRow>> {
  if (ids.length === 0) {
    return new Map();
  }

  const { data, error } = await db
    .schema("core")
    .from("user_wallets")
    .select(WALLET_COLUMNS)
    .in("id", ids);

  if (error) {
    throw new ApiError(
      500,
      "MINT_WALLET_LOOKUP_FAILED",
      "查询 Mint 钱包失败。",
      {
        expose: false,
        cause: error,
      },
    );
  }

  return mapById(data as unknown as WalletRow[]);
}

async function fetchNftItemMap(
  db: SupabaseAdminClient,
  ids: string[],
): Promise<Map<string, NftItemRow>> {
  if (ids.length === 0) {
    return new Map();
  }

  const { data, error } = await db
    .schema("onchain")
    .from("nft_items")
    .select(NFT_ITEM_COLUMNS)
    .in("id", ids);

  if (error) {
    throw new ApiError(500, "NFT_ITEM_LOOKUP_FAILED", "查询 NFT Item 失败。", {
      expose: false,
      cause: error,
    });
  }

  return mapById(data as unknown as NftItemRow[]);
}

async function fetchTransactionMap(
  db: SupabaseAdminClient,
  mintQueueIds: string[],
): Promise<Map<string, OnchainTransactionRow>> {
  if (mintQueueIds.length === 0) {
    return new Map();
  }

  const { data, error } = await db
    .schema("onchain")
    .from("transactions")
    .select(TRANSACTION_COLUMNS)
    .eq("related_type", "mint_queue")
    .in("related_id", mintQueueIds)
    .order("created_at", { ascending: false });

  if (error) {
    throw new ApiError(
      500,
      "ONCHAIN_TRANSACTION_LOOKUP_FAILED",
      "查询链上交易状态失败。",
      {
        expose: false,
        cause: error,
      },
    );
  }

  const result = new Map<string, OnchainTransactionRow>();

  for (const row of (data as unknown as OnchainTransactionRow[]) ?? []) {
    if (row.related_id && !result.has(row.related_id)) {
      result.set(row.related_id, row);
    }
  }

  return result;
}

function toMintQueueItem(
  row: MintQueueRow,
  maps: Awaited<ReturnType<typeof loadMintQueueMaps>>,
): MintQueueItem {
  const status = normalizeMintQueueStatus(row.status) ?? "queued";
  const collection = maps.collections.get(row.collection_id);
  const wallet = row.wallet_id ? maps.wallets.get(row.wallet_id) : undefined;
  const nftItem = row.nft_item_id
    ? maps.nftItems.get(row.nft_item_id)
    : undefined;
  const transaction = maps.transactions.get(row.id);
  const transactionHash =
    readString(row.tx_hash) ??
    readString(nftItem?.minted_tx_hash) ??
    readString(transaction?.tx_hash);
  const mintedAt =
    status === "minted"
      ? (readString(row.completed_at) ?? readString(nftItem?.minted_at))
      : null;

  return compactRecord({
    mintQueueId: row.id,
    itemInstanceId: row.item_instance_id,
    status,
    chain: networkToTonChain(collection?.network ?? wallet?.network),
    collectionAddress: readString(collection?.collection_address),
    itemAddress: readString(nftItem?.item_address),
    targetAddress:
      readString(nftItem?.owner_address) ?? readString(wallet?.address),
    transactionHash,
    errorCode: readMintErrorCode(row.metadata),
    errorMessage: readString(row.error_message),
    retryCount: readInteger(row.attempt_count),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    mintedAt,
  }) as MintQueueItem;
}

function summarizeMintQueueItems(items: MintQueueItem[]): MintQueueSummary {
  const summary: MintQueueSummary = {
    queued: 0,
    processing: 0,
    submitted: 0,
    confirming: 0,
    retrying: 0,
    manual_review: 0,
    minted: 0,
    failed: 0,
    cancelled: 0,
  };

  for (const item of items) {
    summary[item.status] += 1;
  }

  return summary;
}

function parseOffsetCursor(cursor: string | undefined): number {
  if (!cursor) {
    return 0;
  }

  const offset = Number(cursor);

  if (!Number.isInteger(offset) || offset < 0) {
    throw new ApiError(400, "VALIDATION_ERROR", "请求参数校验失败。", {
      details: [
        {
          path: "cursor",
          message: "cursor 必须是非负整数偏移量。",
        },
      ],
    });
  }

  return offset;
}

function networkToTonChain(value: string | undefined): "MAINNET" | "TESTNET" {
  return value === "testnet" ? "TESTNET" : "MAINNET";
}

function readMintErrorCode(metadata: unknown): string | undefined {
  if (!isRecord(metadata)) {
    return undefined;
  }

  const directCode =
    readString(metadata.error_code) ?? readString(metadata.errorCode);

  if (directCode) {
    return directCode;
  }

  const nestedError = metadata.error;

  return isRecord(nestedError)
    ? (readString(nestedError.code) ?? undefined)
    : undefined;
}

function firstQueryValue(value: unknown): string | undefined {
  const firstValue = Array.isArray(value) ? value[0] : value;

  return readString(firstValue) ?? undefined;
}

function readString(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }

  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function readInteger(value: unknown): number {
  if (typeof value === "number" && Number.isFinite(value)) {
    return Math.trunc(value);
  }

  if (typeof value === "string" && value.trim().length > 0) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? Math.trunc(parsed) : 0;
  }

  return 0;
}

function compactRecord(
  value: Record<string, unknown>,
): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(value).filter(
      ([, item]) => item !== undefined && item !== null,
    ),
  );
}

function uniqueStrings(values: Array<string | null | undefined>): string[] {
  return Array.from(
    new Set(values.filter((value): value is string => Boolean(value))),
  );
}

function mapById<T extends { id: string }>(rows: T[] | null): Map<string, T> {
  return new Map((rows ?? []).map((row) => [row.id, row]));
}

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
