import {
  createHash,
  createPublicKey,
  randomBytes,
  verify as verifySignature,
  type KeyObject,
} from "node:crypto";

export type TonNetwork = "mainnet" | "testnet";
export type TonChainInput = "MAINNET" | "TESTNET" | "-239" | "-3" | string;

export interface TonProofDomain {
  lengthBytes: number;
  value: string;
}

export interface TonProofPayload {
  timestamp: number;
  domain: TonProofDomain;
  payload: string;
  signature: string;
}

export interface TonConnectAccount {
  address: string;
  chain?: TonChainInput | undefined;
  publicKey?: string | undefined;
  walletStateInit?: string | undefined;
}

export interface TonProofPublicKeyResolveInput {
  account: TonConnectAccount;
  proof: TonProofPayload;
  expectedDomain: string;
  expectedPayload: string;
}

export interface VerifyTonProofInput {
  account: TonConnectAccount;
  proof: TonProofPayload;
  expectedDomain: string;
  expectedPayload: string;
  now?: Date | undefined;
  maxAgeSeconds?: number | undefined;
  trustedPublicKey?: string | Buffer | Uint8Array | undefined;
  resolvePublicKey?:
    | ((
        input: TonProofPublicKeyResolveInput,
      ) => Promise<string | Buffer | Uint8Array | null | undefined>)
    | undefined;
  /**
   * Only use in tests or local mock mode. TON Connect docs mark account.publicKey
   * as untrusted until it is checked against stateInit or chain state.
   */
  allowUntrustedAccountPublicKey?: boolean | undefined;
}

export interface TonProofVerificationResult {
  verified: true;
  address: string;
  network: TonNetwork;
  domain: string;
  payload: string;
  timestamp: number;
  proofHash: string;
  walletPublicKey: string;
  digestHex: string;
}

export type TonProofVerificationErrorCode =
  | "TON_PROOF_ADDRESS_UNSUPPORTED"
  | "TON_PROOF_DOMAIN_INVALID"
  | "TON_PROOF_DOMAIN_LENGTH_MISMATCH"
  | "TON_PROOF_DOMAIN_MISMATCH"
  | "TON_PROOF_PAYLOAD_MISMATCH"
  | "TON_PROOF_TIMESTAMP_INVALID"
  | "TON_PROOF_EXPIRED"
  | "TON_PROOF_SIGNATURE_FORMAT_INVALID"
  | "TON_PROOF_PUBLIC_KEY_UNRESOLVED"
  | "TON_PROOF_PUBLIC_KEY_FORMAT_INVALID"
  | "TON_PROOF_SIGNATURE_INVALID";

export class TonProofVerificationError extends Error {
  override readonly name = "TonProofVerificationError";
  readonly code: TonProofVerificationErrorCode;
  readonly details: Record<string, unknown> | undefined;

  constructor(
    code: TonProofVerificationErrorCode,
    message: string,
    details?: Record<string, unknown> | undefined,
  ) {
    super(message);
    Object.setPrototypeOf(this, new.target.prototype);

    this.code = code;
    this.details = details;
  }
}

export const DEFAULT_TON_PROOF_TTL_SECONDS = 5 * 60;
const DEFAULT_CHALLENGE_BYTES = 32;
const RAW_TON_ADDRESS_RE = /^(-?\d+):([a-fA-F0-9]{64})$/;
const ED25519_SPKI_DER_PREFIX = Buffer.from("302a300506032b6570032100", "hex");

export function createTonProofChallenge(
  options: {
    bytes?: number | undefined;
    prefix?: string | undefined;
  } = {},
): string {
  const byteLength = options.bytes ?? DEFAULT_CHALLENGE_BYTES;

  if (!Number.isInteger(byteLength) || byteLength < 16 || byteLength > 128) {
    throw new RangeError("Challenge byte length must be between 16 and 128.");
  }

  const nonce = randomBytes(byteLength).toString("base64url");
  const prefix = options.prefix?.trim();

  return prefix ? `${prefix}:${nonce}` : nonce;
}

export function createTonProofExpiresAt(
  now: Date = new Date(),
  ttlSeconds = DEFAULT_TON_PROOF_TTL_SECONDS,
): Date {
  if (!Number.isFinite(ttlSeconds) || ttlSeconds <= 0) {
    throw new RangeError("TON proof ttl must be positive.");
  }

  return new Date(now.getTime() + Math.trunc(ttlSeconds) * 1000);
}

export async function verifyTonProof(
  input: VerifyTonProofInput,
): Promise<TonProofVerificationResult> {
  const expectedDomain = normalizeDomain(input.expectedDomain);
  const proofDomain = normalizeDomain(input.proof.domain.value);

  assertPayloadMatches(input.proof.payload, input.expectedPayload);
  assertDomainLength(input.proof.domain);

  if (proofDomain !== expectedDomain) {
    throw new TonProofVerificationError(
      "TON_PROOF_DOMAIN_MISMATCH",
      "TON proof domain does not match this app.",
      {
        expectedDomain,
        actualDomain: proofDomain,
      },
    );
  }

  assertTimestampFresh(input.proof, {
    now: input.now ?? new Date(),
    maxAgeSeconds: input.maxAgeSeconds ?? DEFAULT_TON_PROOF_TTL_SECONDS,
  });

  const parsedAddress = parseRawTonAddress(input.account.address);
  const digest = buildTonProofDigest(parsedAddress, input.proof);
  const publicKey = await resolveTonProofPublicKey(input);
  const signature = decodeSignature(input.proof.signature);

  if (!verifyEd25519(digest, signature, publicKey.bytes)) {
    throw new TonProofVerificationError(
      "TON_PROOF_SIGNATURE_INVALID",
      "TON proof signature is invalid.",
    );
  }

  return {
    verified: true,
    address: input.account.address,
    network: normalizeTonNetwork(input.account.chain),
    domain: proofDomain,
    payload: input.proof.payload,
    timestamp: input.proof.timestamp,
    proofHash: createTonProofHash(input.account, input.proof),
    walletPublicKey: publicKey.hex,
    digestHex: digest.toString("hex"),
  };
}

export function buildTonProofDigest(
  address: ParsedRawTonAddress,
  proof: TonProofPayload,
): Buffer {
  assertDomainLength(proof.domain);

  const workchain = Buffer.alloc(4);
  workchain.writeInt32BE(address.workchain, 0);

  const domainBytes = Buffer.from(proof.domain.value, "utf8");
  const domainLength = Buffer.alloc(4);
  domainLength.writeUInt32LE(domainBytes.length, 0);

  const timestamp = Buffer.alloc(8);
  timestamp.writeBigUInt64LE(BigInt(proof.timestamp), 0);

  const message = Buffer.concat([
    Buffer.from("ton-proof-item-v2/", "utf8"),
    workchain,
    address.hash,
    domainLength,
    domainBytes,
    timestamp,
    Buffer.from(proof.payload, "utf8"),
  ]);
  const innerHash = sha256(message);

  return sha256(
    Buffer.concat([
      Buffer.from([0xff, 0xff]),
      Buffer.from("ton-connect", "utf8"),
      innerHash,
    ]),
  );
}

export function createTonProofHash(
  account: Pick<TonConnectAccount, "address" | "chain">,
  proof: TonProofPayload,
): string {
  return sha256(
    Buffer.from(
      stableStringify({
        address: account.address,
        chain: account.chain ?? null,
        domain: proof.domain.value,
        payload: proof.payload,
        signature: proof.signature,
        timestamp: proof.timestamp,
      }),
      "utf8",
    ),
  ).toString("hex");
}

export function normalizeTonNetwork(
  chain: TonChainInput | undefined,
): TonNetwork {
  const normalized = String(chain ?? "MAINNET")
    .trim()
    .toUpperCase();

  if (normalized === "TESTNET" || normalized === "-3") {
    return "testnet";
  }

  return "mainnet";
}

export function resolveExpectedTonProofDomain(
  env: NodeJS.ProcessEnv = process.env,
): string {
  const candidate =
    env.TON_PROOF_DOMAIN ??
    env.PUBLIC_APP_URL ??
    env.TONCONNECT_MANIFEST_URL ??
    resolveVercelUrl(env.VERCEL_URL);

  if (!candidate) {
    throw new TonProofVerificationError(
      "TON_PROOF_DOMAIN_INVALID",
      "TON proof domain is not configured.",
    );
  }

  return normalizeDomain(candidate);
}

export interface ParsedRawTonAddress {
  workchain: number;
  hash: Buffer;
}

export function parseRawTonAddress(address: string): ParsedRawTonAddress {
  const match = RAW_TON_ADDRESS_RE.exec(address.trim());

  if (!match) {
    throw new TonProofVerificationError(
      "TON_PROOF_ADDRESS_UNSUPPORTED",
      "Only raw TON addresses from TON Connect are supported for proof verification.",
      {
        address,
      },
    );
  }

  const workchain = Number(match[1]);
  const hashHex = match[2];

  if (
    !Number.isInteger(workchain) ||
    !hashHex ||
    workchain < -2147483648 ||
    workchain > 2147483647
  ) {
    throw new TonProofVerificationError(
      "TON_PROOF_ADDRESS_UNSUPPORTED",
      "TON address workchain is outside int32 range.",
      {
        workchain,
      },
    );
  }

  return {
    workchain,
    hash: Buffer.from(hashHex, "hex"),
  };
}

function assertPayloadMatches(actual: string, expected: string): void {
  if (actual !== expected) {
    throw new TonProofVerificationError(
      "TON_PROOF_PAYLOAD_MISMATCH",
      "TON proof payload does not match the issued challenge.",
    );
  }
}

function assertDomainLength(domain: TonProofDomain): void {
  const actualLength = Buffer.byteLength(domain.value, "utf8");

  if (domain.lengthBytes !== actualLength) {
    throw new TonProofVerificationError(
      "TON_PROOF_DOMAIN_LENGTH_MISMATCH",
      "TON proof domain length does not match its UTF-8 byte length.",
      {
        expectedLength: actualLength,
        actualLength: domain.lengthBytes,
      },
    );
  }
}

function assertTimestampFresh(
  proof: TonProofPayload,
  options: {
    now: Date;
    maxAgeSeconds: number;
  },
): void {
  if (!Number.isInteger(proof.timestamp) || proof.timestamp <= 0) {
    throw new TonProofVerificationError(
      "TON_PROOF_TIMESTAMP_INVALID",
      "TON proof timestamp is invalid.",
    );
  }

  const nowSeconds = Math.floor(options.now.getTime() / 1000);
  const ageSeconds = Math.abs(nowSeconds - proof.timestamp);

  if (ageSeconds > options.maxAgeSeconds) {
    throw new TonProofVerificationError(
      "TON_PROOF_EXPIRED",
      "TON proof timestamp is outside the accepted window.",
      {
        ageSeconds,
        maxAgeSeconds: options.maxAgeSeconds,
      },
    );
  }
}

async function resolveTonProofPublicKey(
  input: VerifyTonProofInput,
): Promise<{ bytes: Buffer; hex: string }> {
  const resolved =
    input.trustedPublicKey ??
    (input.resolvePublicKey
      ? await input.resolvePublicKey({
          account: input.account,
          proof: input.proof,
          expectedDomain: input.expectedDomain,
          expectedPayload: input.expectedPayload,
        })
      : null) ??
    (input.allowUntrustedAccountPublicKey ? input.account.publicKey : null);

  if (!resolved) {
    throw new TonProofVerificationError(
      "TON_PROOF_PUBLIC_KEY_UNRESOLVED",
      "Trusted TON wallet public key is required for proof verification.",
    );
  }

  const bytes = decodePublicKey(resolved);

  return {
    bytes,
    hex: bytes.toString("hex"),
  };
}

function decodeSignature(signature: string): Buffer {
  const decoded = decodeBase64Flexible(signature);

  if (decoded.length !== 64) {
    throw new TonProofVerificationError(
      "TON_PROOF_SIGNATURE_FORMAT_INVALID",
      "TON proof signature must be 64 bytes.",
    );
  }

  return decoded;
}

function decodePublicKey(value: string | Buffer | Uint8Array): Buffer {
  const bytes =
    typeof value === "string"
      ? decodePublicKeyString(value)
      : Buffer.from(value);

  if (bytes.length !== 32) {
    throw new TonProofVerificationError(
      "TON_PROOF_PUBLIC_KEY_FORMAT_INVALID",
      "TON wallet public key must be 32 bytes.",
    );
  }

  return bytes;
}

function decodePublicKeyString(value: string): Buffer {
  const normalized = value.trim();

  if (/^[a-fA-F0-9]{64}$/.test(normalized)) {
    return Buffer.from(normalized, "hex");
  }

  return decodeBase64Flexible(normalized);
}

function decodeBase64Flexible(value: string): Buffer {
  try {
    return Buffer.from(value, "base64");
  } catch {
    throw new TonProofVerificationError(
      "TON_PROOF_SIGNATURE_FORMAT_INVALID",
      "Invalid base64 value.",
    );
  }
}

function verifyEd25519(
  digest: Buffer,
  signature: Buffer,
  publicKey: Buffer,
): boolean {
  return verifySignature(
    null,
    digest,
    createEd25519PublicKey(publicKey),
    signature,
  );
}

function createEd25519PublicKey(rawPublicKey: Buffer): KeyObject {
  return createPublicKey({
    key: Buffer.concat([ED25519_SPKI_DER_PREFIX, rawPublicKey]),
    format: "der",
    type: "spki",
  });
}

function normalizeDomain(value: string): string {
  const trimmed = value.trim();

  if (!trimmed) {
    throw new TonProofVerificationError(
      "TON_PROOF_DOMAIN_INVALID",
      "TON proof domain is empty.",
    );
  }

  if (trimmed.startsWith("http://") || trimmed.startsWith("https://")) {
    return new URL(trimmed).hostname.toLowerCase();
  }

  return trimmed.toLowerCase();
}

function resolveVercelUrl(value: string | undefined): string | undefined {
  const trimmed = value?.trim();

  if (!trimmed) {
    return undefined;
  }

  if (trimmed.startsWith("http://") || trimmed.startsWith("https://")) {
    return trimmed;
  }

  return `https://${trimmed}`;
}

function sha256(value: Buffer): Buffer {
  return createHash("sha256").update(value).digest();
}

function stableStringify(value: unknown): string {
  return JSON.stringify(sortJson(value));
}

function sortJson(value: unknown): unknown {
  if (!value || typeof value !== "object") {
    return value;
  }

  if (Array.isArray(value)) {
    return value.map(sortJson);
  }

  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => [key, sortJson(item)]),
  );
}
