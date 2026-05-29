import {
  getSupabaseAdminClient,
  type SupabaseAdminClient,
} from "../../packages/server/src/db/supabaseAdmin.js";
import { normalizeTonAddress } from "../../packages/server/src/ton/nft.js";
import {
  WalletNftSyncQuerySchema,
  type WalletNftItem,
  type WalletNftSyncQuery,
} from "../../packages/validation/src/wallet.schemas.js";
import { ApiError, withApiHandler } from "../_shared/handler.js";
import { requireSession } from "../_shared/requireSession.js";
import { validate } from "../_shared/validate.js";

type WalletNetwork = "mainnet" | "testnet";
type JsonRecord = Record<string, unknown>;

type WalletRow = {
  id: string;
  user_id: string;
  network: string;
  address: string;
  status: string;
};

type WalletNftSnapshotRow = {
  id: string;
  wallet_id: string;
  user_id: string;
  collection_address: string | null;
  item_address: string;
  owner_address: string;
  metadata_url: string | null;
  raw_payload: unknown;
  seen_at: string;
  created_at: string;
};

type NftItemRow = {
  id: string;
  item_address: string | null;
  item_instance_id: string | null;
  item_index: number | string | null;
  metadata_url: string | null;
};

type NftListResponse = {
  items: WalletNftItem[];
  nextCursor: string | null;
  serverTime: string;
};

const WALLET_COLUMNS = ["id", "user_id", "network", "address", "status"].join(
  ",",
);

const SNAPSHOT_COLUMNS = [
  "id",
  "wallet_id",
  "user_id",
  "collection_address",
  "item_address",
  "owner_address",
  "metadata_url",
  "raw_payload",
  "seen_at",
  "created_at",
].join(",");

const NFT_ITEM_COLUMNS = [
  "id",
  "item_address",
  "item_instance_id",
  "item_index",
  "metadata_url",
].join(",");

export default withApiHandler(
  async (req, _res) => {
    const session = await requireSession(req);
    const input = validate(
      WalletNftSyncQuerySchema,
      normalizeWalletNftQuery(req.query),
    );
    const db = getSupabaseAdminClient();
    const offset = parseOffsetCursor(input.cursor);
    const limit = input.limit ?? 20;
    const rows = await listWalletNftSnapshots(
      db,
      session.userId,
      input,
      offset,
      limit,
    );
    const pageRows = rows.slice(0, limit);
    const nftItems = await loadNftItemMap(
      db,
      uniqueStrings(pageRows.map((row) => row.item_address)),
    );

    return {
      items: pageRows.map((row) => toWalletNftItem(row, nftItems)),
      nextCursor: rows.length > limit ? String(offset + limit) : null,
      serverTime: new Date().toISOString(),
    } satisfies NftListResponse;
  },
  {
    methods: ["GET"],
    rateLimit: {
      action: "wallet.nfts",
    },
  },
);

export function normalizeWalletNftQuery(
  query: Record<string, unknown>,
): Record<string, unknown> {
  return {
    cursor: firstQueryValue(query.cursor),
    limit: firstQueryValue(query.limit),
    address: firstQueryValue(query.address),
    chain: normalizeTonChainValue(
      firstQueryValue(query.chain ?? query.network),
    ),
    collectionAddress: firstQueryValue(
      query.collectionAddress ?? query.collection_address,
    ),
    onlyKnownCollections: firstQueryValue(
      query.onlyKnownCollections ?? query.only_known_collections,
    ),
  };
}

async function listWalletNftSnapshots(
  db: SupabaseAdminClient,
  userId: string,
  input: WalletNftSyncQuery,
  offset: number,
  limit: number,
): Promise<WalletNftSnapshotRow[]> {
  const wallet = await resolveWalletFilter(db, userId, input);
  const walletFilterRequested = Boolean(input.address || input.chain);

  if (walletFilterRequested && !wallet) {
    return [];
  }

  let query = db
    .schema("onchain")
    .from("wallet_nft_snapshots")
    .select(SNAPSHOT_COLUMNS)
    .eq("user_id", userId);

  if (wallet) {
    query = query.eq("wallet_id", wallet.id);
  }

  if (input.collectionAddress) {
    query = query.eq("collection_address", input.collectionAddress);
  }

  const { data, error } = await query
    .order("seen_at", { ascending: false })
    .order("item_address", { ascending: true })
    .range(offset, offset + limit);

  if (error) {
    throw new ApiError(
      500,
      "WALLET_NFT_SNAPSHOT_LOOKUP_FAILED",
      "查询钱包 NFT 快照失败。",
      {
        expose: false,
        cause: error,
      },
    );
  }

  const rows = Array.isArray(data)
    ? (data as unknown as WalletNftSnapshotRow[])
    : [];

  if (!input.onlyKnownCollections) {
    return rows;
  }

  return filterKnownCollectionRows(rows, input.collectionAddress ?? null);
}

async function resolveWalletFilter(
  db: SupabaseAdminClient,
  userId: string,
  input: WalletNftSyncQuery,
): Promise<WalletRow | null> {
  if (!input.address && !input.chain) {
    return null;
  }

  let query = db
    .schema("core")
    .from("user_wallets")
    .select(WALLET_COLUMNS)
    .eq("user_id", userId);

  if (input.address) {
    query = query.eq("address", input.address);
  }

  if (input.chain) {
    query = query.eq("network", chainToNetwork(input.chain));
  }

  const { data, error } = await query
    .order("updated_at", { ascending: false })
    .limit(1)
    .maybeSingle<WalletRow>();

  if (error) {
    throw new ApiError(
      500,
      "WALLET_NFT_WALLET_LOOKUP_FAILED",
      "查询钱包状态失败。",
      {
        expose: false,
        cause: error,
      },
    );
  }

  return data ?? null;
}

function filterKnownCollectionRows(
  rows: WalletNftSnapshotRow[],
  collectionAddress: string | null,
): WalletNftSnapshotRow[] {
  const normalizedFilter = normalizeTonAddress(collectionAddress);

  if (!normalizedFilter) {
    return rows.filter((row) => Boolean(row.collection_address));
  }

  return rows.filter(
    (row) => normalizeTonAddress(row.collection_address) === normalizedFilter,
  );
}

async function loadNftItemMap(
  db: SupabaseAdminClient,
  itemAddresses: string[],
): Promise<Map<string, NftItemRow>> {
  if (itemAddresses.length === 0) {
    return new Map();
  }

  const { data, error } = await db
    .schema("onchain")
    .from("nft_items")
    .select(NFT_ITEM_COLUMNS)
    .in("item_address", itemAddresses);

  if (error) {
    throw new ApiError(
      500,
      "WALLET_NFT_ITEM_LOOKUP_FAILED",
      "查询 NFT 关联状态失败。",
      {
        expose: false,
        cause: error,
      },
    );
  }

  return new Map(
    (Array.isArray(data) ? (data as unknown as NftItemRow[]) : [])
      .filter((row) => row.item_address)
      .map((row) => [row.item_address as string, row]),
  );
}

function toWalletNftItem(
  row: WalletNftSnapshotRow,
  nftItems: Map<string, NftItemRow>,
): WalletNftItem {
  const linked = nftItems.get(row.item_address);
  const rawPayload = toRecord(row.raw_payload);
  const itemIndex =
    readInteger(linked?.item_index) ?? readInteger(rawPayload.item_index);
  const name = readString(rawPayload.name);
  const imageUrl =
    readString(rawPayload.image_url) ?? readString(rawPayload.imageUrl);
  const metadataUrl = row.metadata_url ?? linked?.metadata_url ?? null;

  return {
    ...(linked ? { nftItemId: linked.id } : {}),
    itemAddress: row.item_address,
    ...(row.collection_address
      ? { collectionAddress: row.collection_address }
      : {}),
    ownerAddress: row.owner_address,
    ...(itemIndex !== undefined ? { itemIndex } : {}),
    ...(name ? { name } : {}),
    ...(imageUrl ? { imageUrl } : {}),
    ...(metadataUrl ? { metadataUrl } : {}),
    ...(linked?.item_instance_id
      ? { linkedItemInstanceId: linked.item_instance_id }
      : {}),
    syncedAt: row.seen_at,
  };
}

function parseOffsetCursor(value: string | undefined): number {
  if (!value) {
    return 0;
  }

  const parsed = Number.parseInt(value, 10);

  if (!Number.isSafeInteger(parsed) || parsed < 0) {
    throw new ApiError(400, "VALIDATION_ERROR", "Invalid request parameters", {
      details: [
        {
          path: "cursor",
          message: "cursor 必须是非负整数偏移量。",
        },
      ],
    });
  }

  return parsed;
}

function chainToNetwork(chain: WalletNftSyncQuery["chain"]): WalletNetwork {
  return chain === "TESTNET" ? "testnet" : "mainnet";
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

function firstQueryValue(value: unknown): unknown {
  return Array.isArray(value) ? value[0] : value;
}

function uniqueStrings(values: Array<string | null | undefined>): string[] {
  return Array.from(
    new Set(values.filter((value): value is string => Boolean(value))),
  );
}

function readString(value: unknown): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }

  const trimmed = value.trim();
  return trimmed ? trimmed : undefined;
}

function readInteger(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) {
    return Math.trunc(value);
  }

  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? Math.trunc(parsed) : undefined;
  }

  return undefined;
}

function toRecord(value: unknown): JsonRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as JsonRecord)
    : {};
}
