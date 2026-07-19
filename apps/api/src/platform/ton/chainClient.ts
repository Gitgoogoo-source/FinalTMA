import { Address } from "@ton/ton";

import { getTonEnv } from "../env/index.ts";

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
): Promise<string | null> {
  const env = getTonEnv();
  const expectedNetwork =
    input.chain === "TESTNET" || input.chain === "-3" ? "testnet" : "mainnet";
  if (expectedNetwork !== env.TON_NETWORK) return null;

  let address: string;

  try {
    address = Address.parse(input.address).toRawString();
  } catch {
    return null;
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), DEFAULT_TIMEOUT_MS);

  try {
    const response = await fetch(
      `${env.TON_API_BASE_URL.replace(/\/$/, "")}/runGetMethod`,
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-api-key": env.TON_API_KEY,
        },
        body: JSON.stringify({
          address,
          method: "get_public_key",
          stack: [],
        }),
        signal: controller.signal,
      },
    );

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
