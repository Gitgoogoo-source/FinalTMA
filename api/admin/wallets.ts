import {
  getSupabaseAdminClient,
  type SupabaseAdminClient,
} from "../../packages/server/src/db/supabaseAdmin.js";
import { ApiError, withApiHandler } from "../_shared/handler.js";
import { requireAdmin } from "../_shared/requireAdmin.js";
import {
  buildNextCursor,
  firstQueryValue,
  normalizeStatus,
  normalizeUuid,
  parseAdminLimit,
  parseOffsetCursor,
} from "./_shared.js";

type WalletRow = {
  id: string;
  user_id: string;
  chain: string;
  network: string;
  address: string;
  address_raw: string | null;
  wallet_app_name: string | null;
  wallet_device: string | null;
  is_primary: boolean;
  status: string;
  verified_at: string | null;
  disconnected_at: string | null;
  last_sync_at: string | null;
  metadata: unknown;
  created_at: string;
  updated_at: string;
};

type WalletProofRow = {
  id: string;
  user_id: string;
  wallet_id: string | null;
  address: string | null;
  domain: string | null;
  status: string;
  expires_at: string;
  verified_at: string | null;
  error_message: string | null;
  created_at: string;
};

const WALLET_COLUMNS = [
  "id",
  "user_id",
  "chain",
  "network",
  "address",
  "address_raw",
  "wallet_app_name",
  "wallet_device",
  "is_primary",
  "status",
  "verified_at",
  "disconnected_at",
  "last_sync_at",
  "metadata",
  "created_at",
  "updated_at",
].join(",");

const PROOF_COLUMNS = [
  "id",
  "user_id",
  "wallet_id",
  "address",
  "domain",
  "status",
  "expires_at",
  "verified_at",
  "error_message",
  "created_at",
].join(",");

export default withApiHandler(
  async (req) => {
    await requireAdmin(req, {
      permissions: ["wallets:read", "wallet:read", "onchain:read"],
      requireAll: false,
    });

    const db = getSupabaseAdminClient();
    const limit = parseAdminLimit(req.query.limit);
    const offset = parseOffsetCursor(req.query.cursor);
    const wallets = await listWallets(db, req.query, offset, limit);
    const pageWallets = wallets.slice(0, limit);
    const proofs = await loadWalletProofs(db, pageWallets);

    return {
      items: pageWallets.map((wallet) => ({
        ...wallet,
        latest_proof: proofs.get(wallet.id) ?? null,
      })),
      summary: summarizeWallets(pageWallets),
      nextCursor: buildNextCursor(wallets.length, limit, offset),
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

async function listWallets(
  db: SupabaseAdminClient,
  queryInput: Record<string, unknown>,
  offset: number,
  limit: number,
): Promise<WalletRow[]> {
  let query = db.schema("core").from("user_wallets").select(WALLET_COLUMNS);
  const status = normalizeStatus(queryInput.status);
  const userId = normalizeUuid(queryInput.userId ?? queryInput.user_id);
  const q = firstQueryValue(queryInput.q);

  if (status) {
    query = query.eq("status", status);
  }

  if (userId) {
    query = query.eq("user_id", userId);
  }

  if (q) {
    query = normalizeUuid(q)
      ? query.eq("id", q)
      : query.ilike("address", `%${q}%`);
  }

  const { data, error } = await query
    .order("created_at", { ascending: false })
    .order("id", { ascending: false })
    .range(offset, offset + limit);

  if (error) {
    throw new ApiError(500, "ADMIN_WALLETS_LOOKUP_FAILED", "钱包查询失败。", {
      expose: false,
      cause: error,
    });
  }

  return Array.isArray(data) ? (data as unknown as WalletRow[]) : [];
}

async function loadWalletProofs(
  db: SupabaseAdminClient,
  wallets: WalletRow[],
): Promise<Map<string, WalletProofRow>> {
  const walletIds = Array.from(new Set(wallets.map((wallet) => wallet.id)));

  if (walletIds.length === 0) {
    return new Map();
  }

  const { data, error } = await db
    .schema("core")
    .from("wallet_proofs")
    .select(PROOF_COLUMNS)
    .in("wallet_id", walletIds)
    .order("created_at", { ascending: false });

  if (error) {
    throw new ApiError(
      500,
      "ADMIN_WALLET_PROOFS_LOOKUP_FAILED",
      "钱包 proof 查询失败。",
      {
        expose: false,
        cause: error,
      },
    );
  }

  const result = new Map<string, WalletProofRow>();

  for (const row of (Array.isArray(data)
    ? data
    : []) as unknown as WalletProofRow[]) {
    if (row.wallet_id && !result.has(row.wallet_id)) {
      result.set(row.wallet_id, row);
    }
  }

  return result;
}

function summarizeWallets(wallets: WalletRow[]): Record<string, number> {
  const summary: Record<string, number> = {};

  for (const wallet of wallets) {
    const key =
      wallet.status === "connected" && wallet.verified_at
        ? "verified"
        : wallet.status;
    summary[key] = (summary[key] ?? 0) + 1;
  }

  return summary;
}
