import { Address } from "@ton/ton";

export interface TonWalletChainPublicKeyInput {
  address: string;
  chain?: string | undefined;
}

export interface TonWalletChainPublicKeyResolver {
  resolvePublicKey(
    input: TonWalletChainPublicKeyInput,
  ): Promise<string | null | undefined>;
}

type TonCenterStackItem =
  | [string, string | number | bigint | null]
  | {
      type?: unknown;
      value?: unknown;
      num?: unknown;
    };

type TonCenterResponse = {
  ok?: unknown;
  result?: {
    stack?: unknown;
  };
};

const DEFAULT_TIMEOUT_MS = 5_000;

export async function resolveTonWalletPublicKeyFromChain(
  input: TonWalletChainPublicKeyInput,
  env: NodeJS.ProcessEnv = process.env,
): Promise<string | null> {
  const endpoint = resolveTonCenterEndpoint(input.chain, env);

  if (!endpoint) {
    return null;
  }

  let address: string;

  try {
    address = Address.parse(input.address).toRawString();
  } catch {
    return null;
  }

  const timeoutMs = readPositiveIntegerEnv(
    env,
    "TON_CHAIN_LOOKUP_TIMEOUT_MS",
    DEFAULT_TIMEOUT_MS,
  );
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(`${endpoint}/runGetMethod`, {
      method: "POST",
      headers: buildTonCenterHeaders(env),
      body: JSON.stringify({
        address,
        method: "get_public_key",
        stack: [],
      }),
      signal: controller.signal,
    });

    if (!response.ok) {
      return null;
    }

    const payload = (await response.json()) as TonCenterResponse;

    if (payload.ok === false) {
      return null;
    }

    return readPublicKeyFromStack(payload.result?.stack);
  } catch {
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

function resolveTonCenterEndpoint(
  chain: string | undefined,
  env: NodeJS.ProcessEnv,
): string | null {
  const explicit =
    env.TONCENTER_API_BASE_URL ??
    env.TON_CENTER_API_BASE_URL ??
    env.TON_API_BASE_URL;

  if (explicit?.trim()) {
    return trimTrailingSlash(explicit.trim());
  }

  if (env.TON_CHAIN_LOOKUP_DISABLED === "true") {
    return null;
  }

  const normalized = String(chain ?? "MAINNET")
    .trim()
    .toUpperCase();

  return normalized === "TESTNET" || normalized === "-3"
    ? "https://testnet.toncenter.com/api/v2"
    : "https://toncenter.com/api/v2";
}

function buildTonCenterHeaders(env: NodeJS.ProcessEnv): Record<string, string> {
  const headers: Record<string, string> = {
    "content-type": "application/json",
  };
  const apiKey = env.TONCENTER_API_KEY ?? env.TON_CENTER_API_KEY;

  if (apiKey?.trim()) {
    headers["x-api-key"] = apiKey.trim();
  }

  return headers;
}

function readPublicKeyFromStack(stack: unknown): string | null {
  if (!Array.isArray(stack) || stack.length === 0) {
    return null;
  }

  const first = stack[0] as TonCenterStackItem;
  const raw = Array.isArray(first)
    ? first[1]
    : (first.value ?? first.num ?? undefined);

  return normalizePublicKeyStackValue(raw);
}

function normalizePublicKeyStackValue(value: unknown): string | null {
  if (typeof value === "bigint") {
    return value.toString(16).padStart(64, "0");
  }

  if (typeof value === "number" && Number.isSafeInteger(value)) {
    return BigInt(value).toString(16).padStart(64, "0");
  }

  if (typeof value !== "string") {
    return null;
  }

  const trimmed = value.trim().toLowerCase();

  if (/^0x[a-f0-9]{1,64}$/.test(trimmed)) {
    return BigInt(trimmed).toString(16).padStart(64, "0");
  }

  if (/^[0-9]+$/.test(trimmed)) {
    return BigInt(trimmed).toString(16).padStart(64, "0");
  }

  if (/^[a-f0-9]{64}$/.test(trimmed)) {
    return trimmed;
  }

  return null;
}

function readPositiveIntegerEnv(
  env: NodeJS.ProcessEnv,
  name: string,
  fallback: number,
): number {
  const value = env[name];

  if (!value) {
    return fallback;
  }

  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function trimTrailingSlash(value: string): string {
  return value.endsWith("/") ? value.slice(0, -1) : value;
}
