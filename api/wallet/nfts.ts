import {
  getSupabaseAdminClient,
  type SupabaseAdminClient,
} from "../../packages/server/src/db/supabaseAdmin.js";
import { callRpcRaw } from "../../packages/server/src/db/rpc.js";
import {
  WalletNftSyncQuerySchema,
  type WalletNftItem,
  type WalletNftSyncQuery,
} from "../../packages/validation/src/wallet.schemas.js";
import { ApiError, withApiHandler } from "../_shared/handler.js";
import { requireSession } from "../_shared/requireSession.js";
import { validate } from "../_shared/validate.js";

type WalletNetwork = "mainnet" | "testnet";

type NftListResponse = {
  items: WalletNftItem[];
  nextCursor: string | null;
  serverTime: string;
};

export default withApiHandler(
  async (req, _res) => {
    const session = await requireSession(req);
    const input = validate(
      WalletNftSyncQuerySchema,
      normalizeWalletNftQuery(req.query),
    );
    const offset = parseOffsetCursor(input.cursor);
    const limit = input.limit ?? 20;

    return await getWalletNftListResponse(
      getSupabaseAdminClient(),
      session.userId,
      input,
      offset,
      limit,
    );
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

async function getWalletNftListResponse(
  db: SupabaseAdminClient,
  userId: string,
  input: WalletNftSyncQuery,
  offset: number,
  limit: number,
): Promise<NftListResponse> {
  try {
    return await callRpcRaw<NftListResponse>(
      "wallet_list_nft_snapshots",
      {
        p_user_id: userId,
        p_address: input.address ?? null,
        p_network: input.chain ? chainToNetwork(input.chain) : null,
        p_collection_address: input.collectionAddress ?? null,
        p_only_known_collections: input.onlyKnownCollections ?? false,
        p_offset: offset,
        p_limit: limit,
      },
      {
        schema: "api" as never,
        client: db,
        context: {
          userId,
          address: input.address,
          chain: input.chain,
          collectionAddress: input.collectionAddress,
        },
      },
    );
  } catch (error) {
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

function readString(value: unknown): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }

  const trimmed = value.trim();
  return trimmed ? trimmed : undefined;
}
