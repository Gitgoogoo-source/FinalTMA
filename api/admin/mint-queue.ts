import {
  getSupabaseAdminClient,
  type SupabaseAdminClient,
} from "../../packages/server/src/db/supabaseAdmin.js";
import { ApiError, withApiHandler } from "../_shared/handler.js";
import { requireAdmin } from "../_shared/requireAdmin.js";
import {
  buildNextCursor,
  firstQueryValue,
  normalizeDateEnd,
  normalizeDateStart,
  normalizeStatus,
  normalizeUuid,
  parseAdminLimit,
  parseOffsetCursor,
} from "./_shared.js";

type MintQueueRow = {
  id: string;
  user_id: string;
  wallet_id: string | null;
  collection_id: string;
  item_instance_id: string;
  template_id: string;
  form_id: string | null;
  status: string;
  priority: number | string;
  attempt_count: number | string;
  max_attempts: number | string;
  next_attempt_at: string | null;
  nft_item_id: string | null;
  tx_hash: string | null;
  error_message: string | null;
  metadata: unknown;
  created_at: string;
  updated_at: string;
  completed_at: string | null;
};

type WalletRow = {
  id: string;
  user_id: string;
  network: string;
  address: string;
  address_raw: string | null;
  wallet_app_name: string | null;
  status: string;
  verified_at: string | null;
  last_sync_at: string | null;
};

type TransactionRow = {
  id: string;
  related_id: string | null;
  tx_hash: string | null;
  query_id: string | null;
  status: string;
  error_message: string | null;
  submitted_at: string | null;
  confirmed_at: string | null;
  created_at: string;
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
  "metadata",
  "created_at",
  "updated_at",
  "completed_at",
].join(",");

const WALLET_COLUMNS = [
  "id",
  "user_id",
  "network",
  "address",
  "address_raw",
  "wallet_app_name",
  "status",
  "verified_at",
  "last_sync_at",
].join(",");

const TRANSACTION_COLUMNS = [
  "id",
  "related_id",
  "tx_hash",
  "query_id",
  "status",
  "error_message",
  "submitted_at",
  "confirmed_at",
  "created_at",
].join(",");

export default withApiHandler(
  async (req) => {
    await requireAdmin(req, {
      permissions: ["mint:read", "onchain:read"],
      requireAll: false,
    });

    const db = getSupabaseAdminClient();
    const limit = parseAdminLimit(req.query.limit);
    const offset = parseOffsetCursor(req.query.cursor);
    const rows = await listMintQueueRows(db, req.query, offset, limit);
    const pageRows = rows.slice(0, limit);
    const [wallets, transactions] = await Promise.all([
      loadWallets(db, pageRows),
      loadTransactions(db, pageRows),
    ]);

    return {
      items: pageRows.map((row) => ({
        ...row,
        priority: Number(row.priority),
        attempt_count: Number(row.attempt_count),
        max_attempts: Number(row.max_attempts),
        wallet: row.wallet_id ? (wallets.get(row.wallet_id) ?? null) : null,
        transaction: transactions.get(row.id) ?? null,
      })),
      summary: summarizeMintQueue(pageRows),
      nextCursor: buildNextCursor(rows.length, limit, offset),
      serverTime: new Date().toISOString(),
    };
  },
  {
    methods: ["GET"],
    rateLimit: {
      action: "admin.read",
    },
  },
);

async function listMintQueueRows(
  db: SupabaseAdminClient,
  queryInput: Record<string, unknown>,
  offset: number,
  limit: number,
): Promise<MintQueueRow[]> {
  let query = db
    .schema("onchain")
    .from("mint_queue")
    .select(MINT_QUEUE_COLUMNS);
  const status = normalizeStatus(queryInput.status);
  const userId = normalizeUuid(queryInput.userId ?? queryInput.user_id);
  const itemInstanceId = normalizeUuid(
    queryInput.itemInstanceId ?? queryInput.item_instance_id,
  );
  const collectionId = normalizeUuid(
    queryInput.collectionId ?? queryInput.collection_id,
  );
  const q = firstQueryValue(queryInput.q);
  const from = normalizeDateStart(queryInput.from);
  const to = normalizeDateEnd(queryInput.to);

  if (status) {
    query = query.eq("status", status);
  }

  if (userId) {
    query = query.eq("user_id", userId);
  }

  if (itemInstanceId) {
    query = query.eq("item_instance_id", itemInstanceId);
  }

  if (collectionId) {
    query = query.eq("collection_id", collectionId);
  }

  if (q && normalizeUuid(q)) {
    query = query.eq("id", q);
  }

  if (from) {
    query = query.gte("created_at", from);
  }

  if (to) {
    query = query.lte("created_at", to);
  }

  const { data, error } = await query
    .order("created_at", { ascending: false })
    .order("id", { ascending: false })
    .range(offset, offset + limit);

  if (error) {
    throw new ApiError(
      500,
      "ADMIN_MINT_QUEUE_LOOKUP_FAILED",
      "Mint 队列查询失败。",
      {
        expose: false,
        cause: error,
      },
    );
  }

  return Array.isArray(data) ? (data as unknown as MintQueueRow[]) : [];
}

async function loadWallets(
  db: SupabaseAdminClient,
  rows: MintQueueRow[],
): Promise<Map<string, WalletRow>> {
  const walletIds = uniqueStrings(rows.map((row) => row.wallet_id));

  if (walletIds.length === 0) {
    return new Map();
  }

  const { data, error } = await db
    .schema("core")
    .from("user_wallets")
    .select(WALLET_COLUMNS)
    .in("id", walletIds);

  if (error) {
    throw new ApiError(500, "ADMIN_WALLET_LOOKUP_FAILED", "钱包查询失败。", {
      expose: false,
      cause: error,
    });
  }

  return mapById(data as unknown as WalletRow[]);
}

async function loadTransactions(
  db: SupabaseAdminClient,
  rows: MintQueueRow[],
): Promise<Map<string, TransactionRow>> {
  const mintQueueIds = uniqueStrings(rows.map((row) => row.id));

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
      "ADMIN_ONCHAIN_TRANSACTION_LOOKUP_FAILED",
      "链上交易查询失败。",
      {
        expose: false,
        cause: error,
      },
    );
  }

  const result = new Map<string, TransactionRow>();

  for (const row of (Array.isArray(data)
    ? data
    : []) as unknown as TransactionRow[]) {
    if (row.related_id && !result.has(row.related_id)) {
      result.set(row.related_id, row);
    }
  }

  return result;
}

function summarizeMintQueue(rows: MintQueueRow[]): Record<string, number> {
  const summary: Record<string, number> = {};

  for (const row of rows) {
    summary[row.status] = (summary[row.status] ?? 0) + 1;
  }

  return summary;
}

function mapById<T extends { id: string }>(rows: T[]): Map<string, T> {
  const result = new Map<string, T>();

  for (const row of rows) {
    result.set(row.id, row);
  }

  return result;
}

function uniqueStrings(values: Array<string | null | undefined>): string[] {
  return Array.from(new Set(values.filter(Boolean) as string[]));
}
