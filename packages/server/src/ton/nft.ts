import { Address } from "@ton/ton";

export type JsonRecord = Record<string, unknown>;

export type TonNftProviderOperation =
  | "mint_collection_item"
  | "query_transaction_status"
  | "query_wallet_nfts";

export interface TonNftMintQueueContext {
  id: string;
  userId: string;
  walletId: string | null;
  collectionId: string;
  itemInstanceId: string;
  templateId: string;
  formId: string | null;
  attemptCount: number;
  maxAttempts: number;
  txHash: string | null;
  idempotencyKey: string;
  metadata: JsonRecord;
}

export interface TonNftCollectionContext {
  id: string;
  network: "mainnet" | "testnet";
  collectionAddress: string;
  ownerAddress: string | null;
  metadataUrl: string | null;
  contentBaseUrl: string | null;
  contractVersion: string | null;
  metadata: JsonRecord;
}

export interface TonNftWalletContext {
  id: string;
  address: string;
  addressRaw: string | null;
  network: "mainnet" | "testnet";
}

export type TonNftWalletSyncMode = "INCREMENTAL" | "FULL";

export interface TonNftWalletQueryInput {
  requestId: string;
  wallet: TonNftWalletContext;
  mode: TonNftWalletSyncMode;
  collectionAddress?: string | null | undefined;
  cursor?: string | null | undefined;
  limit?: number | null | undefined;
  rawPayload?: JsonRecord | undefined;
}

export interface TonNftWalletItem {
  itemAddress: string;
  collectionAddress: string | null;
  ownerAddress: string;
  itemIndex: number | null;
  metadataUrl: string | null;
  name: string | null;
  imageUrl: string | null;
  rawPayload: JsonRecord;
}

export interface TonNftWalletQueryResult {
  items: TonNftWalletItem[];
  nextCursor: string | null;
  rawResponse: JsonRecord;
  externalApiProvider: string;
  checkedAt: string;
}

export interface TonNftSubmitMintInput {
  requestId: string;
  queryId: string;
  queue: TonNftMintQueueContext;
  collection: TonNftCollectionContext;
  wallet: TonNftWalletContext;
  metadataUrl: string | null;
  metadata: JsonRecord;
}

export type TonNftSubmitMintStatus = "submitted" | "confirming" | "minted";

export interface TonNftSubmitMintResult {
  status: TonNftSubmitMintStatus;
  txHash: string | null;
  queryId: string | null;
  itemAddress: string | null;
  itemIndex: number | null;
  ownerAddress: string | null;
  metadataUrl: string | null;
  rawResponse: JsonRecord;
  externalApiProvider: string;
  submittedAt: string | null;
}

export interface TonNftTransactionQueryInput {
  requestId: string;
  transactionId?: string | undefined;
  txHash?: string | null | undefined;
  queryId?: string | null | undefined;
  network: "mainnet" | "testnet";
  collectionAddress?: string | null | undefined;
  relatedId?: string | null | undefined;
  rawPayload?: JsonRecord | undefined;
}

export type TonNftTransactionQueryStatus =
  | "pending"
  | "confirmed"
  | "failed"
  | "expired";

export interface TonNftTransactionQueryResult {
  status: TonNftTransactionQueryStatus;
  txHash: string | null;
  queryId: string | null;
  itemAddress: string | null;
  itemIndex: number | null;
  ownerAddress: string | null;
  metadataUrl: string | null;
  errorMessage: string | null;
  rawResponse: JsonRecord;
  externalApiProvider: string;
  checkedAt: string;
}

export interface TonNftProviderAdapter {
  submitMint(input: TonNftSubmitMintInput): Promise<TonNftSubmitMintResult>;
  queryTransaction(
    input: TonNftTransactionQueryInput,
  ): Promise<TonNftTransactionQueryResult>;
  queryWalletNfts(
    input: TonNftWalletQueryInput,
  ): Promise<TonNftWalletQueryResult>;
}

export interface CreateTonNftServiceOptions {
  env?: NodeJS.ProcessEnv | undefined;
  provider?: TonNftProviderAdapter | undefined;
}

export class TonNftProviderError extends Error {
  readonly code: string;
  readonly retryable: boolean;
  readonly submissionUncertain: boolean;
  readonly rawResponse?: unknown;

  constructor(
    code: string,
    message: string,
    options: {
      retryable?: boolean | undefined;
      submissionUncertain?: boolean | undefined;
      rawResponse?: unknown;
      cause?: unknown;
    } = {},
  ) {
    super(message);
    this.name = "TonNftProviderError";
    this.code = code;
    this.retryable = options.retryable ?? true;
    this.submissionUncertain = options.submissionUncertain ?? false;
    this.rawResponse = options.rawResponse;
    defineErrorCause(this, options.cause);
  }
}

const DEFAULT_PROVIDER_TIMEOUT_MS = 15_000;
const MAX_PROVIDER_TIMEOUT_MS = 60_000;

export function createTonNftService(
  options: CreateTonNftServiceOptions = {},
): TonNftProviderAdapter {
  return (
    options.provider ??
    createHttpTonNftProviderAdapter({
      env: options.env ?? process.env,
    })
  );
}

export function createHttpTonNftProviderAdapter(options: {
  env?: NodeJS.ProcessEnv | undefined;
}): TonNftProviderAdapter {
  const env = options.env ?? process.env;

  return {
    submitMint(input) {
      const endpoint = readProviderEndpoint(env, "submit");
      return postProviderJson<TonNftSubmitMintResult>({
        endpoint,
        env,
        operation: "mint_collection_item",
        body: buildSubmitMintProviderPayload(input),
        normalize: normalizeSubmitMintResult,
        submissionUncertainOnAbort: true,
      });
    },
    queryTransaction(input) {
      const endpoint = readProviderEndpoint(env, "query");
      return postProviderJson<TonNftTransactionQueryResult>({
        endpoint,
        env,
        operation: "query_transaction_status",
        body: buildQueryTransactionProviderPayload(input),
        normalize: normalizeTransactionQueryResult,
        submissionUncertainOnAbort: false,
      });
    },
    queryWalletNfts(input) {
      const endpoint = readProviderEndpoint(env, "wallet_nfts");
      return postProviderJson<TonNftWalletQueryResult>({
        endpoint,
        env,
        operation: "query_wallet_nfts",
        body: buildWalletNftsProviderPayload(input),
        normalize: (payload, provider) =>
          normalizeWalletNftsQueryResult(
            payload,
            provider,
            input.wallet.address,
          ),
        submissionUncertainOnAbort: false,
      });
    },
  };
}

export function normalizeTonAddress(
  value: string | null | undefined,
): string | null {
  const normalized = value?.trim();

  if (!normalized) {
    return null;
  }

  try {
    return Address.parse(normalized).toString();
  } catch {
    return null;
  }
}

export function normalizeTonRawAddress(
  value: string | null | undefined,
): string | null {
  const normalized = value?.trim();

  if (!normalized) {
    return null;
  }

  try {
    return Address.parse(normalized).toRawString();
  } catch {
    return null;
  }
}

export function buildMintQueryId(input: {
  mintQueueId: string;
  attemptCount: number;
}): string {
  return `mint:${input.mintQueueId}:${Math.max(1, input.attemptCount)}`;
}

export function parseNftItemAddressFromProviderPayload(
  payload: unknown,
): string | null {
  return findFirstTonAddress(payload, [
    "item_address",
    "itemAddress",
    "nft_item_address",
    "nftItemAddress",
    "nft_address",
    "nftAddress",
  ]);
}

export function parseNftItemIndexFromProviderPayload(
  payload: unknown,
): number | null {
  const value = findFirstProviderValue(payload, [
    "item_index",
    "itemIndex",
    "nft_item_index",
    "nftItemIndex",
    "index",
  ]);

  return normalizeNonNegativeSafeInteger(value);
}

function buildSubmitMintProviderPayload(
  input: TonNftSubmitMintInput,
): JsonRecord {
  return {
    operation: "mint_collection_item",
    request_id: input.requestId,
    query_id: input.queryId,
    mint_queue_id: input.queue.id,
    idempotency_key: input.queue.idempotencyKey,
    attempt_count: input.queue.attemptCount,
    collection: {
      id: input.collection.id,
      network: input.collection.network,
      collection_address: input.collection.collectionAddress,
      collection_address_raw: normalizeTonRawAddress(
        input.collection.collectionAddress,
      ),
      owner_address: input.collection.ownerAddress,
      metadata_url: input.collection.metadataUrl,
      content_base_url: input.collection.contentBaseUrl,
      contract_version: input.collection.contractVersion,
      metadata: input.collection.metadata,
    },
    target_wallet: {
      id: input.wallet.id,
      address: input.wallet.address,
      address_raw:
        input.wallet.addressRaw ?? normalizeTonRawAddress(input.wallet.address),
      network: input.wallet.network,
    },
    item: {
      item_instance_id: input.queue.itemInstanceId,
      template_id: input.queue.templateId,
      form_id: input.queue.formId,
      metadata_url: input.metadataUrl,
      metadata: input.metadata,
    },
  };
}

function buildQueryTransactionProviderPayload(
  input: TonNftTransactionQueryInput,
): JsonRecord {
  return {
    operation: "query_transaction_status",
    request_id: input.requestId,
    transaction_id: input.transactionId,
    tx_hash: input.txHash,
    query_id: input.queryId,
    network: input.network,
    collection_address: input.collectionAddress,
    related_id: input.relatedId,
    raw_payload: input.rawPayload ?? {},
  };
}

function buildWalletNftsProviderPayload(
  input: TonNftWalletQueryInput,
): JsonRecord {
  return {
    operation: "query_wallet_nfts",
    request_id: input.requestId,
    mode: input.mode,
    cursor: input.cursor ?? null,
    limit: input.limit ?? null,
    collection_address: input.collectionAddress ?? null,
    wallet: {
      id: input.wallet.id,
      address: input.wallet.address,
      address_raw:
        input.wallet.addressRaw ?? normalizeTonRawAddress(input.wallet.address),
      network: input.wallet.network,
    },
    raw_payload: input.rawPayload ?? {},
  };
}

async function postProviderJson<TResult>(input: {
  endpoint: string | null;
  env: NodeJS.ProcessEnv;
  operation: TonNftProviderOperation;
  body: JsonRecord;
  normalize: (payload: unknown, provider: string) => TResult;
  submissionUncertainOnAbort: boolean;
}): Promise<TResult> {
  if (!input.endpoint) {
    throw new TonNftProviderError(
      "TON_NFT_PROVIDER_NOT_CONFIGURED",
      "TON NFT provider endpoint is not configured.",
      {
        retryable: false,
      },
    );
  }

  const controller = new AbortController();
  const timeout = setTimeout(
    () => controller.abort(),
    readProviderTimeoutMs(input.env),
  );
  const provider = readProviderName(input.env, input.endpoint);

  try {
    const response = await fetch(input.endpoint, {
      method: "POST",
      headers: buildProviderHeaders(input.env),
      body: JSON.stringify(input.body),
      signal: controller.signal,
    });
    const payload = await readJsonPayload(response);

    if (!response.ok) {
      throw new TonNftProviderError(
        "TON_NFT_PROVIDER_HTTP_ERROR",
        `TON NFT provider returned HTTP ${response.status}.`,
        {
          retryable: response.status >= 500 || response.status === 429,
          rawResponse: payload,
        },
      );
    }

    return input.normalize(payload, provider);
  } catch (error) {
    if (error instanceof TonNftProviderError) {
      throw error;
    }

    const isAbort =
      error instanceof Error &&
      (error.name === "AbortError" || error.message.includes("aborted"));

    throw new TonNftProviderError(
      isAbort ? "TON_NFT_PROVIDER_TIMEOUT" : "TON_NFT_PROVIDER_REQUEST_FAILED",
      isAbort
        ? "TON NFT provider request timed out."
        : "TON NFT provider request failed.",
      {
        retryable: true,
        submissionUncertain: isAbort && input.submissionUncertainOnAbort,
        cause: error,
      },
    );
  } finally {
    clearTimeout(timeout);
  }
}

function normalizeSubmitMintResult(
  payload: unknown,
  provider: string,
): TonNftSubmitMintResult {
  const root = unwrapProviderPayload(payload);
  const status = normalizeSubmitStatus(
    readString(root.status) ?? readString(root.state),
    root,
  );
  const txHash = readString(root.tx_hash) ?? readString(root.txHash);
  const queryId = readString(root.query_id) ?? readString(root.queryId);
  const itemAddress = parseNftItemAddressFromProviderPayload(root);
  const itemIndex = parseNftItemIndexFromProviderPayload(root);
  const ownerAddress =
    normalizeTonAddress(
      readString(root.owner_address) ?? readString(root.ownerAddress),
    ) ?? null;
  const metadataUrl =
    readString(root.metadata_url) ?? readString(root.metadataUrl);

  if (
    (status === "submitted" || status === "confirming") &&
    !txHash &&
    !queryId
  ) {
    throw new TonNftProviderError(
      "TON_NFT_SUBMIT_RESULT_INVALID",
      "Mint submit result is missing tx_hash and query_id.",
      {
        retryable: false,
        rawResponse: payload,
      },
    );
  }

  if (status === "minted" && (!txHash || !itemAddress || itemIndex === null)) {
    throw new TonNftProviderError(
      "TON_NFT_MINTED_RESULT_INVALID",
      "Minted result is missing tx_hash, item_address or item_index.",
      {
        retryable: false,
        rawResponse: payload,
      },
    );
  }

  return {
    status,
    txHash,
    queryId,
    itemAddress,
    itemIndex,
    ownerAddress,
    metadataUrl,
    rawResponse: toJsonRecord(payload),
    externalApiProvider:
      readString(root.external_api_provider) ??
      readString(root.externalApiProvider) ??
      provider,
    submittedAt:
      readString(root.submitted_at) ?? readString(root.submittedAt) ?? null,
  };
}

function normalizeTransactionQueryResult(
  payload: unknown,
  provider: string,
): TonNftTransactionQueryResult {
  const root = unwrapProviderPayload(payload);
  const status = normalizeTransactionStatus(
    readString(root.status) ?? readString(root.state),
  );
  const txHash = readString(root.tx_hash) ?? readString(root.txHash);
  const queryId = readString(root.query_id) ?? readString(root.queryId);
  const itemAddress = parseNftItemAddressFromProviderPayload(root);
  const itemIndex = parseNftItemIndexFromProviderPayload(root);
  const ownerAddress =
    normalizeTonAddress(
      readString(root.owner_address) ?? readString(root.ownerAddress),
    ) ?? null;

  return {
    status,
    txHash,
    queryId,
    itemAddress,
    itemIndex,
    ownerAddress,
    metadataUrl:
      readString(root.metadata_url) ?? readString(root.metadataUrl) ?? null,
    errorMessage:
      readString(root.error_message) ?? readString(root.errorMessage) ?? null,
    rawResponse: toJsonRecord(payload),
    externalApiProvider:
      readString(root.external_api_provider) ??
      readString(root.externalApiProvider) ??
      provider,
    checkedAt:
      readString(root.checked_at) ??
      readString(root.checkedAt) ??
      new Date().toISOString(),
  };
}

function normalizeWalletNftsQueryResult(
  payload: unknown,
  provider: string,
  fallbackOwnerAddress: string,
): TonNftWalletQueryResult {
  const root = unwrapProviderPayload(payload);
  const values = readProviderArray(payload, root, [
    "items",
    "nfts",
    "wallet_nfts",
    "walletNfts",
    "nft_items",
    "nftItems",
  ]);
  const fallbackOwner = normalizeTonAddress(fallbackOwnerAddress);
  const items = values
    .map((value) => normalizeWalletNftItem(value, fallbackOwner))
    .filter((item): item is TonNftWalletItem => item !== null);

  return {
    items,
    nextCursor:
      readString(root.next_cursor) ??
      readString(root.nextCursor) ??
      readString(root.cursor) ??
      null,
    rawResponse: toJsonRecord(payload),
    externalApiProvider:
      readString(root.external_api_provider) ??
      readString(root.externalApiProvider) ??
      provider,
    checkedAt:
      readString(root.checked_at) ??
      readString(root.checkedAt) ??
      new Date().toISOString(),
  };
}

function normalizeWalletNftItem(
  value: unknown,
  fallbackOwnerAddress: string | null,
): TonNftWalletItem | null {
  const itemAddress = findFirstTonAddress(value, [
    "item_address",
    "itemAddress",
    "nft_item_address",
    "nftItemAddress",
    "nft_address",
    "nftAddress",
    "address",
  ]);
  const ownerAddress =
    findFirstTonAddress(value, [
      "owner_address",
      "ownerAddress",
      "owner",
      "current_owner",
      "currentOwner",
    ]) ?? fallbackOwnerAddress;

  if (!itemAddress || !ownerAddress) {
    return null;
  }

  const metadataUrlValue = findFirstProviderValue(value, [
    "metadata_url",
    "metadataUrl",
    "content_url",
    "contentUrl",
    "uri",
  ]);
  const nameValue = findFirstProviderValue(value, ["name", "display_name"]);
  const imageValue = findFirstProviderValue(value, [
    "image_url",
    "imageUrl",
    "image",
    "thumbnail_url",
    "thumbnailUrl",
  ]);

  return {
    itemAddress,
    collectionAddress: findFirstTonAddress(value, [
      "collection_address",
      "collectionAddress",
      "collection",
      "collection_contract",
      "collectionContract",
    ]),
    ownerAddress,
    itemIndex: parseNftItemIndexFromProviderPayload(value),
    metadataUrl: readString(metadataUrlValue),
    name: readString(nameValue),
    imageUrl: readString(imageValue),
    rawPayload: toJsonRecord(value),
  };
}

function normalizeSubmitStatus(
  value: string | null,
  payload: JsonRecord,
): TonNftSubmitMintStatus {
  const normalized = value?.trim().toLowerCase();

  if (
    normalized === "submitted" ||
    normalized === "sent" ||
    normalized === "pending"
  ) {
    return "submitted";
  }

  if (
    normalized === "confirming" ||
    normalized === "waiting_confirmation" ||
    normalized === "waiting_chain_confirmation"
  ) {
    return "confirming";
  }

  if (normalized === "minted" || normalized === "confirmed") {
    return "minted";
  }

  if (parseNftItemAddressFromProviderPayload(payload)) {
    return "minted";
  }

  if (readString(payload.tx_hash) || readString(payload.txHash)) {
    return "confirming";
  }

  throw new TonNftProviderError(
    "TON_NFT_SUBMIT_STATUS_INVALID",
    "Mint submit result has an invalid status.",
    {
      retryable: false,
      rawResponse: payload,
    },
  );
}

function normalizeTransactionStatus(
  value: string | null,
): TonNftTransactionQueryStatus {
  const normalized = value?.trim().toLowerCase();

  if (
    normalized === "pending" ||
    normalized === "submitted" ||
    normalized === "confirming" ||
    normalized === "sent"
  ) {
    return "pending";
  }

  if (normalized === "confirmed" || normalized === "minted") {
    return "confirmed";
  }

  if (normalized === "failed" || normalized === "reverted") {
    return "failed";
  }

  if (normalized === "expired" || normalized === "timeout") {
    return "expired";
  }

  throw new TonNftProviderError(
    "TON_NFT_TRANSACTION_STATUS_INVALID",
    "Transaction query result has an invalid status.",
    {
      retryable: false,
      rawResponse: {
        status: value,
      },
    },
  );
}

function readProviderEndpoint(
  env: NodeJS.ProcessEnv,
  mode: "submit" | "query" | "wallet_nfts",
): string | null {
  const explicit =
    mode === "submit"
      ? (env.TON_NFT_MINT_PROVIDER_URL ?? env.TON_MINT_PROVIDER_URL)
      : mode === "query"
        ? (env.TON_NFT_TX_PROVIDER_URL ??
          env.TON_TRANSACTION_PROVIDER_URL ??
          env.TON_MINT_PROVIDER_URL)
        : (env.TON_NFT_WALLET_SYNC_PROVIDER_URL ??
          env.TON_WALLET_NFT_PROVIDER_URL ??
          env.TON_NFT_SYNC_PROVIDER_URL);

  return normalizeUrl(explicit);
}

function readProviderTimeoutMs(env: NodeJS.ProcessEnv): number {
  const value = Number.parseInt(env.TON_MINT_PROVIDER_TIMEOUT_MS ?? "", 10);

  if (!Number.isFinite(value) || value <= 0) {
    return DEFAULT_PROVIDER_TIMEOUT_MS;
  }

  return Math.min(value, MAX_PROVIDER_TIMEOUT_MS);
}

function readProviderName(env: NodeJS.ProcessEnv, endpoint: string): string {
  const explicit = readString(env.TON_NFT_PROVIDER_NAME);

  if (explicit) {
    return explicit;
  }

  try {
    return new URL(endpoint).host;
  } catch {
    return "ton-nft-provider";
  }
}

function buildProviderHeaders(env: NodeJS.ProcessEnv): Record<string, string> {
  const headers: Record<string, string> = {
    "content-type": "application/json",
  };
  const token =
    readString(env.TON_NFT_PROVIDER_TOKEN) ??
    readString(env.TON_MINT_PROVIDER_TOKEN);

  if (token) {
    headers.authorization = `Bearer ${token}`;
  }

  return headers;
}

async function readJsonPayload(response: Response): Promise<unknown> {
  const text = await response.text();

  if (!text.trim()) {
    return {};
  }

  try {
    return JSON.parse(text) as unknown;
  } catch {
    return {
      raw_text: text,
    };
  }
}

function unwrapProviderPayload(payload: unknown): JsonRecord {
  const root = toJsonRecord(payload);
  const data = root.data;
  const result = root.result;

  if (isRecord(data)) {
    return data;
  }

  if (isRecord(result)) {
    return result;
  }

  return root;
}

function readProviderArray(
  payload: unknown,
  root: JsonRecord,
  keys: string[],
): unknown[] {
  if (Array.isArray(payload)) {
    return payload;
  }

  for (const key of keys) {
    const value = root[key];

    if (Array.isArray(value)) {
      return value;
    }
  }

  const nestedValue = findFirstProviderValue(root, keys);

  return Array.isArray(nestedValue) ? nestedValue : [];
}

function findFirstTonAddress(payload: unknown, keys: string[]): string | null {
  const value = findFirstProviderValue(payload, keys);

  return typeof value === "string" ? normalizeTonAddress(value) : null;
}

function findFirstProviderValue(
  payload: unknown,
  keys: string[],
  depth = 0,
): unknown {
  if (depth > 4 || !isRecord(payload)) {
    return undefined;
  }

  for (const key of keys) {
    if (key in payload) {
      return payload[key];
    }
  }

  for (const value of Object.values(payload)) {
    if (isRecord(value)) {
      const nested = findFirstProviderValue(value, keys, depth + 1);

      if (nested !== undefined) {
        return nested;
      }
    }
  }

  return undefined;
}

function normalizeNonNegativeSafeInteger(value: unknown): number | null {
  const numberValue =
    typeof value === "number"
      ? value
      : typeof value === "string"
        ? Number.parseInt(value, 10)
        : NaN;

  if (
    !Number.isSafeInteger(numberValue) ||
    numberValue < 0 ||
    !Number.isFinite(numberValue)
  ) {
    return null;
  }

  return numberValue;
}

function normalizeUrl(value: string | undefined): string | null {
  const normalized = value?.trim();

  if (!normalized) {
    return null;
  }

  try {
    return new URL(normalized).toString();
  } catch {
    throw new TonNftProviderError(
      "TON_NFT_PROVIDER_URL_INVALID",
      "TON NFT provider URL is invalid.",
      {
        retryable: false,
      },
    );
  }
}

function readString(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }

  const trimmed = value.trim();

  return trimmed.length > 0 ? trimmed : null;
}

function toJsonRecord(value: unknown): JsonRecord {
  if (isRecord(value)) {
    return value;
  }

  return {
    value,
  };
}

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function defineErrorCause(error: Error, cause: unknown): void {
  if (cause === undefined) {
    return;
  }

  Object.defineProperty(error, "cause", {
    configurable: true,
    enumerable: false,
    writable: true,
    value: cause,
  });
}
