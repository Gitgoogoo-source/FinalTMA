import {
  getSupabaseAdminClient,
  type SupabaseAdminClient,
} from "../../packages/server/src/db/supabaseAdmin.js";
import {
  WalletConnectBodySchema,
  type TonChain,
  type WalletConnectBody,
} from "../../packages/validation/src/wallet.schemas.js";
import {
  ApiError,
  getIdempotencyKey,
  withApiHandler,
} from "../_shared/handler.js";
import { parseJsonBody } from "../_shared/parseBody.js";
import { requireSession } from "../_shared/requireSession.js";
import { validate } from "../_shared/validate.js";
import {
  toWalletStatusResponse,
  WALLET_STATUS_COLUMNS,
  type WalletRow,
} from "./status.js";

type WalletNetwork = "mainnet" | "testnet";
type JsonRecord = Record<string, unknown>;

type WalletUpsertRow = {
  user_id: string;
  chain: "TON";
  network: WalletNetwork;
  address: string;
  address_raw: string | null;
  wallet_app_name: string | null;
  is_primary: true;
  status: "connected";
  disconnected_at: null;
};

export default withApiHandler(
  async (req) => {
    const session = await requireSession(req);
    const body = await parseJsonBody<unknown>(req, {
      maxBytes: 32 * 1024,
    });
    const input = validate(
      WalletConnectBodySchema,
      normalizeWalletConnectInput(body, getIdempotencyKey(req)),
    );
    const wallet = await saveConnectedWalletSession(
      getSupabaseAdminClient(),
      session.userId,
      input,
      getWalletRawAddress(body, input.account.address),
    );

    return toWalletStatusResponse(wallet, new Date());
  },
  {
    methods: ["POST"],
    rateLimit: {
      action: "wallet.connect",
    },
  },
);

export function normalizeWalletConnectInput(
  body: unknown,
  headerIdempotencyKey: string | null,
): Record<string, unknown> {
  if (!isRecord(body)) {
    return {};
  }

  const account = isRecord(body.account) ? body.account : {};
  const chain =
    normalizeTonChain(account.chain) ??
    normalizeTonChain(body.chain) ??
    normalizeTonChain(body.network) ??
    getDefaultTonChain();

  return compactRecord({
    account: compactRecord({
      address:
        readString(body.address) ??
        readString(account.address) ??
        readString(body.raw_address) ??
        readString(body.rawAddress),
      chain,
      publicKey:
        readString(account.publicKey) ??
        readString(account.public_key) ??
        readString(body.publicKey) ??
        readString(body.public_key),
      walletStateInit:
        readString(account.walletStateInit) ??
        readString(account.wallet_state_init) ??
        readString(body.walletStateInit) ??
        readString(body.wallet_state_init),
    }),
    walletAppName:
      readString(body.walletAppName) ??
      readString(body.wallet_app_name) ??
      readString(body.appName) ??
      readString(body.app_name),
    device: normalizeWalletDevice(body.device),
    idempotencyKey:
      readString(body.idempotencyKey) ??
      readString(body.idempotency_key) ??
      headerIdempotencyKey,
  });
}

export async function saveConnectedWalletSession(
  db: SupabaseAdminClient,
  userId: string,
  input: WalletConnectBody,
  addressRaw: string | null = null,
): Promise<WalletRow> {
  const network = networkFromTonChain(input.account.chain);

  await clearPrimaryConnectedWallet(db, userId, network);

  const row: WalletUpsertRow = {
    user_id: userId,
    chain: "TON",
    network,
    address: input.account.address,
    address_raw: addressRaw ?? input.account.address,
    wallet_app_name: input.walletAppName ?? input.device?.appName ?? null,
    is_primary: true,
    status: "connected",
    disconnected_at: null,
  };

  const { data, error } = await db
    .schema("core")
    .from("user_wallets")
    .upsert(row, {
      onConflict: "user_id,chain,network,address",
    })
    .select(WALLET_STATUS_COLUMNS)
    .single<WalletRow>();

  if (error) {
    throw mapWalletConnectError(error);
  }

  if (!data) {
    throw new ApiError(
      500,
      "WALLET_CONNECT_SAVE_FAILED",
      "保存钱包连接状态失败。",
      {
        expose: false,
      },
    );
  }

  return data;
}

function getWalletRawAddress(body: unknown, fallbackAddress: string): string {
  const root = isRecord(body) ? body : {};
  const account = isRecord(root.account) ? root.account : {};

  return (
    readString(root.raw_address) ??
    readString(root.rawAddress) ??
    readString(account.address) ??
    fallbackAddress
  );
}

async function clearPrimaryConnectedWallet(
  db: SupabaseAdminClient,
  userId: string,
  network: WalletNetwork,
): Promise<void> {
  const { error } = await db
    .schema("core")
    .from("user_wallets")
    .update({
      is_primary: false,
    })
    .eq("user_id", userId)
    .eq("chain", "TON")
    .eq("network", network)
    .eq("status", "connected")
    .eq("is_primary", true);

  if (error) {
    throw mapWalletConnectError(error);
  }
}

function mapWalletConnectError(error: unknown): ApiError {
  if (isPostgresErrorCode(error, "23505")) {
    return new ApiError(
      409,
      "WALLET_CONNECT_CONFLICT",
      "钱包连接状态冲突，请重试。",
      {
        cause: error,
      },
    );
  }

  return new ApiError(
    500,
    "WALLET_CONNECT_SAVE_FAILED",
    "保存钱包连接状态失败。",
    {
      expose: false,
      cause: error,
    },
  );
}

function normalizeTonChain(value: unknown): TonChain | null {
  const text = readString(value)?.toLowerCase();

  switch (text) {
    case "mainnet":
    case "main":
    case "-239":
      return "MAINNET";
    case "testnet":
    case "test":
    case "-3":
      return "TESTNET";
    default:
      return null;
  }
}

function networkFromTonChain(chain: TonChain): WalletNetwork {
  return chain === "TESTNET" ? "testnet" : "mainnet";
}

function getDefaultTonChain(): TonChain {
  return normalizeTonChain(process.env.TON_NETWORK) ?? "MAINNET";
}

function normalizeWalletDevice(value: unknown): unknown {
  if (!isRecord(value)) {
    return undefined;
  }

  return compactRecord({
    platform: normalizeDevicePlatform(value.platform),
    appName: readString(value.appName) ?? readString(value.app_name),
    appVersion: readString(value.appVersion) ?? readString(value.app_version),
    userAgent: readString(value.userAgent) ?? readString(value.user_agent),
  });
}

function normalizeDevicePlatform(value: unknown): unknown {
  const text = readString(value)?.toUpperCase();

  switch (text) {
    case "IOS":
    case "ANDROID":
    case "WEB":
    case "DESKTOP":
    case "UNKNOWN":
      return text;
    default:
      return undefined;
  }
}

function compactRecord(value: JsonRecord): JsonRecord {
  return Object.fromEntries(
    Object.entries(value).filter(
      ([, item]) => item !== undefined && item !== null,
    ),
  );
}

function readString(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }

  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isPostgresErrorCode(error: unknown, code: string): boolean {
  return isRecord(error) && error.code === code;
}
