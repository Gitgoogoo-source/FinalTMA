import {
  getSupabaseAdminClient,
  type SupabaseAdminClient,
} from "../../packages/server/src/db/supabaseAdmin.js";
import { ApiError, withApiHandler } from "../_shared/handler.js";
import { requireSession } from "../_shared/requireSession.js";

type WalletRow = {
  id: string;
  user_id: string;
  chain: string;
  network: string;
  address: string;
  wallet_app_name: string | null;
  is_primary: boolean;
  status: string;
  verified_at: string | null;
  disconnected_at: string | null;
  last_sync_at: string | null;
  created_at: string;
  updated_at: string;
};

type WalletConnectionStatus =
  | "not_connected"
  | "connected_unverified"
  | "verified"
  | "disconnected"
  | "revoked";

type WalletStatusResponse = {
  connected: boolean;
  verified: boolean;
  status: WalletConnectionStatus;
  walletId?: string;
  address?: string;
  chain?: "MAINNET" | "TESTNET";
  network?: "mainnet" | "testnet";
  walletAppName?: string;
  verifiedAt?: string;
  connectedAt?: string;
  disconnectedAt?: string;
  lastSyncAt?: string;
  serverTime: string;
};

const WALLET_STATUS_COLUMNS = [
  "id",
  "user_id",
  "chain",
  "network",
  "address",
  "wallet_app_name",
  "is_primary",
  "status",
  "verified_at",
  "disconnected_at",
  "last_sync_at",
  "created_at",
  "updated_at",
].join(",");

export default withApiHandler(
  async (req, _res) => {
    const session = await requireSession(req);
    const wallet = await findCurrentWallet(
      getSupabaseAdminClient(),
      session.userId,
    );

    return toWalletStatusResponse(wallet, new Date());
  },
  {
    methods: ["GET"],
    rateLimit: {
      action: "wallet.status",
    },
  },
);

export async function findCurrentWallet(
  db: SupabaseAdminClient,
  userId: string,
): Promise<WalletRow | null> {
  const connectedWallet = await findConnectedWallet(db, userId);

  if (connectedWallet) {
    return connectedWallet;
  }

  return findLatestWallet(db, userId);
}

async function findConnectedWallet(
  db: SupabaseAdminClient,
  userId: string,
): Promise<WalletRow | null> {
  const { data, error } = await db
    .schema("core")
    .from("user_wallets")
    .select(WALLET_STATUS_COLUMNS)
    .eq("user_id", userId)
    .eq("status", "connected")
    .order("is_primary", { ascending: false })
    .order("verified_at", { ascending: false, nullsFirst: false })
    .order("updated_at", { ascending: false })
    .limit(1)
    .maybeSingle<WalletRow>();

  if (error) {
    throw new ApiError(
      500,
      "WALLET_STATUS_LOOKUP_FAILED",
      "查询钱包状态失败。",
      {
        expose: false,
        cause: error,
      },
    );
  }

  return data ?? null;
}

async function findLatestWallet(
  db: SupabaseAdminClient,
  userId: string,
): Promise<WalletRow | null> {
  const { data, error } = await db
    .schema("core")
    .from("user_wallets")
    .select(WALLET_STATUS_COLUMNS)
    .eq("user_id", userId)
    .order("updated_at", { ascending: false })
    .limit(1)
    .maybeSingle<WalletRow>();

  if (error) {
    throw new ApiError(
      500,
      "WALLET_STATUS_LOOKUP_FAILED",
      "查询钱包状态失败。",
      {
        expose: false,
        cause: error,
      },
    );
  }

  return data ?? null;
}

export function toWalletStatusResponse(
  wallet: WalletRow | null,
  now: Date,
): WalletStatusResponse {
  if (!wallet) {
    return {
      connected: false,
      verified: false,
      status: "not_connected",
      serverTime: now.toISOString(),
    };
  }

  const status = deriveWalletStatus(wallet);
  const connected = status === "connected_unverified" || status === "verified";
  const verified = status === "verified";

  return {
    connected,
    verified,
    status,
    walletId: wallet.id,
    address: wallet.address,
    chain: normalizeWalletNetwork(wallet.network),
    network: normalizeWalletNetworkLower(wallet.network),
    ...(wallet.wallet_app_name
      ? { walletAppName: wallet.wallet_app_name }
      : {}),
    ...(wallet.verified_at ? { verifiedAt: wallet.verified_at } : {}),
    connectedAt: wallet.created_at,
    ...(wallet.disconnected_at
      ? { disconnectedAt: wallet.disconnected_at }
      : {}),
    ...(wallet.last_sync_at ? { lastSyncAt: wallet.last_sync_at } : {}),
    serverTime: now.toISOString(),
  };
}

function deriveWalletStatus(wallet: WalletRow): WalletConnectionStatus {
  if (wallet.status === "connected") {
    return wallet.verified_at ? "verified" : "connected_unverified";
  }

  if (wallet.status === "revoked") {
    return "revoked";
  }

  return "disconnected";
}

function normalizeWalletNetwork(value: string): "MAINNET" | "TESTNET" {
  return value === "testnet" ? "TESTNET" : "MAINNET";
}

function normalizeWalletNetworkLower(value: string): "mainnet" | "testnet" {
  return value === "testnet" ? "testnet" : "mainnet";
}
