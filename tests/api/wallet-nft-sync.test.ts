import { beforeEach, describe, expect, it, vi } from "vitest";

import type {
  ApiErrorResponse,
  ApiSuccessResponse,
} from "../../api/_shared/handler";
import { ApiError } from "../../api/_shared/handler";
import { TonNftProviderError } from "../../packages/server/src/ton/nft";
import { invokeApiHandler } from "./_utils";

const { callRpcRawMock, getSupabaseAdminClientMock, requireSessionMock } =
  vi.hoisted(() => ({
    callRpcRawMock: vi.fn(),
    getSupabaseAdminClientMock: vi.fn(),
    requireSessionMock: vi.fn(),
  }));

vi.mock("../../packages/server/src/db/supabaseAdmin.js", () => ({
  getSupabaseAdminClient: getSupabaseAdminClientMock,
}));

vi.mock("../../packages/server/src/db/rpc.js", () => ({
  callRpcRaw: callRpcRawMock,
}));

vi.mock("../../api/_shared/requireSession.js", () => ({
  requireSession: requireSessionMock,
}));

const USER_ID = "11111111-1111-4111-8111-111111111111";
const WALLET_ID = "22222222-2222-4222-8222-222222222222";
const COLLECTION_ID = "33333333-3333-4333-8333-333333333333";
const JOB_ID = "44444444-4444-4444-8444-444444444444";
const NFT_ITEM_ID = "55555555-5555-4555-8555-555555555555";
const ITEM_INSTANCE_ID = "66666666-6666-4666-8666-666666666666";
const RAW_WALLET_ADDRESS = `0:${"1".repeat(64)}`;
const RAW_COLLECTION_ADDRESS = `0:${"2".repeat(64)}`;
const RAW_OTHER_COLLECTION_ADDRESS = `0:${"3".repeat(64)}`;
const RAW_ITEM_ADDRESS = `0:${"4".repeat(64)}`;
const RAW_OWNER_ADDRESS = `0:${"5".repeat(64)}`;
const RAW_PREVIOUS_OWNER_ADDRESS = `0:${"6".repeat(64)}`;

type QueryResult = {
  data?: unknown;
  error?: unknown;
};

type OperationState = {
  schema: string;
  table: string;
  operation: "select" | "insert" | "update" | "upsert";
  selected: string | null;
  payload: unknown;
  options?: Record<string, unknown>;
  filters: Array<{
    column: string;
    operator: "eq" | "in" | "gte" | "not";
    value: unknown;
    extra?: unknown;
  }>;
  orders: Array<{
    column: string;
    options: Record<string, unknown>;
  }>;
  limitValue: number | null;
  rangeValue: [number, number] | null;
};

describe("wallet NFT sync service", () => {
  beforeEach(() => {
    callRpcRawMock.mockReset();
    getSupabaseAdminClientMock.mockReset();
    requireSessionMock.mockReset();
    requireSessionMock.mockResolvedValue(session());
  });

  it("rejects client-submitted NFT snapshot fields", async () => {
    const { normalizeWalletNftSyncInput } =
      await import("../../api/wallet/sync-nfts");

    expect(() =>
      normalizeWalletNftSyncInput(
        {
          item_address: RAW_ITEM_ADDRESS,
          owner_address: RAW_OWNER_ADDRESS,
          raw_payload: {
            name: "client supplied snapshot",
          },
        },
        null,
      ),
    ).toThrow(
      expect.objectContaining({
        code: "VALIDATION_ERROR",
        statusCode: 400,
      }),
    );
  });

  it("does not let public request bodies force bypass recent job reuse", async () => {
    const { normalizeWalletNftSyncInput } =
      await import("../../api/wallet/sync-nfts");

    expect(
      normalizeWalletNftSyncInput(
        {
          force: true,
          idempotency_key: "wallet:sync:test-key",
        },
        null,
      ),
    ).not.toHaveProperty("force");
  });

  it("rejects sync before a verified wallet exists", async () => {
    const db = createSupabaseMock([
      {
        data: null,
        error: null,
      },
    ]);
    const provider = {
      submitMint: vi.fn(),
      queryTransaction: vi.fn(),
      queryWalletNfts: vi.fn(),
    };
    const { syncWalletNftsForUser } =
      await import("../../api/wallet/sync-nfts");

    await expect(
      syncWalletNftsForUser({
        db: db.client as never,
        provider,
        userId: USER_ID,
        input: {
          chain: "MAINNET",
          mode: "INCREMENTAL",
          force: true,
        },
        requestId: "req_no_wallet",
        now: new Date("2026-05-29T08:00:00.000Z"),
      }),
    ).rejects.toMatchObject({
      code: "WALLET_NOT_VERIFIED",
      statusCode: 403,
    } satisfies Partial<ApiError>);

    expect(provider.queryWalletNfts).not.toHaveBeenCalled();
    expect(db.operations[0]).toMatchObject({
      schema: "core",
      table: "user_wallets",
      operation: "select",
      filters: expect.arrayContaining([
        {
          column: "user_id",
          operator: "eq",
          value: USER_ID,
        },
        {
          column: "status",
          operator: "eq",
          value: "connected",
        },
        {
          column: "verified_at",
          operator: "not",
          value: "is",
          extra: null,
        },
      ]),
    });
  });

  it("returns a recent wallet sync job instead of creating a duplicate job", async () => {
    const now = new Date("2026-05-29T08:00:00.000Z");
    const db = createSupabaseMock([
      {
        data: walletRow(),
      },
      {
        data: walletSyncJob({
          status: "processing",
          result: {
            mode: "INCREMENTAL",
          },
        }),
      },
    ]);
    const provider = {
      submitMint: vi.fn(),
      queryTransaction: vi.fn(),
      queryWalletNfts: vi.fn(),
    };
    const { syncWalletNftsForUser } =
      await import("../../api/wallet/sync-nfts");

    const result = await syncWalletNftsForUser({
      db: db.client as never,
      provider,
      userId: USER_ID,
      input: {
        chain: "MAINNET",
        mode: "INCREMENTAL",
      },
      requestId: "req_recent_job",
      now,
    });

    expect(result).toMatchObject({
      accepted: true,
      status: "syncing",
      jobId: JOB_ID,
    });
    expect(provider.queryWalletNfts).not.toHaveBeenCalled();
    expect(
      db.operations.some(
        (operation) =>
          operation.operation === "insert" &&
          operation.table === "wallet_sync_jobs",
      ),
    ).toBe(false);
    expect(db.operations[1]).toMatchObject({
      schema: "onchain",
      table: "wallet_sync_jobs",
      operation: "select",
      filters: expect.arrayContaining([
        {
          column: "wallet_id",
          operator: "eq",
          value: WALLET_ID,
        },
        {
          column: "sync_type",
          operator: "eq",
          value: "nft",
        },
        {
          column: "status",
          operator: "in",
          value: ["queued", "processing", "success"],
        },
      ]),
    });
  });

  it("writes a sync job, filters non-game collections and links known NFT items", async () => {
    const completedAt = "2026-05-29T08:00:00.000Z";
    const db = createSupabaseMock([
      {
        data: walletRow(),
      },
      {
        data: walletSyncJob({
          status: "processing",
          result: {
            mode: "INCREMENTAL",
          },
        }),
      },
      {
        data: [
          {
            id: COLLECTION_ID,
            network: "mainnet",
            collection_address: RAW_COLLECTION_ADDRESS,
            status: "active",
          },
        ],
      },
      {
        data: [
          {
            id: NFT_ITEM_ID,
            collection_id: COLLECTION_ID,
            item_address: RAW_ITEM_ADDRESS,
            owner_address: RAW_PREVIOUS_OWNER_ADDRESS,
            item_index: 7,
          },
        ],
      },
      {},
      {},
      {},
      {},
      {
        data: walletSyncJob({
          status: "success",
          finished_at: completedAt,
          result: {
            mode: "INCREMENTAL",
            synced_count: 1,
            linked_count: 1,
            ignored_count: 1,
            next_cursor: null,
          },
        }),
      },
    ]);
    const provider = {
      submitMint: vi.fn(),
      queryTransaction: vi.fn(),
      queryWalletNfts: vi.fn().mockResolvedValue({
        items: [
          {
            itemAddress: RAW_ITEM_ADDRESS,
            collectionAddress: RAW_COLLECTION_ADDRESS,
            ownerAddress: RAW_OWNER_ADDRESS,
            itemIndex: 7,
            metadataUrl: "https://example.test/nft/7.json",
            name: "Known NFT",
            imageUrl: "https://example.test/nft/7.png",
            rawPayload: {
              name: "Known NFT",
            },
          },
          {
            itemAddress: `0:${"7".repeat(64)}`,
            collectionAddress: RAW_OTHER_COLLECTION_ADDRESS,
            ownerAddress: RAW_OWNER_ADDRESS,
            itemIndex: 99,
            metadataUrl: null,
            name: null,
            imageUrl: null,
            rawPayload: {},
          },
        ],
        nextCursor: null,
        rawResponse: {
          ok: true,
        },
        externalApiProvider: "mock-ton-provider",
        checkedAt: completedAt,
      }),
    };
    const { syncWalletNftsForUser } =
      await import("../../api/wallet/sync-nfts");

    const result = await syncWalletNftsForUser({
      db: db.client as never,
      provider,
      userId: USER_ID,
      input: {
        chain: "MAINNET",
        mode: "INCREMENTAL",
        force: true,
      },
      requestId: "req_sync_success",
      now: new Date(completedAt),
    });

    expect(result).toMatchObject({
      status: "success",
      syncedCount: 1,
      linkedCount: 1,
      ignoredCount: 1,
      lastSyncAt: completedAt,
    });
    expect(provider.queryWalletNfts).toHaveBeenCalledWith(
      expect.objectContaining({
        requestId: "req_sync_success",
        wallet: expect.objectContaining({
          id: WALLET_ID,
          network: "mainnet",
        }),
      }),
    );
    expect(
      db.operations.find(
        (operation) =>
          operation.operation === "upsert" &&
          operation.table === "wallet_nft_snapshots",
      )?.payload,
    ).toEqual([
      expect.objectContaining({
        wallet_id: WALLET_ID,
        user_id: USER_ID,
        item_address: RAW_ITEM_ADDRESS,
        owner_address: RAW_OWNER_ADDRESS,
      }),
    ]);
    expect(
      db.operations.find(
        (operation) =>
          operation.operation === "insert" && operation.table === "risk_events",
      )?.payload,
    ).toMatchObject({
      event_type: "onchain_nft_owner_mismatch",
      source_type: "wallet_sync_job",
      source_id: JOB_ID,
    });
    expect(
      db.operations.find(
        (operation) =>
          operation.operation === "update" && operation.table === "nft_items",
      )?.payload,
    ).toMatchObject({
      owner_address: RAW_OWNER_ADDRESS,
      last_seen_at: completedAt,
    });
    expect(
      db.operations.find(
        (operation) =>
          operation.operation === "update" &&
          operation.table === "user_wallets",
      )?.payload,
    ).toMatchObject({
      last_sync_at: completedAt,
    });
  });

  it("completes an empty-wallet sync without writing NFT snapshots", async () => {
    const completedAt = "2026-05-29T08:05:00.000Z";
    const db = createSupabaseMock([
      {
        data: walletRow(),
      },
      {
        data: walletSyncJob({
          status: "processing",
          result: {
            mode: "INCREMENTAL",
          },
        }),
      },
      {
        data: [
          {
            id: COLLECTION_ID,
            network: "mainnet",
            collection_address: RAW_COLLECTION_ADDRESS,
            status: "active",
          },
        ],
      },
      {},
      {
        data: walletSyncJob({
          status: "success",
          finished_at: completedAt,
          result: {
            mode: "INCREMENTAL",
            synced_count: 0,
            linked_count: 0,
            ignored_count: 0,
            next_cursor: null,
          },
        }),
      },
    ]);
    const provider = {
      submitMint: vi.fn(),
      queryTransaction: vi.fn(),
      queryWalletNfts: vi.fn().mockResolvedValue({
        items: [],
        nextCursor: null,
        rawResponse: {
          ok: true,
        },
        externalApiProvider: "mock-ton-provider",
        checkedAt: completedAt,
      }),
    };
    const { syncWalletNftsForUser } =
      await import("../../api/wallet/sync-nfts");

    const result = await syncWalletNftsForUser({
      db: db.client as never,
      provider,
      userId: USER_ID,
      input: {
        chain: "MAINNET",
        mode: "INCREMENTAL",
        force: true,
      },
      requestId: "req_empty_wallet",
      now: new Date(completedAt),
    });

    expect(result).toMatchObject({
      status: "success",
      syncedCount: 0,
      linkedCount: 0,
      ignoredCount: 0,
      message: "未发现当前游戏 Collection NFT。",
    });
    expect(
      db.operations.some(
        (operation) =>
          operation.operation === "upsert" &&
          operation.table === "wallet_nft_snapshots",
      ),
    ).toBe(false);
    expect(
      db.operations.find(
        (operation) =>
          operation.operation === "update" &&
          operation.table === "user_wallets",
      )?.payload,
    ).toMatchObject({
      last_sync_at: completedAt,
    });
  });

  it("marks the sync job retryable when the TON NFT provider fails", async () => {
    const now = new Date("2026-05-29T08:10:00.000Z");
    const db = createSupabaseMock([
      {
        data: walletRow(),
      },
      {
        data: walletSyncJob({
          status: "processing",
          result: {
            mode: "INCREMENTAL",
          },
        }),
      },
      {},
    ]);
    const providerError = new TonNftProviderError(
      "TON_NFT_PROVIDER_TIMEOUT",
      "TON API timed out",
      {
        retryable: true,
      },
    );
    const provider = {
      submitMint: vi.fn(),
      queryTransaction: vi.fn(),
      queryWalletNfts: vi.fn().mockRejectedValue(providerError),
    };
    const { syncWalletNftsForUser } =
      await import("../../api/wallet/sync-nfts");

    await expect(
      syncWalletNftsForUser({
        db: db.client as never,
        provider,
        userId: USER_ID,
        input: {
          chain: "MAINNET",
          mode: "INCREMENTAL",
          force: true,
        },
        requestId: "req_provider_timeout",
        now,
      }),
    ).rejects.toBe(providerError);

    expect(
      db.operations.find(
        (operation) =>
          operation.operation === "update" &&
          operation.table === "wallet_sync_jobs",
      )?.payload,
    ).toMatchObject({
      status: "failed",
      error_message: "TON_NFT_PROVIDER_TIMEOUT",
      retry_count: 1,
      next_retry_at: "2026-05-29T08:15:00.000Z",
      result: expect.objectContaining({
        error_code: "TON_NFT_PROVIDER_TIMEOUT",
        retryable: true,
      }),
    });
    expect(
      db.operations.some(
        (operation) => operation.table === "wallet_nft_snapshots",
      ),
    ).toBe(false);
  });

  it("returns the recent wallet sync job for a repeated manual sync", async () => {
    const now = new Date("2026-05-29T08:20:00.000Z");
    const recentJob = walletSyncJob({
      status: "processing",
      result: {
        mode: "INCREMENTAL",
        synced_count: 0,
        linked_count: 0,
        ignored_count: 0,
        next_cursor: null,
      },
    });
    const db = createSupabaseMock([
      {
        data: walletRow(),
      },
      {
        data: recentJob,
      },
    ]);
    const provider = {
      submitMint: vi.fn(),
      queryTransaction: vi.fn(),
      queryWalletNfts: vi.fn(),
    };
    const { syncWalletNftsForUser } =
      await import("../../api/wallet/sync-nfts");

    const result = await syncWalletNftsForUser({
      db: db.client as never,
      provider,
      userId: USER_ID,
      input: {
        chain: "MAINNET",
        mode: "INCREMENTAL",
        force: false,
      },
      requestId: "req_repeat_recent_job",
      now,
    });

    expect(result).toMatchObject({
      accepted: true,
      status: "syncing",
      jobId: JOB_ID,
    });
    expect(provider.queryWalletNfts).not.toHaveBeenCalled();
    expect(
      db.operations.some(
        (operation) =>
          operation.operation === "insert" &&
          operation.table === "wallet_sync_jobs",
      ),
    ).toBe(false);
    expect(db.operations[1]).toMatchObject({
      schema: "onchain",
      table: "wallet_sync_jobs",
      filters: expect.arrayContaining([
        {
          column: "wallet_id",
          operator: "eq",
          value: WALLET_ID,
        },
        {
          column: "sync_type",
          operator: "eq",
          value: "nft",
        },
        {
          column: "status",
          operator: "in",
          value: ["queued", "processing", "success"],
        },
      ]),
    });
  });

  it("returns an existing idempotent sync job without querying TON again", async () => {
    const now = new Date("2026-05-29T08:25:00.000Z");
    const db = createSupabaseMock([
      {
        data: walletRow(),
      },
      {
        data: walletSyncJob({
          status: "success",
          finished_at: "2026-05-29T08:24:00.000Z",
          result: {
            mode: "INCREMENTAL",
            synced_count: 1,
            linked_count: 1,
            ignored_count: 0,
            next_cursor: null,
          },
        }),
      },
    ]);
    const provider = {
      submitMint: vi.fn(),
      queryTransaction: vi.fn(),
      queryWalletNfts: vi.fn(),
    };
    const { syncWalletNftsForUser } =
      await import("../../api/wallet/sync-nfts");

    const result = await syncWalletNftsForUser({
      db: db.client as never,
      provider,
      userId: USER_ID,
      input: {
        chain: "MAINNET",
        mode: "INCREMENTAL",
        force: true,
        idempotencyKey: "wallet:sync:test-key",
      },
      requestId: "req_repeat_idempotency_key",
      now,
    });

    expect(result).toMatchObject({
      accepted: false,
      status: "success",
      jobId: JOB_ID,
      syncedCount: 1,
      linkedCount: 1,
    });
    expect(provider.queryWalletNfts).not.toHaveBeenCalled();
    expect(
      db.operations.some(
        (operation) =>
          operation.operation === "insert" &&
          operation.table === "wallet_sync_jobs",
      ),
    ).toBe(false);
  });
});

describe("wallet NFT query API", () => {
  beforeEach(() => {
    callRpcRawMock.mockReset();
    getSupabaseAdminClientMock.mockReset();
    requireSessionMock.mockReset();
    requireSessionMock.mockResolvedValue(session());
  });

  it("returns only the current user's NFT snapshots with known item links", async () => {
    const db = {};
    getSupabaseAdminClientMock.mockReturnValue(db);
    callRpcRawMock.mockResolvedValue({
      items: [
        {
          nftItemId: NFT_ITEM_ID,
          itemAddress: RAW_ITEM_ADDRESS,
          collectionAddress: RAW_COLLECTION_ADDRESS,
          ownerAddress: RAW_OWNER_ADDRESS,
          itemIndex: 7,
          name: "Known NFT",
          imageUrl: "https://example.test/nft/7.png",
          metadataUrl: "https://example.test/nft/7.json",
          linkedItemInstanceId: ITEM_INSTANCE_ID,
          syncedAt: "2026-05-29T08:00:00.000Z",
        },
      ],
      nextCursor: null,
      serverTime: "2026-05-29T08:00:01.000Z",
    });

    const { default: walletNftsHandler } =
      await import("../../api/wallet/nfts");
    const result = await invokeApiHandler<ApiSuccessResponse>(
      walletNftsHandler,
      {
        method: "GET",
        url: "/api/wallet/nfts",
        headers: requestHeaders(),
      },
    );

    expect(result.statusCode).toBe(200);
    expect(result.body).toMatchObject({
      ok: true,
      data: {
        items: [
          {
            nftItemId: NFT_ITEM_ID,
            itemAddress: RAW_ITEM_ADDRESS,
            ownerAddress: RAW_OWNER_ADDRESS,
            itemIndex: 7,
            name: "Known NFT",
            linkedItemInstanceId: ITEM_INSTANCE_ID,
          },
        ],
        nextCursor: null,
      },
    });
    expect(callRpcRawMock).toHaveBeenCalledWith(
      "wallet_list_nft_snapshots",
      {
        p_user_id: USER_ID,
        p_address: null,
        p_network: null,
        p_collection_address: null,
        p_only_known_collections: false,
        p_offset: 0,
        p_limit: 20,
      },
      expect.objectContaining({
        schema: "api",
        client: db,
      }),
    );
  });

  it("rejects an invalid cursor without querying snapshots", async () => {
    const db = createSupabaseMock([]);
    getSupabaseAdminClientMock.mockReturnValue(db.client);

    const { default: walletNftsHandler } =
      await import("../../api/wallet/nfts");
    const result = await invokeApiHandler<ApiErrorResponse>(walletNftsHandler, {
      method: "GET",
      url: "/api/wallet/nfts",
      headers: requestHeaders(),
      query: {
        cursor: "bad-cursor",
      },
    });

    expect(result.statusCode).toBe(400);
    expect(result.body).toMatchObject({
      ok: false,
      error: {
        code: "VALIDATION_ERROR",
      },
    });
    expect(callRpcRawMock).not.toHaveBeenCalled();
  });
});

function session() {
  return {
    sessionId: "session-wallet-nft-test",
    userId: USER_ID,
    telegramUserId: 7014,
    userStatus: "active",
    expiresAt: "2026-05-30T00:00:00.000Z",
    sessionTokenHash: "session-hash",
  };
}

function requestHeaders(): Record<string, string> {
  return {
    cookie: "tma_game_session=test-session-token-000000000000",
    "x-forwarded-for": "127.0.0.74",
  };
}

function walletRow(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: WALLET_ID,
    user_id: USER_ID,
    chain: "TON",
    network: "mainnet",
    address: RAW_WALLET_ADDRESS,
    address_raw: RAW_WALLET_ADDRESS,
    wallet_app_name: "Tonkeeper",
    is_primary: true,
    status: "connected",
    verified_at: "2026-05-29T07:00:00.000Z",
    last_sync_at: null,
    updated_at: "2026-05-29T07:00:00.000Z",
    created_at: "2026-05-29T07:00:00.000Z",
    ...overrides,
  };
}

function walletSyncJob(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: JOB_ID,
    user_id: USER_ID,
    wallet_id: WALLET_ID,
    status: "processing",
    sync_type: "nft",
    started_at: "2026-05-29T08:00:00.000Z",
    finished_at: null,
    error_message: null,
    result: {},
    idempotency_key: "wallet:sync:test-key",
    retry_count: 0,
    next_retry_at: null,
    cursor: null,
    created_at: "2026-05-29T08:00:00.000Z",
    updated_at: "2026-05-29T08:00:00.000Z",
    ...overrides,
  };
}

function createSupabaseMock(results: QueryResult[]) {
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
      eq(column: string, value: unknown) {
        state.filters.push({
          column,
          operator: "eq" as const,
          value,
        });
        return builder;
      },
      in(column: string, value: unknown[]) {
        state.filters.push({
          column,
          operator: "in" as const,
          value,
        });
        return builder;
      },
      gte(column: string, value: unknown) {
        state.filters.push({
          column,
          operator: "gte" as const,
          value,
        });
        return builder;
      },
      not(column: string, operator: string, value: unknown) {
        state.filters.push({
          column,
          operator: "not" as const,
          value: operator,
          extra: value,
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
      range(from: number, to: number) {
        state.rangeValue = [from, to];
        return builder;
      },
      select(columns: string) {
        state.selected = columns;
        return builder;
      },
      single() {
        return Promise.resolve(nextResult());
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

  function pushOperation(
    schema: string,
    table: string,
    operation: OperationState["operation"],
    payload: unknown = null,
    options?: Record<string, unknown>,
  ) {
    const state: OperationState = {
      schema,
      table,
      operation,
      selected: null,
      payload,
      filters: [],
      orders: [],
      limitValue: null,
      rangeValue: null,
    };
    if (options !== undefined) {
      state.options = options;
    }
    operations.push(state);
    return createBuilder(state);
  }

  const client = {
    schema(schema: string) {
      return {
        from(table: string) {
          return {
            select(columns: string) {
              const builder = pushOperation(schema, table, "select");
              builder.select(columns);
              return builder;
            },
            insert(payload: unknown) {
              return pushOperation(schema, table, "insert", payload);
            },
            update(payload: unknown) {
              return pushOperation(schema, table, "update", payload);
            },
            upsert(payload: unknown, options?: Record<string, unknown>) {
              return pushOperation(schema, table, "upsert", payload, options);
            },
          };
        },
      };
    },
  };

  return {
    client,
    operations,
  };
}
