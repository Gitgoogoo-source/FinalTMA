import { beforeEach, describe, expect, it, vi } from "vitest";

import type {
  ApiErrorResponse,
  ApiSuccessResponse,
} from "../../api/_shared/handler";
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
const ITEM_ID = "44444444-4444-4444-8444-444444444444";
const QUEUE_ID = "77777777-7777-4777-8777-777777777777";
const ADDRESS = `EQ${"A".repeat(46)}`;
const COLLECTION_ADDRESS = `EQ${"C".repeat(46)}`;

describe("wallet mint status API", () => {
  beforeEach(() => {
    callRpcRawMock.mockReset();
    callRpcRawMock.mockResolvedValue({
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
          createdAt: "2026-05-29T08:00:00.000Z",
          updatedAt: "2026-05-29T08:01:00.000Z",
        },
      ],
      summary: {
        queued: 0,
        processing: 0,
        submitted: 0,
        confirming: 1,
        retrying: 0,
        manual_review: 0,
        minted: 0,
        failed: 0,
        cancelled: 0,
      },
      nextCursor: null,
      serverTime: "2026-05-29T08:02:00.000Z",
    });
    getSupabaseAdminClientMock.mockReset();
    getSupabaseAdminClientMock.mockReturnValue({});
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

  it("queries the current user's Mint queue through the API RPC facade", async () => {
    const db = {};
    getSupabaseAdminClientMock.mockReturnValue(db);

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
    expect(callRpcRawMock).toHaveBeenCalledWith(
      "wallet_get_mint_status",
      {
        p_user_id: USER_ID,
        p_mint_queue_id: null,
        p_item_instance_id: null,
        p_statuses: ["confirming"],
        p_offset: 0,
        p_limit: 20,
      },
      expect.objectContaining({
        schema: "api",
        client: db,
      }),
    );
  });

  it("rejects an invalid cursor", async () => {
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
    expect(callRpcRawMock).not.toHaveBeenCalled();
  });
});

function requestHeaders(): Record<string, string> {
  return {
    cookie: "tma_game_session=test-session-token-000000000000",
    "x-forwarded-for": "127.0.0.72",
  };
}
