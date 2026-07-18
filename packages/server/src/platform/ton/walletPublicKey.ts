import {
  Address,
  Cell,
  WalletContractV1R1,
  WalletContractV1R2,
  WalletContractV1R3,
  WalletContractV2R1,
  WalletContractV2R2,
  WalletContractV3R1,
  WalletContractV3R2,
  WalletContractV4,
  WalletContractV5Beta,
  WalletContractV5R1,
  contractAddress,
  loadStateInit,
  type StateInit,
} from "@ton/ton";

import {
  resolveTonWalletPublicKeyFromChain,
  type TonWalletChainPublicKeyResolver,
} from "./chainClient.js";
import {
  TonProofVerificationError,
  type TonConnectAccount,
  type TonProofPublicKeyResolveInput,
} from "./tonConnect.js";

export interface TonWalletStateInitPublicKey {
  publicKey: string;
  address: string;
  walletVersion: string;
  source: "state_init";
}

export interface ResolveVerifiedTonWalletPublicKeyOptions {
  chainResolver?: TonWalletChainPublicKeyResolver | undefined;
}

type WalletPublicKeyExtractor = (data: Cell) => string;

type KnownWalletSpec = {
  version: string;
  codeHash: string;
  extractPublicKey: WalletPublicKeyExtractor;
};

const ZERO_PUBLIC_KEY = Buffer.alloc(32);
let knownWalletSpecs: KnownWalletSpec[] | null = null;

export async function resolveVerifiedTonWalletPublicKey(
  input: TonProofPublicKeyResolveInput,
  options: ResolveVerifiedTonWalletPublicKeyOptions = {},
): Promise<string> {
  const submittedPublicKey = normalizeOptionalPublicKey(
    input.account.publicKey,
  );
  const stateInitPublicKey = input.account.walletStateInit
    ? extractTonWalletPublicKeyFromStateInit(input.account)
    : null;

  if (stateInitPublicKey) {
    assertSubmittedPublicKeyMatches(
      submittedPublicKey,
      stateInitPublicKey.publicKey,
    );
    return stateInitPublicKey.publicKey;
  }

  const chainPublicKey = await resolveChainPublicKey(input, options);

  if (chainPublicKey) {
    assertSubmittedPublicKeyMatches(submittedPublicKey, chainPublicKey);
    return chainPublicKey;
  }

  throw new TonProofVerificationError(
    "TON_PROOF_PUBLIC_KEY_UNRESOLVED",
    "Unable to resolve a trusted TON wallet public key.",
  );
}

export function extractTonWalletPublicKeyFromStateInit(
  account: Pick<TonConnectAccount, "address" | "walletStateInit">,
): TonWalletStateInitPublicKey | null {
  if (!account.walletStateInit) {
    return null;
  }

  const address = parseTonAddress(account.address);
  const stateInit = parseWalletStateInit(account.walletStateInit);

  if (!stateInit.code || !stateInit.data) {
    throw new TonProofVerificationError(
      "TON_PROOF_STATE_INIT_INVALID",
      "TON wallet stateInit must include code and data.",
    );
  }

  const derivedAddress = contractAddress(address.workChain, {
    code: stateInit.code,
    data: stateInit.data,
  });

  if (!derivedAddress.equals(address)) {
    throw new TonProofVerificationError(
      "TON_PROOF_STATE_INIT_ADDRESS_MISMATCH",
      "TON wallet stateInit does not derive the submitted address.",
      {
        submittedAddress: address.toRawString(),
        derivedAddress: derivedAddress.toRawString(),
      },
    );
  }

  const spec = resolveKnownWalletSpec(stateInit.code);

  if (!spec) {
    return null;
  }

  return {
    publicKey: spec.extractPublicKey(stateInit.data),
    address: address.toRawString(),
    walletVersion: spec.version,
    source: "state_init",
  };
}

function parseWalletStateInit(value: string): StateInit {
  try {
    const cells = Cell.fromBoc(decodeBase64Flexible(value));
    const root = cells[0];

    if (!root) {
      throw new Error("BOC has no root cell.");
    }

    return loadStateInit(root.beginParse());
  } catch (error) {
    if (error instanceof TonProofVerificationError) {
      throw error;
    }

    throw new TonProofVerificationError(
      "TON_PROOF_STATE_INIT_INVALID",
      "TON wallet stateInit is invalid.",
      {
        cause: error instanceof Error ? error.message : String(error),
      },
    );
  }
}

function parseTonAddress(value: string): Address {
  try {
    return Address.parse(value);
  } catch {
    throw new TonProofVerificationError(
      "TON_PROOF_ADDRESS_UNSUPPORTED",
      "TON wallet address is invalid.",
      {
        address: value,
      },
    );
  }
}

async function resolveChainPublicKey(
  input: TonProofPublicKeyResolveInput,
  options: ResolveVerifiedTonWalletPublicKeyOptions,
): Promise<string | null> {
  const resolver = options.chainResolver ?? {
    resolvePublicKey: resolveTonWalletPublicKeyFromChain,
  };
  const resolved = await resolver.resolvePublicKey({
    address: input.account.address,
    chain: input.account.chain,
  });

  return normalizeOptionalPublicKey(resolved ?? undefined);
}

function assertSubmittedPublicKeyMatches(
  submittedPublicKey: string | null,
  trustedPublicKey: string,
): void {
  if (!submittedPublicKey) {
    return;
  }

  if (submittedPublicKey !== trustedPublicKey) {
    throw new TonProofVerificationError(
      "TON_PROOF_WALLET_PUBLIC_KEY_MISMATCH",
      "Submitted TON wallet public key does not match the verified wallet key.",
    );
  }
}

function resolveKnownWalletSpec(code: Cell): KnownWalletSpec | null {
  const codeHash = code.hash().toString("hex");

  return (
    getKnownWalletSpecs().find((spec) => spec.codeHash === codeHash) ?? null
  );
}

function getKnownWalletSpecs(): KnownWalletSpec[] {
  if (knownWalletSpecs) {
    return knownWalletSpecs;
  }

  knownWalletSpecs = [
    buildSpec(
      "wallet-v1-r1",
      WalletContractV1R1.create({
        workchain: 0,
        publicKey: ZERO_PUBLIC_KEY,
      }).init.code,
      extractSeqnoPublicKey,
    ),
    buildSpec(
      "wallet-v1-r2",
      WalletContractV1R2.create({
        workchain: 0,
        publicKey: ZERO_PUBLIC_KEY,
      }).init.code,
      extractSeqnoPublicKey,
    ),
    buildSpec(
      "wallet-v1-r3",
      WalletContractV1R3.create({
        workchain: 0,
        publicKey: ZERO_PUBLIC_KEY,
      }).init.code,
      extractSeqnoPublicKey,
    ),
    buildSpec(
      "wallet-v2-r1",
      WalletContractV2R1.create({
        workchain: 0,
        publicKey: ZERO_PUBLIC_KEY,
      }).init.code,
      extractSeqnoPublicKey,
    ),
    buildSpec(
      "wallet-v2-r2",
      WalletContractV2R2.create({
        workchain: 0,
        publicKey: ZERO_PUBLIC_KEY,
      }).init.code,
      extractSeqnoPublicKey,
    ),
    buildSpec(
      "wallet-v3-r1",
      WalletContractV3R1.create({
        workchain: 0,
        publicKey: ZERO_PUBLIC_KEY,
      }).init.code,
      extractSeqnoWalletIdPublicKey,
    ),
    buildSpec(
      "wallet-v3-r2",
      WalletContractV3R2.create({
        workchain: 0,
        publicKey: ZERO_PUBLIC_KEY,
      }).init.code,
      extractSeqnoWalletIdPublicKey,
    ),
    buildSpec(
      "wallet-v4",
      WalletContractV4.create({
        workchain: 0,
        publicKey: ZERO_PUBLIC_KEY,
      }).init.code,
      extractSeqnoWalletIdPublicKey,
    ),
    buildSpec(
      "wallet-v5-beta",
      WalletContractV5Beta.create({
        publicKey: ZERO_PUBLIC_KEY,
      }).init.code,
      extractV5BetaPublicKey,
    ),
    buildSpec(
      "wallet-v5-r1",
      WalletContractV5R1.create({
        workchain: 0,
        publicKey: ZERO_PUBLIC_KEY,
      }).init.code,
      extractV5R1PublicKey,
    ),
  ];

  return knownWalletSpecs;
}

function buildSpec(
  version: string,
  code: Cell,
  extractPublicKey: WalletPublicKeyExtractor,
): KnownWalletSpec {
  return {
    version,
    codeHash: code.hash().toString("hex"),
    extractPublicKey,
  };
}

function extractSeqnoPublicKey(data: Cell): string {
  return loadPublicKeyAfterSkipping(data, 32);
}

function extractSeqnoWalletIdPublicKey(data: Cell): string {
  return loadPublicKeyAfterSkipping(data, 64);
}

function extractV5BetaPublicKey(data: Cell): string {
  return loadPublicKeyAfterSkipping(data, 113);
}

function extractV5R1PublicKey(data: Cell): string {
  return loadPublicKeyAfterSkipping(data, 65);
}

function loadPublicKeyAfterSkipping(data: Cell, bitsToSkip: number): string {
  try {
    const slice = data.beginParse();

    if (slice.remainingBits < bitsToSkip + 256) {
      throw new Error("Wallet stateInit data is too short.");
    }

    slice.skip(bitsToSkip);
    return slice.loadBuffer(32).toString("hex");
  } catch (error) {
    throw new TonProofVerificationError(
      "TON_PROOF_STATE_INIT_INVALID",
      "TON wallet stateInit data does not match the known wallet layout.",
      {
        cause: error instanceof Error ? error.message : String(error),
      },
    );
  }
}

function normalizeOptionalPublicKey(
  value: string | null | undefined,
): string | null {
  if (!value) {
    return null;
  }

  const normalized = value.trim().toLowerCase();

  if (/^[a-f0-9]{64}$/.test(normalized)) {
    return normalized;
  }

  throw new TonProofVerificationError(
    "TON_PROOF_PUBLIC_KEY_FORMAT_INVALID",
    "TON wallet public key must be 32-byte hex.",
  );
}

function decodeBase64Flexible(value: string): Buffer {
  const trimmed = value.trim();
  const normalized = trimmed.replace(/-/g, "+").replace(/_/g, "/");
  const padded = normalized.padEnd(
    normalized.length + ((4 - (normalized.length % 4)) % 4),
    "=",
  );

  return Buffer.from(padded, "base64");
}
