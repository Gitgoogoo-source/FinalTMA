import { beforeEach, describe, expect, it, vi } from "vitest";

import type {
  ApiErrorResponse,
  ApiSuccessResponse,
} from "../../api/_shared/handler";
import { invokeApiHandler } from "./_utils";

const { getSupabaseAdminClientMock, requireSessionMock } = vi.hoisted(() => ({
  getSupabaseAdminClientMock: vi.fn(),
  requireSessionMock: vi.fn(),
}));

vi.mock("../../packages/server/src/db/supabaseAdmin.js", () => ({
  getSupabaseAdminClient: getSupabaseAdminClientMock,
}));

vi.mock("../../api/_shared/requireSession.js", () => ({
  requireSession: requireSessionMock,
}));

const USER_ID = "11111111-1111-4111-8111-111111111111";
const WALLET_ID = "22222222-2222-4222-8222-222222222222";
const COLLECTION_ID = "33333333-3333-4333-8333-333333333333";
const ITEM_ID = "44444444-4444-4444-8444-444444444444";
const QUEUE_ID = "77777777-7777-4777-8777-777777777777";
const NFT_ITEM_ID = "88888888-8888-4888-8888-888888888888";
const ADDRESS = `EQ${"A".repeat(46)}`;
const COLLECTION_ADDRESS = `EQ${"C".repeat(46)}`;

type QueryResult = {
  data: unknown;
  error: unknown;
};

type OperationState = {
  schema: string;
  table: string;
  selected: string | null;
  filters: Array<{
    column: string;
    operator: "eq" | "in";
    value: unknown;
  }>;
  orders: Array<{
    column: string;
    options: Record<string, unknown>;
  }>;
  rangeValue: [number, number] | null;
};

describe("wallet mint status API", () => {
  beforeEach(() => {
    getSupabaseAdminClientMock.mockReset();
    requireSessionMock.mockReset();
    requireSessionMock.mockResolvedValue({
      sessionId: "session-wallet-mint-status-test",
      userId: USER_ID,
      telegramUserId: 7010,
      userStatus: "active",
      expiresAt: "2026-05-30T00:00:00.000Z",
      sessionTokenHash: "session-hash",
    });
  });

  it("returns only the current user's Mint queue rows", async () => {
    const db = createSupabaseQueryMock([
      {
        data: [
          {
            id: QUEUE_ID,
            user_id: USER_ID,
            wallet_id: WALLET_ID,
            collection_id: COLLECTION_ID,
            item_instance_id: ITEM_ID,
            status: "confirming",
            attempt_count: 1,
            nft_item_id: NFT_ITEM_ID,
            tx_hash: null,
            error_message: null,
            metadata: {
              error_code: null,
            },
            created_at: "2026-05-29T08:00:00.000Z",
            updated_at: "2026-05-29T08:01:00.000Z",
            completed_at: null,
          },
        ],
        error: null,
      },
      {
        data: [
          {
            id: COLLECTION_ID,
            network: "mainnet",
            collection_address: COLLECTION_ADDRESS,
          },
        ],
        error: null,
      },
      {
        data: [
          {
            id: WALLET_ID,
            address: ADDRESS,
            network: "mainnet",
          },
        ],
        error: null,
      },
      {
        data: [
          {
            id: NFT_ITEM_ID,
            item_address: `EQ${"D".repeat(46)}`,
            owner_address: ADDRESS,
            minted_tx_hash: null,
            minted_at: null,
          },
        ],
        error: null,
      },
      {
        data: [
          {
            related_id: QUEUE_ID,
            tx_hash: "tx_mint_001",
            status: "pending",
            created_at: "2026-05-29T08:01:30.000Z",
          },
        ],
        error: null,
      },
    ]);
    getSupabaseAdminClientMock.mockReturnValue(db.client);

    const { default: mintStatusHandler } =
      await import("../../api/wallet/mint-status");
    const result = await invokeApiHandler<ApiSuccessResponse>(
      mintStatusHandler,
      {
        method: "GET",
        url: "/api/wallet/mint-status",
        headers: requestHeaders(),
        query: {
          statuses: "confirming",
          limit: "20",
        },
      },
    );

    expect(result.statusCode).toBe(200);
    expect(result.body).toMatchObject({
      ok: true,
      data: {
        items: [
          {
            mintQueueId: QUEUE_ID,
            itemInstanceId: ITEM_ID,
            status: "confirming",
            chain: "MAINNET",
            collectionAddress: COLLECTION_ADDRESS,
            targetAddress: ADDRESS,
            transactionHash: "tx_mint_001",
            retryCount: 1,
          },
        ],
        summary: {
          confirming: 1,
        },
        nextCursor: null,
      },
    });
    expect(db.operations[0]).toMatchObject({
      schema: "onchain",
      table: "mint_queue",
      filters: expect.arrayContaining([
        {
          column: "user_id",
          operator: "eq",
          value: USER_ID,
        },
        {
          column: "status",
          operator: "in",
          value: ["confirming"],
        },
      ]),
      rangeValue: [0, 20],
    });
  });

  it("rejects an invalid cursor", async () => {
    const db = createSupabaseQueryMock([]);
    getSupabaseAdminClientMock.mockReturnValue(db.client);

    const { default: mintStatusHandler } =
      await import("../../api/wallet/mint-status");
    const result = await invokeApiHandler<ApiErrorResponse>(mintStatusHandler, {
      method: "GET",
      url: "/api/wallet/mint-status",
      headers: requestHeaders(),
      query: {
        cursor: "not-a-number",
      },
    });

    expect(result.statusCode).toBe(400);
    expect(result.body).toMatchObject({
      ok: false,
      error: {
        code: "VALIDATION_ERROR",
      },
    });
    expect(db.operations).toHaveLength(0);
  });
});

function requestHeaders(): Record<string, string> {
  return {
    cookie: "tma_game_session=test-session-token-000000000000",
    "x-forwarded-for": "127.0.0.72",
  };
}

function createSupabaseQueryMock(results: QueryResult[]) {
  const operations: OperationState[] = [];
  let resultIndex = 0;

  function nextResult(): QueryResult {
    const result = results[resultIndex] ?? {
      data: [],
      error: null,
    };
    resultIndex += 1;
    return result;
  }

  function createBuilder(state: OperationState) {
    const builder = {
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
      order(column: string, options: Record<string, unknown>) {
        state.orders.push({
          column,
          options,
        });
        return builder;
      },
      range(from: number, to: number) {
        state.rangeValue = [from, to];
        return builder;
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
              const state: OperationState = {
                schema,
                table,
                selected: columns,
                filters: [],
                orders: [],
                rangeValue: null,
              };
              operations.push(state);
              return createBuilder(state);
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
