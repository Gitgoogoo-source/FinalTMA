import { beforeEach, describe, expect, it, vi } from "vitest";

import type {
  ApiErrorResponse,
  ApiSuccessResponse,
} from "../../api/_shared/handler";
import { ApiError } from "../../api/_shared/handler";
import { invokeApiHandler } from "./_utils";

const { getSupabaseAdminClientMock, requireSessionMock, withIdempotencyMock } =
  vi.hoisted(() => ({
    getSupabaseAdminClientMock: vi.fn(),
    requireSessionMock: vi.fn(),
    withIdempotencyMock: vi.fn(),
  }));

vi.mock("../../packages/server/src/db/supabaseAdmin.js", () => ({
  getSupabaseAdminClient: getSupabaseAdminClientMock,
}));

vi.mock("../../api/_shared/requireSession.js", () => ({
  requireSession: requireSessionMock,
}));

vi.mock("../../packages/server/src/db/idempotency.js", () => {
  class IdempotencyError extends Error {
    readonly code: string;
    readonly status: number;
    readonly details: Record<string, unknown> | undefined;

    constructor(
      message: string,
      options: {
        code: string;
        status?: number;
        details?: Record<string, unknown>;
      },
    ) {
      super(message);
      this.code = options.code;
      this.status = options.status ?? 409;
      this.details = options.details;
    }
  }

  return {
    IdempotencyError,
    withIdempotency: withIdempotencyMock,
  };
});

const USER_ID = "11111111-1111-4111-8111-111111111111";
const OTHER_USER_ID = "99999999-9999-4999-8999-999999999999";
const WALLET_ID = "22222222-2222-4222-8222-222222222222";
const ADDRESS = `EQ${"A".repeat(46)}`;
const RAW_ADDRESS = `0:${"a".repeat(64)}`;

type QueryState = {
  schema: string;
  table: string;
  selected: string | null;
  filters: Array<{
    column: string;
    value: unknown;
  }>;
  orders: Array<{
    column: string;
    options: Record<string, unknown>;
  }>;
  limitValue: number | null;
};

type QueryResult = {
  data: unknown;
  error: unknown;
};

type MutationState = QueryState & {
  operation: "update" | "upsert";
  values: unknown;
  upsertOptions?: Record<string, unknown>;
};

describe("wallet status API", () => {
  beforeEach(() => {
    process.env.NODE_ENV = "test";
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-05-28T12:00:00.000Z"));
    getSupabaseAdminClientMock.mockReset();
    requireSessionMock.mockReset();
    withIdempotencyMock.mockReset();
    withIdempotencyMock.mockImplementation(
      async (input: { handler: () => Promise<unknown> }) => ({
        data: await input.handler(),
        replayed: false,
        scope: "wallet.disconnect",
        key: "wallet:disconnect:test-key",
        requestHash: "request-hash",
        record: {},
      }),
    );
    requireSessionMock.mockResolvedValue({
      sessionId: "session-wallet-status-test",
      userId: USER_ID,
      telegramUserId: 7001,
      userStatus: "active",
      expiresAt: "2026-05-29T00:00:00.000Z",
      sessionTokenHash: "session-hash",
    });
  });

  it("returns not_connected when the user has no wallet rows", async () => {
    const db = createSupabaseMock([
      {
        data: null,
        error: null,
      },
      {
        data: null,
        error: null,
      },
    ]);
    getSupabaseAdminClientMock.mockReturnValue(db.client);

    const { default: walletStatusHandler } =
      await import("../../api/wallet/status");
    const result = await invokeApiHandler<ApiSuccessResponse>(
      walletStatusHandler,
      {
        method: "GET",
        url: "/api/wallet/status",
        query: {
          user_id: OTHER_USER_ID,
        },
        headers: {
          cookie: "tma_game_session=test-session-token-000000000000",
          "x-forwarded-for": "127.0.0.51",
        },
      },
    );

    expect(result.statusCode).toBe(200);
    expect(result.body).toMatchObject({
      ok: true,
      data: {
        connected: false,
        verified: false,
        status: "not_connected",
        serverTime: "2026-05-28T12:00:00.000Z",
      },
    });
    expect(JSON.stringify(result.body)).not.toContain(OTHER_USER_ID);
    expect(db.queries).toHaveLength(2);
    expect(db.queries[0]?.filters).toEqual(
      expect.arrayContaining([
        {
          column: "user_id",
          value: USER_ID,
        },
        {
          column: "status",
          value: "connected",
        },
      ]),
    );
    expect(db.queries[1]?.filters).toEqual(
      expect.arrayContaining([
        {
          column: "user_id",
          value: USER_ID,
        },
      ]),
    );
  });

  it("returns verified for a connected wallet with verified_at", async () => {
    const db = createSupabaseMock([
      {
        data: createWalletRow({
          verified_at: "2026-05-28T11:00:00.000Z",
          last_sync_at: "2026-05-28T11:30:00.000Z",
        }),
        error: null,
      },
    ]);
    getSupabaseAdminClientMock.mockReturnValue(db.client);

    const { default: walletStatusHandler } =
      await import("../../api/wallet/status");
    const result = await invokeApiHandler<ApiSuccessResponse>(
      walletStatusHandler,
      {
        method: "GET",
        url: "/api/wallet/status",
        headers: {
          cookie: "tma_game_session=test-session-token-000000000000",
          "x-forwarded-for": "127.0.0.52",
        },
      },
    );

    expect(result.statusCode).toBe(200);
    expect(result.body).toMatchObject({
      ok: true,
      data: {
        connected: true,
        verified: true,
        status: "verified",
        walletId: WALLET_ID,
        address: ADDRESS,
        chain: "MAINNET",
        network: "mainnet",
        walletAppName: "Tonkeeper",
        verifiedAt: "2026-05-28T11:00:00.000Z",
        connectedAt: "2026-05-28T10:00:00.000Z",
        lastSyncAt: "2026-05-28T11:30:00.000Z",
      },
    });
    expect(JSON.stringify(result.body)).not.toContain("address_raw");
    expect(JSON.stringify(result.body)).not.toContain("wallet_device");
    expect(JSON.stringify(result.body)).not.toContain("metadata");
    expect(db.queries).toHaveLength(1);
  });

  it("returns connected_unverified when a connected wallet is not verified", async () => {
    const db = createSupabaseMock([
      {
        data: createWalletRow({
          verified_at: null,
          network: "testnet",
        }),
        error: null,
      },
    ]);
    getSupabaseAdminClientMock.mockReturnValue(db.client);

    const { default: walletStatusHandler } =
      await import("../../api/wallet/status");
    const result = await invokeApiHandler<ApiSuccessResponse>(
      walletStatusHandler,
      {
        method: "GET",
        url: "/api/wallet/status",
        headers: {
          cookie: "tma_game_session=test-session-token-000000000000",
          "x-forwarded-for": "127.0.0.53",
        },
      },
    );

    expect(result.statusCode).toBe(200);
    expect(result.body).toMatchObject({
      ok: true,
      data: {
        connected: true,
        verified: false,
        status: "connected_unverified",
        chain: "TESTNET",
        network: "testnet",
      },
    });
  });

  it("returns the latest disconnected wallet only when no connected wallet exists", async () => {
    const db = createSupabaseMock([
      {
        data: null,
        error: null,
      },
      {
        data: createWalletRow({
          status: "disconnected",
          verified_at: null,
          disconnected_at: "2026-05-28T11:45:00.000Z",
        }),
        error: null,
      },
    ]);
    getSupabaseAdminClientMock.mockReturnValue(db.client);

    const { default: walletStatusHandler } =
      await import("../../api/wallet/status");
    const result = await invokeApiHandler<ApiSuccessResponse>(
      walletStatusHandler,
      {
        method: "GET",
        url: "/api/wallet/status",
        headers: {
          cookie: "tma_game_session=test-session-token-000000000000",
          "x-forwarded-for": "127.0.0.54",
        },
      },
    );

    expect(result.statusCode).toBe(200);
    expect(result.body).toMatchObject({
      ok: true,
      data: {
        connected: false,
        verified: false,
        status: "disconnected",
        disconnectedAt: "2026-05-28T11:45:00.000Z",
      },
    });
    expect(db.queries).toHaveLength(2);
    expect(db.queries[1]?.orders).toEqual([
      {
        column: "updated_at",
        options: {
          ascending: false,
        },
      },
    ]);
  });

  it("requires a session before reading wallet rows", async () => {
    const db = createSupabaseMock([]);
    getSupabaseAdminClientMock.mockReturnValue(db.client);
    requireSessionMock.mockRejectedValueOnce(
      ApiError.unauthorized("Unauthorized"),
    );

    const { default: walletStatusHandler } =
      await import("../../api/wallet/status");
    const result = await invokeApiHandler<ApiErrorResponse>(
      walletStatusHandler,
      {
        method: "GET",
        url: "/api/wallet/status",
        headers: {
          "x-forwarded-for": "127.0.0.55",
        },
      },
    );

    expect(result.statusCode).toBe(401);
    expect(result.body).toMatchObject({
      ok: false,
      error: {
        code: "UNAUTHORIZED",
      },
    });
    expect(getSupabaseAdminClientMock).not.toHaveBeenCalled();
    expect(db.queries).toHaveLength(0);
  });

  it("maps database errors to an internal stable error code", async () => {
    const db = createSupabaseMock([
      {
        data: null,
        error: {
          message: "database unavailable",
        },
      },
    ]);
    getSupabaseAdminClientMock.mockReturnValue(db.client);

    const { default: walletStatusHandler } =
      await import("../../api/wallet/status");
    const result = await invokeApiHandler<ApiErrorResponse>(
      walletStatusHandler,
      {
        method: "GET",
        url: "/api/wallet/status",
        headers: {
          cookie: "tma_game_session=test-session-token-000000000000",
          "x-forwarded-for": "127.0.0.56",
        },
      },
    );

    expect(result.statusCode).toBe(500);
    expect(result.body).toMatchObject({
      ok: false,
      error: {
        code: "WALLET_STATUS_LOOKUP_FAILED",
        message: "Internal server error",
      },
    });
  });
});

describe("wallet connect API", () => {
  beforeEach(() => {
    process.env.NODE_ENV = "test";
    process.env.TON_NETWORK = "mainnet";
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-05-28T12:00:00.000Z"));
    getSupabaseAdminClientMock.mockReset();
    requireSessionMock.mockReset();
    requireSessionMock.mockResolvedValue({
      sessionId: "session-wallet-connect-test",
      userId: USER_ID,
      telegramUserId: 7002,
      userStatus: "active",
      expiresAt: "2026-05-29T00:00:00.000Z",
      sessionTokenHash: "session-hash",
    });
  });

  it("saves a connected unverified wallet for the session user", async () => {
    const db = createWalletConnectSupabaseMock([
      {
        data: null,
        error: null,
      },
      {
        data: createWalletRow({
          address: ADDRESS,
          verified_at: null,
          updated_at: "2026-05-28T12:00:00.000Z",
        }),
        error: null,
      },
    ]);
    getSupabaseAdminClientMock.mockReturnValue(db.client);

    const { default: walletConnectHandler } =
      await import("../../api/wallet/connect");
    const result = await invokeApiHandler<ApiSuccessResponse>(
      walletConnectHandler,
      {
        method: "POST",
        url: "/api/wallet/connect",
        headers: {
          cookie: "tma_game_session=test-session-token-000000000000",
          "x-forwarded-for": "127.0.0.61",
          "x-idempotency-key": "wallet:connect:test-key",
        },
        body: {
          user_id: OTHER_USER_ID,
          address: ADDRESS,
          raw_address: RAW_ADDRESS,
          network: "-239",
          wallet_app_name: "Tonkeeper",
          account: {
            address: RAW_ADDRESS,
            chain: "-239",
            publicKey: "a".repeat(64),
          },
          idempotency_key: "wallet:connect:test-key",
        },
      },
    );

    expect(result.statusCode).toBe(200);
    expect(result.body).toMatchObject({
      ok: true,
      data: {
        connected: true,
        verified: false,
        status: "connected_unverified",
        address: ADDRESS,
        chain: "MAINNET",
        network: "mainnet",
        walletAppName: "Tonkeeper",
      },
    });
    expect(JSON.stringify(result.body)).not.toContain(OTHER_USER_ID);
    expect(db.mutations).toHaveLength(2);
    expect(db.mutations[0]).toMatchObject({
      schema: "core",
      table: "user_wallets",
      operation: "update",
      values: {
        is_primary: false,
      },
      filters: expect.arrayContaining([
        {
          column: "user_id",
          value: USER_ID,
        },
        {
          column: "network",
          value: "mainnet",
        },
        {
          column: "status",
          value: "connected",
        },
      ]),
    });
    expect(db.mutations[1]).toMatchObject({
      schema: "core",
      table: "user_wallets",
      operation: "upsert",
      values: {
        user_id: USER_ID,
        chain: "TON",
        network: "mainnet",
        address: ADDRESS,
        address_raw: RAW_ADDRESS,
        wallet_app_name: "Tonkeeper",
        is_primary: true,
        status: "connected",
        disconnected_at: null,
      },
      upsertOptions: {
        onConflict: "user_id,chain,network,address",
      },
    });
    expect(JSON.stringify(db.mutations[1]?.values)).not.toContain(
      "verified_at",
    );
  });

  it("returns verified when reconnecting an already verified wallet", async () => {
    const db = createWalletConnectSupabaseMock([
      {
        data: null,
        error: null,
      },
      {
        data: createWalletRow({
          address: ADDRESS,
          verified_at: "2026-05-28T11:00:00.000Z",
        }),
        error: null,
      },
    ]);
    getSupabaseAdminClientMock.mockReturnValue(db.client);

    const { default: walletConnectHandler } =
      await import("../../api/wallet/connect");
    const result = await invokeApiHandler<ApiSuccessResponse>(
      walletConnectHandler,
      {
        method: "POST",
        url: "/api/wallet/connect",
        headers: {
          cookie: "tma_game_session=test-session-token-000000000000",
          "x-forwarded-for": "127.0.0.62",
        },
        body: {
          address: ADDRESS,
          network: "mainnet",
        },
      },
    );

    expect(result.statusCode).toBe(200);
    expect(result.body).toMatchObject({
      ok: true,
      data: {
        connected: true,
        verified: true,
        status: "verified",
        verifiedAt: "2026-05-28T11:00:00.000Z",
      },
    });
  });

  it("requires a session before saving wallet rows", async () => {
    const db = createWalletConnectSupabaseMock([]);
    getSupabaseAdminClientMock.mockReturnValue(db.client);
    requireSessionMock.mockRejectedValueOnce(
      ApiError.unauthorized("Unauthorized"),
    );

    const { default: walletConnectHandler } =
      await import("../../api/wallet/connect");
    const result = await invokeApiHandler<ApiErrorResponse>(
      walletConnectHandler,
      {
        method: "POST",
        url: "/api/wallet/connect",
        headers: {
          "x-forwarded-for": "127.0.0.63",
        },
        body: {
          address: ADDRESS,
          network: "mainnet",
        },
      },
    );

    expect(result.statusCode).toBe(401);
    expect(result.body).toMatchObject({
      ok: false,
      error: {
        code: "UNAUTHORIZED",
      },
    });
    expect(getSupabaseAdminClientMock).not.toHaveBeenCalled();
    expect(db.mutations).toHaveLength(0);
  });

  it("maps database errors to an internal stable error code", async () => {
    const db = createWalletConnectSupabaseMock([
      {
        data: null,
        error: {
          message: "database unavailable",
        },
      },
    ]);
    getSupabaseAdminClientMock.mockReturnValue(db.client);

    const { default: walletConnectHandler } =
      await import("../../api/wallet/connect");
    const result = await invokeApiHandler<ApiErrorResponse>(
      walletConnectHandler,
      {
        method: "POST",
        url: "/api/wallet/connect",
        headers: {
          cookie: "tma_game_session=test-session-token-000000000000",
          "x-forwarded-for": "127.0.0.64",
        },
        body: {
          address: ADDRESS,
          network: "mainnet",
        },
      },
    );

    expect(result.statusCode).toBe(500);
    expect(result.body).toMatchObject({
      ok: false,
      error: {
        code: "WALLET_CONNECT_SAVE_FAILED",
        message: "Internal server error",
      },
    });
  });
});

describe("wallet disconnect API", () => {
  beforeEach(() => {
    process.env.NODE_ENV = "test";
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-05-28T12:00:00.000Z"));
    getSupabaseAdminClientMock.mockReset();
    requireSessionMock.mockReset();
    withIdempotencyMock.mockReset();
    withIdempotencyMock.mockImplementation(
      async (input: { handler: () => Promise<unknown> }) => ({
        data: await input.handler(),
        replayed: false,
        scope: "wallet.disconnect",
        key: "wallet:disconnect:test-key",
        requestHash: "request-hash",
        record: {},
      }),
    );
    requireSessionMock.mockResolvedValue({
      sessionId: "session-wallet-disconnect-test",
      userId: USER_ID,
      telegramUserId: 7001,
      userStatus: "active",
      expiresAt: "2026-05-29T00:00:00.000Z",
      sessionTokenHash: "session-hash",
    });
  });

  it("disconnects the current connected wallet for the session user", async () => {
    const db = createSupabaseMutationMock([
      {
        data: createWalletRow({
          address: RAW_ADDRESS,
          verified_at: "2026-05-28T11:00:00.000Z",
        }),
        error: null,
      },
      {
        data: createWalletRow({
          address: RAW_ADDRESS,
          is_primary: false,
          status: "disconnected",
          verified_at: "2026-05-28T11:00:00.000Z",
          disconnected_at: "2026-05-28T12:00:00.000Z",
          updated_at: "2026-05-28T12:00:00.000Z",
        }),
        error: null,
      },
    ]);
    getSupabaseAdminClientMock.mockReturnValue(db.client);

    const { default: walletDisconnectHandler } =
      await import("../../api/wallet/disconnect");
    const result = await invokeApiHandler<ApiSuccessResponse>(
      walletDisconnectHandler,
      {
        method: "POST",
        url: "/api/wallet/disconnect",
        body: {
          idempotency_key: "wallet:disconnect:test-key",
        },
        headers: {
          cookie: "tma_game_session=test-session-token-000000000000",
          "content-type": "application/json",
          "x-forwarded-for": "127.0.0.57",
        },
      },
    );

    expect(result.statusCode).toBe(200);
    expect(result.body).toMatchObject({
      ok: true,
      data: {
        connected: false,
        verified: false,
        status: "disconnected",
        address: RAW_ADDRESS,
        disconnectedAt: "2026-05-28T12:00:00.000Z",
      },
    });
    expect(db.queries[0]?.filters).toEqual(
      expect.arrayContaining([
        {
          column: "user_id",
          value: USER_ID,
        },
        {
          column: "status",
          value: "connected",
        },
      ]),
    );
    expect(db.queries[1]?.updates).toMatchObject({
      status: "disconnected",
      disconnected_at: "2026-05-28T12:00:00.000Z",
      is_primary: false,
    });
    expect(withIdempotencyMock).toHaveBeenCalledWith(
      expect.objectContaining({
        scope: "wallet.disconnect",
        key: "wallet:disconnect:test-key",
        userId: USER_ID,
        requestPayload: {
          address: null,
          reason: null,
        },
      }),
    );
  });

  it("returns not_connected when the user has no wallet to disconnect", async () => {
    const db = createSupabaseMutationMock([
      {
        data: null,
        error: null,
      },
      {
        data: null,
        error: null,
      },
    ]);
    getSupabaseAdminClientMock.mockReturnValue(db.client);

    const { default: walletDisconnectHandler } =
      await import("../../api/wallet/disconnect");
    const result = await invokeApiHandler<ApiSuccessResponse>(
      walletDisconnectHandler,
      {
        method: "POST",
        url: "/api/wallet/disconnect",
        body: {
          idempotency_key: "wallet:disconnect:test-key",
        },
        headers: {
          cookie: "tma_game_session=test-session-token-000000000000",
          "content-type": "application/json",
          "x-forwarded-for": "127.0.0.58",
        },
      },
    );

    expect(result.statusCode).toBe(200);
    expect(result.body).toMatchObject({
      ok: true,
      data: {
        connected: false,
        verified: false,
        status: "not_connected",
      },
    });
    expect(db.queries.some((query) => query.updates)).toBe(false);
  });

  it("rejects client supplied identity and wallet ownership fields", async () => {
    const db = createSupabaseMutationMock([]);
    getSupabaseAdminClientMock.mockReturnValue(db.client);

    const { default: walletDisconnectHandler } =
      await import("../../api/wallet/disconnect");
    const result = await invokeApiHandler<ApiErrorResponse>(
      walletDisconnectHandler,
      {
        method: "POST",
        url: "/api/wallet/disconnect",
        body: {
          wallet_id: WALLET_ID,
          idempotency_key: "wallet:disconnect:test-key",
        },
        headers: {
          cookie: "tma_game_session=test-session-token-000000000000",
          "content-type": "application/json",
          "x-forwarded-for": "127.0.0.59",
        },
      },
    );

    expect(result.statusCode).toBe(400);
    expect(result.body).toMatchObject({
      ok: false,
      error: {
        code: "VALIDATION_ERROR",
      },
    });
    expect(withIdempotencyMock).not.toHaveBeenCalled();
    expect(db.queries).toHaveLength(0);
  });
});

function createSupabaseMock(results: QueryResult[]) {
  const queries: QueryState[] = [];
  let queryIndex = 0;

  const client = {
    schema(schema: string) {
      return {
        from(table: string) {
          const state: QueryState = {
            schema,
            table,
            selected: null,
            filters: [],
            orders: [],
            limitValue: null,
          };
          queries.push(state);

          const builder = {
            select(columns: string) {
              state.selected = columns;
              return builder;
            },
            eq(column: string, value: unknown) {
              state.filters.push({
                column,
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
            async maybeSingle() {
              const result = results[queryIndex] ?? {
                data: null,
                error: null,
              };
              queryIndex += 1;
              return result;
            },
          };

          return builder;
        },
      };
    },
  };

  return {
    client,
    queries,
  };
}

type DisconnectQueryState = QueryState & {
  updates: Record<string, unknown> | null;
};

function createSupabaseMutationMock(results: QueryResult[]) {
  const queries: DisconnectQueryState[] = [];
  let queryIndex = 0;

  const client = {
    schema(schema: string) {
      return {
        from(table: string) {
          const state: DisconnectQueryState = {
            schema,
            table,
            selected: null,
            filters: [],
            orders: [],
            limitValue: null,
            updates: null,
          };
          queries.push(state);

          const builder = {
            select(columns: string) {
              state.selected = columns;
              return builder;
            },
            update(values: Record<string, unknown>) {
              state.updates = values;
              return builder;
            },
            eq(column: string, value: unknown) {
              state.filters.push({
                column,
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
            async maybeSingle() {
              const result = results[queryIndex] ?? {
                data: null,
                error: null,
              };
              queryIndex += 1;
              return result;
            },
          };

          return builder;
        },
      };
    },
  };

  return {
    client,
    queries,
  };
}

function createWalletConnectSupabaseMock(results: QueryResult[]) {
  const mutations: MutationState[] = [];
  let queryIndex = 0;

  function nextResult(): QueryResult {
    const result = results[queryIndex] ?? {
      data: null,
      error: null,
    };
    queryIndex += 1;
    return result;
  }

  const client = {
    schema(schema: string) {
      return {
        from(table: string) {
          function createBuilder(state: MutationState) {
            const builder = {
              eq(column: string, value: unknown) {
                state.filters.push({
                  column,
                  value,
                });
                return builder;
              },
              select(columns: string) {
                state.selected = columns;
                return builder;
              },
              async single() {
                return nextResult();
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

          return {
            update(values: unknown) {
              const state: MutationState = {
                schema,
                table,
                operation: "update",
                values,
                selected: null,
                filters: [],
                orders: [],
                limitValue: null,
              };
              mutations.push(state);
              return createBuilder(state);
            },
            upsert(values: unknown, upsertOptions: Record<string, unknown>) {
              const state: MutationState = {
                schema,
                table,
                operation: "upsert",
                values,
                upsertOptions,
                selected: null,
                filters: [],
                orders: [],
                limitValue: null,
              };
              mutations.push(state);
              return createBuilder(state);
            },
          };
        },
      };
    },
  };

  return {
    client,
    mutations,
  };
}

function createWalletRow(
  overrides: Partial<Record<keyof WalletTestRow, unknown>> = {},
) {
  return {
    id: WALLET_ID,
    user_id: USER_ID,
    chain: "TON",
    network: "mainnet",
    address: ADDRESS,
    wallet_app_name: "Tonkeeper",
    is_primary: true,
    status: "connected",
    verified_at: "2026-05-28T11:00:00.000Z",
    disconnected_at: null,
    last_sync_at: null,
    created_at: "2026-05-28T10:00:00.000Z",
    updated_at: "2026-05-28T11:00:00.000Z",
    ...overrides,
  };
}

type WalletTestRow = {
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
