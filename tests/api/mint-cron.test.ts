import type { VercelRequest } from "@vercel/node";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { ApiError } from "../../api/_shared/handler";
import { assertCronRequest } from "../../api/_shared/cron";
import { runMintQueueWorker } from "../../api/cron/retry-mint-queue";
import { runOnchainTransactionSync } from "../../api/cron/sync-onchain-transactions";
import {
  buildMintQueryId,
  createTonNftService,
  parseNftItemAddressFromProviderPayload,
  parseNftItemIndexFromProviderPayload,
  TonNftProviderError,
  type TonNftProviderAdapter,
} from "../../packages/server/src/ton/nft";

const { callRpcRawMock } = vi.hoisted(() => ({
  callRpcRawMock: vi.fn(),
}));

vi.mock("../../packages/server/src/db/rpc.js", () => ({
  callRpcRaw: callRpcRawMock,
  RpcError: class RpcError extends Error {},
}));

const USER_ID = "11111111-1111-4111-8111-111111111111";
const WALLET_ID = "22222222-2222-4222-8222-222222222222";
const COLLECTION_ID = "33333333-3333-4333-8333-333333333333";
const ITEM_ID = "44444444-4444-4444-8444-444444444444";
const QUEUE_ID = "55555555-5555-4555-8555-555555555555";
const TX_ID = "66666666-6666-4666-8666-666666666666";
const TEMPLATE_ID = "77777777-7777-4777-8777-777777777777";
const RAW_ITEM_ADDRESS = `0:${"1".repeat(64)}`;
const RAW_OWNER_ADDRESS = `0:${"2".repeat(64)}`;
const RAW_COLLECTION_ADDRESS = `0:${"3".repeat(64)}`;

type QueryResult = {
  data?: unknown;
  error?: unknown;
};

type OperationState = {
  schema: string;
  table: string;
  operation: "select" | "update" | "insert" | "upsert";
  selected: string | null;
  payload: unknown;
  filters: Array<{
    column: string;
    operator: "eq" | "in" | "or";
    value: unknown;
  }>;
  orders: Array<{
    column: string;
    options: Record<string, unknown>;
  }>;
  limitValue: number | null;
};

describe("TON NFT provider adapter", () => {
  beforeEach(() => {
    vi.unstubAllGlobals();
  });

  it("parses provider NFT item fields without relying on frontend data", () => {
    expect(
      parseNftItemAddressFromProviderPayload({
        result: {
          nft: {
            item_address: RAW_ITEM_ADDRESS,
          },
        },
      }),
    ).toMatch(/^EQ|^UQ/);
    expect(
      parseNftItemIndexFromProviderPayload({
        data: {
          nft_item_index: "42",
        },
      }),
    ).toBe(42);
    expect(
      buildMintQueryId({
        mintQueueId: QUEUE_ID,
        attemptCount: 2,
      }),
    ).toBe(`mint:${QUEUE_ID}:2`);
  });

  it("refuses to submit when no server-side provider endpoint is configured", async () => {
    await expect(
      createTonNftService({
        env: {},
      }).submitMint({
        requestId: "req_missing_provider",
        queryId: "query-1",
        queue: {
          id: QUEUE_ID,
          userId: USER_ID,
          walletId: WALLET_ID,
          collectionId: COLLECTION_ID,
          itemInstanceId: ITEM_ID,
          templateId: TEMPLATE_ID,
          formId: null,
          attemptCount: 1,
          maxAttempts: 5,
          txHash: null,
          idempotencyKey: "idem-1",
          metadata: {},
        },
        collection: {
          id: COLLECTION_ID,
          network: "testnet",
          collectionAddress: RAW_COLLECTION_ADDRESS,
          ownerAddress: null,
          metadataUrl: null,
          contentBaseUrl: null,
          contractVersion: null,
          metadata: {},
        },
        wallet: {
          id: WALLET_ID,
          address: RAW_OWNER_ADDRESS,
          addressRaw: RAW_OWNER_ADDRESS,
          network: "testnet",
        },
        metadataUrl: null,
        metadata: {},
      }),
    ).rejects.toMatchObject({
      code: "TON_NFT_PROVIDER_NOT_CONFIGURED",
      retryable: false,
    });
  });
});

describe("cron auth", () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = {
      ...originalEnv,
      NODE_ENV: "production",
      APP_ENV: "production",
      CRON_SECRET: "cron-secret",
    };
  });

  it("rejects missing bearer secret", () => {
    expect(() =>
      assertCronRequest({
        headers: {},
      } as VercelRequest),
    ).toThrow(ApiError);
  });
});

describe("Mint queue worker", () => {
  beforeEach(() => {
    callRpcRawMock.mockReset();
  });

  it("claims a queued row, submits through the provider and records a pending transaction", async () => {
    const queued = mintQueueRow({
      status: "queued",
      attempt_count: 0,
    });
    const claimed = mintQueueRow({
      status: "processing",
      attempt_count: 1,
      metadata: {
        metadata_url: "/nft-metadata/items/test.json",
        metadata_snapshot: {
          name: "Test NFT",
        },
        mint_worker: {
          query_id: `mint:${QUEUE_ID}:1`,
        },
      },
    });
    const db = createSupabaseQueryMock([
      {
        data: [queued],
      },
      {
        data: claimed,
      },
      {
        data: collectionRow(),
      },
      {
        data: walletRow(),
      },
      {
        data: null,
      },
      {},
      {},
    ]);
    const provider = createProviderMock({
      submitMint: vi.fn().mockResolvedValue({
        status: "confirming",
        txHash: "tx_hash_001",
        queryId: `mint:${QUEUE_ID}:1`,
        itemAddress: null,
        itemIndex: null,
        ownerAddress: null,
        metadataUrl: null,
        rawResponse: {
          ok: true,
        },
        externalApiProvider: "mock-ton-provider",
        submittedAt: "2026-05-29T08:00:01.000Z",
      }),
    });

    const result = await runMintQueueWorker({
      db: db.client,
      provider,
      requestId: "req_worker_success",
      env: {
        TON_MINT_BATCH_SIZE: "10",
        TON_MINT_RETRY_DELAY_SECONDS: "60",
      },
      now: new Date("2026-05-29T08:00:00.000Z"),
    });

    expect(result).toMatchObject({
      scanned: 1,
      claimed: 1,
      confirming: 1,
      retrying: 0,
      manualReview: 0,
    });
    expect(provider.submitMint).toHaveBeenCalledWith(
      expect.objectContaining({
        queryId: `mint:${QUEUE_ID}:1`,
        metadataUrl: "/nft-metadata/items/test.json",
      }),
    );
    expect(
      db.operations.find(
        (operation) =>
          operation.operation === "upsert" &&
          operation.table === "transactions",
      )?.payload,
    ).toMatchObject({
      tx_hash: "tx_hash_001",
      query_id: `mint:${QUEUE_ID}:1`,
      status: "pending",
      related_type: "mint_queue",
      related_id: QUEUE_ID,
    });
    expect(lastMintQueueUpdate(db.operations)).toMatchObject({
      status: "confirming",
      tx_hash: "tx_hash_001",
    });
  });

  it("moves retryable provider failures to retrying before max attempts", async () => {
    const queued = mintQueueRow({
      status: "queued",
      attempt_count: 0,
      max_attempts: 3,
    });
    const claimed = mintQueueRow({
      status: "processing",
      attempt_count: 1,
      max_attempts: 3,
    });
    const db = createSupabaseQueryMock([
      {
        data: [queued],
      },
      {
        data: claimed,
      },
      {
        data: collectionRow(),
      },
      {
        data: walletRow(),
      },
      {},
    ]);
    const provider = createProviderMock({
      submitMint: vi.fn().mockRejectedValue(
        new TonNftProviderError("TON_API_UNAVAILABLE", "provider unavailable", {
          retryable: true,
        }),
      ),
    });

    const result = await runMintQueueWorker({
      db: db.client,
      provider,
      requestId: "req_worker_retry",
      env: {
        TON_MINT_RETRY_DELAY_SECONDS: "60",
        TON_MINT_RETRY_BACKOFF_MULTIPLIER: "1",
      },
      now: new Date("2026-05-29T08:00:00.000Z"),
    });

    expect(result.retrying).toBe(1);
    expect(lastMintQueueUpdate(db.operations)).toMatchObject({
      status: "retrying",
      error_message: "provider unavailable",
      next_attempt_at: "2026-05-29T08:01:00.000Z",
    });
  });

  it("moves exhausted failures to manual review", async () => {
    const queued = mintQueueRow({
      status: "retrying",
      attempt_count: 4,
      max_attempts: 5,
    });
    const claimed = mintQueueRow({
      status: "processing",
      attempt_count: 5,
      max_attempts: 5,
    });
    const db = createSupabaseQueryMock([
      {
        data: [queued],
      },
      {
        data: claimed,
      },
      {
        data: collectionRow(),
      },
      {
        data: walletRow(),
      },
      {},
    ]);
    const provider = createProviderMock({
      submitMint: vi.fn().mockRejectedValue(
        new TonNftProviderError("TON_API_UNAVAILABLE", "provider unavailable", {
          retryable: true,
        }),
      ),
    });

    const result = await runMintQueueWorker({
      db: db.client,
      provider,
      requestId: "req_worker_manual",
      env: {
        TON_MINT_RETRY_DELAY_SECONDS: "60",
      },
      now: new Date("2026-05-29T08:00:00.000Z"),
    });

    expect(result.manualReview).toBe(1);
    expect(lastMintQueueUpdate(db.operations)).toMatchObject({
      status: "manual_review",
      next_attempt_at: null,
    });
  });
});

describe("onchain transaction sync", () => {
  beforeEach(() => {
    callRpcRawMock.mockReset();
    callRpcRawMock.mockResolvedValue({
      status: "minted",
      idempotent: false,
    });
  });

  it("marks a confirmed Mint transaction through the success RPC", async () => {
    const db = createSupabaseQueryMock([
      {
        data: [transactionRow()],
      },
      {
        data: mintQueueRow({
          status: "confirming",
          attempt_count: 1,
        }),
      },
      {
        data: collectionRow(),
      },
      {
        data: walletRow(),
      },
      {},
    ]);
    const provider = createProviderMock({
      queryTransaction: vi.fn().mockResolvedValue({
        status: "confirmed",
        txHash: "tx_hash_001",
        queryId: `mint:${QUEUE_ID}:1`,
        itemAddress: RAW_ITEM_ADDRESS,
        itemIndex: 7,
        ownerAddress: RAW_OWNER_ADDRESS,
        metadataUrl: "/nft-metadata/items/test.json",
        errorMessage: null,
        rawResponse: {
          ok: true,
        },
        externalApiProvider: "mock-ton-provider",
        checkedAt: "2026-05-29T08:05:00.000Z",
      }),
    });

    const result = await runOnchainTransactionSync({
      db: db.client,
      provider,
      requestId: "req_sync_confirmed",
      env: {},
      now: new Date("2026-05-29T08:05:00.000Z"),
    });

    expect(result).toMatchObject({
      scanned: 1,
      checked: 1,
      confirmed: 1,
    });
    expect(callRpcRawMock).toHaveBeenCalledWith(
      "onchain_mark_mint_success",
      expect.objectContaining({
        p_mint_queue_id: QUEUE_ID,
        p_item_index: 7,
        p_tx_hash: "tx_hash_001",
      }),
      expect.objectContaining({
        schema: "api",
      }),
    );
    expect(
      db.operations.find(
        (operation) =>
          operation.operation === "update" &&
          operation.table === "transactions",
      )?.payload,
    ).toMatchObject({
      status: "confirmed",
      check_count: 1,
    });
  });
});

function createProviderMock(
  overrides: Partial<TonNftProviderAdapter> = {},
): TonNftProviderAdapter & {
  submitMint: ReturnType<typeof vi.fn>;
  queryTransaction: ReturnType<typeof vi.fn>;
} {
  return {
    submitMint: vi.fn(),
    queryTransaction: vi.fn(),
    ...overrides,
  } as TonNftProviderAdapter & {
    submitMint: ReturnType<typeof vi.fn>;
    queryTransaction: ReturnType<typeof vi.fn>;
  };
}

function mintQueueRow(
  overrides: Partial<Record<string, unknown>> = {},
): Record<string, unknown> {
  return {
    id: QUEUE_ID,
    user_id: USER_ID,
    wallet_id: WALLET_ID,
    collection_id: COLLECTION_ID,
    item_instance_id: ITEM_ID,
    template_id: TEMPLATE_ID,
    form_id: null,
    status: "queued",
    priority: 100,
    attempt_count: 0,
    max_attempts: 5,
    next_attempt_at: "2026-05-29T08:00:00.000Z",
    nft_item_id: null,
    tx_hash: null,
    error_message: null,
    idempotency_key: "mint-idem-001",
    metadata: {
      metadata_url: "/nft-metadata/items/test.json",
      metadata_snapshot: {
        name: "Test NFT",
      },
    },
    created_at: "2026-05-29T08:00:00.000Z",
    updated_at: "2026-05-29T08:00:00.000Z",
    completed_at: null,
    ...overrides,
  };
}

function collectionRow(): Record<string, unknown> {
  return {
    id: COLLECTION_ID,
    network: "testnet",
    collection_address: RAW_COLLECTION_ADDRESS,
    owner_address: null,
    metadata_url: "/nft-metadata/collection.json",
    content_base_url: "/nft-metadata/items",
    contract_version: null,
    metadata: {},
  };
}

function walletRow(): Record<string, unknown> {
  return {
    id: WALLET_ID,
    address: RAW_OWNER_ADDRESS,
    address_raw: RAW_OWNER_ADDRESS,
    network: "testnet",
  };
}

function transactionRow(): Record<string, unknown> {
  return {
    id: TX_ID,
    network: "testnet",
    tx_hash: "tx_hash_001",
    query_id: `mint:${QUEUE_ID}:1`,
    user_id: USER_ID,
    wallet_id: WALLET_ID,
    related_type: "mint_queue",
    related_id: QUEUE_ID,
    status: "pending",
    payload: {},
    raw_response: {},
    external_api_provider: "mock-ton-provider",
    error_message: null,
    submitted_at: "2026-05-29T08:00:00.000Z",
    confirmed_at: null,
    last_checked_at: null,
    check_count: 0,
    created_at: "2026-05-29T08:00:00.000Z",
  };
}

function lastMintQueueUpdate(
  operations: OperationState[],
): Record<string, unknown> | null {
  const operation = operations
    .filter(
      (item) => item.operation === "update" && item.table === "mint_queue",
    )
    .at(-1);

  return isRecord(operation?.payload) ? operation.payload : null;
}

function createSupabaseQueryMock(results: QueryResult[]) {
  const operations: OperationState[] = [];
  let resultIndex = 0;

  function nextResult(): QueryResult {
    const result = results[resultIndex] ?? {
      data: null,
      error: null,
    };
    resultIndex += 1;

    return {
      data: result.data ?? null,
      error: result.error ?? null,
    };
  }

  function createBuilder(state: OperationState) {
    const builder = {
      select(columns: string) {
        state.selected = columns;
        return builder;
      },
      eq(column: string, value: unknown) {
        state.filters.push({
          column,
          operator: "eq",
          value,
        });
        return builder;
      },
      in(column: string, value: unknown[]) {
        state.filters.push({
          column,
          operator: "in",
          value,
        });
        return builder;
      },
      or(value: string) {
        state.filters.push({
          column: "or",
          operator: "or",
          value,
        });
        return builder;
      },
      order(column: string, options: Record<string, unknown>) {
        state.orders.push({
          column,
          options,
        });
        return builder;
      },
      limit(value: number) {
        state.limitValue = value;
        return builder;
      },
      maybeSingle() {
        return Promise.resolve(nextResult());
      },
      then(
        resolve: (value: QueryResult) => unknown,
        reject?: (reason: unknown) => unknown,
      ) {
        return Promise.resolve(nextResult()).then(resolve, reject);
      },
    };

    return builder;
  }

  const client = {
    schema(schema: string) {
      return {
        from(table: string) {
          return {
            select(columns: string) {
              const state = createOperation(schema, table, "select", null);
              state.selected = columns;
              operations.push(state);
              return createBuilder(state);
            },
            update(payload: unknown) {
              const state = createOperation(schema, table, "update", payload);
              operations.push(state);
              return createBuilder(state);
            },
            insert(payload: unknown) {
              const state = createOperation(schema, table, "insert", payload);
              operations.push(state);
              return createBuilder(state);
            },
            upsert(payload: unknown) {
              const state = createOperation(schema, table, "upsert", payload);
              operations.push(state);
              return createBuilder(state);
            },
          };
        },
      };
    },
  };

  return {
    client: client as never,
    operations,
  };
}

function createOperation(
  schema: string,
  table: string,
  operation: OperationState["operation"],
  payload: unknown,
): OperationState {
  return {
    schema,
    table,
    operation,
    selected: null,
    payload,
    filters: [],
    orders: [],
    limitValue: null,
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
