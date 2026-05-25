import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  ApiError,
  type ApiErrorResponse,
  type ApiSuccessResponse,
} from "../../api/_shared/handler";
import itemsHandler from "../../api/album/items";
import progressHandler from "../../api/album/progress";
import seriesHandler from "../../api/album/series";
import { RpcError } from "../../packages/server/src/db/rpc";
import { invokeApiHandler } from "./_utils";

const { callRpcRawMock, requireSessionMock } = vi.hoisted(() => ({
  callRpcRawMock: vi.fn(),
  requireSessionMock: vi.fn(),
}));

vi.mock("../../packages/server/src/db/rpc.js", () => ({
  callRpcRaw: callRpcRawMock,
  RpcError: class RpcError extends Error {
    public readonly rpcName: string;
    public readonly details: string | null | undefined;
    public readonly hint: string | null | undefined;
    public readonly code: string | null | undefined;

    constructor(params: {
      rpcName: string;
      error?: {
        message?: string;
        details?: string | null;
        hint?: string | null;
        code?: string | null;
      };
    }) {
      super(params.error?.message ?? "RPC error");
      this.name = "RpcError";
      this.rpcName = params.rpcName;
      this.details = params.error?.details;
      this.hint = params.error?.hint;
      this.code = params.error?.code;
    }
  },
}));

vi.mock("../../api/_shared/requireSession.js", () => ({
  requireSession: requireSessionMock,
}));

const USER_ID = "11111111-1111-4111-8111-111111111111";
const BOOK_ID = "22222222-2222-4222-8222-222222222222";
const SERIES_ID = "33333333-3333-4333-8333-333333333333";
const TEMPLATE_ID = "44444444-4444-4444-8444-444444444444";
const FORM_ID = "55555555-5555-4555-8555-555555555555";
const MILESTONE_ID = "66666666-6666-4666-8666-666666666666";
const FORGED_USER_ID = "99999999-9999-4999-8999-999999999999";

function expectStandardSuccessEnvelope(body: ApiSuccessResponse): void {
  expect(body).toMatchObject({
    ok: true,
    success: true,
    data: expect.any(Object),
  });
}

function expectStandardErrorEnvelope(body: ApiErrorResponse): void {
  expect(body).toMatchObject({
    ok: false,
    success: false,
    error: {
      code: expect.any(String),
      message: expect.any(String),
    },
  });
}

describe("album API", () => {
  beforeEach(() => {
    process.env.NODE_ENV = "test";
    callRpcRawMock.mockReset();
    requireSessionMock.mockReset();
    requireSessionMock.mockResolvedValue({
      sessionId: "session-album-api-test",
      userId: USER_ID,
      telegramUserId: 7001,
      userStatus: "active",
      expiresAt: "2026-05-28T00:00:00.000Z",
      sessionTokenHash: "session-hash",
    });
  });

  it("progress calls album_get_progress with the session user", async () => {
    callRpcRawMock.mockResolvedValueOnce({
      book: {
        book_id: BOOK_ID,
        book_type: "all",
        name: "全图鉴",
        total_count: 12,
        collected_count: 4,
        completion_percent: 33.33,
      },
      items: [
        {
          template_id: TEMPLATE_ID,
          form_id: FORM_ID,
          name: "Moon Crown Guardian",
          rarity: "LEGENDARY",
          type: "character",
          is_collected: true,
          first_collected_at: "2026-05-24T00:00:00.000Z",
        },
      ],
      milestones: [
        {
          milestone_id: MILESTONE_ID,
          book_id: BOOK_ID,
          required_count: 3,
          required_percent: 25,
          title: "收集 3 个",
          status: "claimable",
          rewards: [
            {
              reward_type: "FGEMS",
              amount: 100,
              label: "100 FGEMS",
            },
          ],
          version: 0,
        },
      ],
      rarity_summary: [
        {
          rarity: "LEGENDARY",
          total_count: 2,
          collected_count: 1,
        },
      ],
      series_summary: [
        {
          series_id: SERIES_ID,
          series_name: "Genesis",
          total_count: 12,
          collected_count: 4,
        },
      ],
      server_time: "2026-05-24T00:00:00.000Z",
    });

    const result = await invokeApiHandler<ApiSuccessResponse>(progressHandler, {
      method: "GET",
      query: {
        book_id: BOOK_ID,
        include_locked_items: "false",
      },
      headers: {
        "x-request-id": "req-album-progress-test",
      },
    });

    expect(result.statusCode).toBe(200);
    expectStandardSuccessEnvelope(result.body);
    expect(callRpcRawMock).toHaveBeenCalledWith(
      "album_get_progress",
      expect.objectContaining({
        p_user_id: USER_ID,
        p_book_id: BOOK_ID,
        p_book_type: null,
        p_series_id: null,
        p_faction_id: null,
        p_rarity: null,
        p_include_items: true,
        p_include_milestones: true,
        p_include_rewards: true,
        p_include_locked_items: false,
      }),
      expect.objectContaining({
        schema: "api",
        context: expect.objectContaining({
          requestId: "req-album-progress-test",
          userId: USER_ID,
          bookId: BOOK_ID,
        }),
      }),
    );
    expect(result.body.data).toMatchObject({
      book: {
        book_id: BOOK_ID,
        total_count: 12,
        collected_count: 4,
        completion_percent: 33.33,
      },
      items: [
        expect.objectContaining({
          template_id: TEMPLATE_ID,
          rarity: "legendary",
          is_collected: true,
        }),
      ],
      milestones: [
        expect.objectContaining({
          milestone_id: MILESTONE_ID,
          status: "claimable",
        }),
      ],
      rarity_summary: [
        expect.objectContaining({
          rarity: "legendary",
        }),
      ],
      empty: false,
    });
  });

  it("requires a session before album progress can call RPC", async () => {
    requireSessionMock.mockRejectedValueOnce(
      ApiError.unauthorized("Unauthorized"),
    );

    const result = await invokeApiHandler<ApiErrorResponse>(progressHandler, {
      method: "GET",
    });

    expect(result.statusCode).toBe(401);
    expectStandardErrorEnvelope(result.body);
    expect(result.body.error.code).toBe("UNAUTHORIZED");
    expect(callRpcRawMock).not.toHaveBeenCalled();
  });

  it("progress rejects incomplete scoped filters before calling RPC", async () => {
    const result = await invokeApiHandler<ApiErrorResponse>(progressHandler, {
      method: "GET",
      query: {
        book_type: "series",
      },
    });

    expect(result.statusCode).toBe(400);
    expectStandardErrorEnvelope(result.body);
    expect(result.body.error.code).toBe("VALIDATION_ERROR");
    expect(callRpcRawMock).not.toHaveBeenCalled();
  });

  it("progress rejects forged user_id query fields before calling RPC", async () => {
    const result = await invokeApiHandler<ApiErrorResponse>(progressHandler, {
      method: "GET",
      query: {
        user_id: FORGED_USER_ID,
      },
    });

    expect(result.statusCode).toBe(400);
    expectStandardErrorEnvelope(result.body);
    expect(result.body.error.code).toBe("VALIDATION_ERROR");
    expect(callRpcRawMock).not.toHaveBeenCalled();
  });

  it("progress maps RPC failures to a stable error code", async () => {
    callRpcRawMock.mockRejectedValueOnce(
      new RpcError({
        rpcName: "album_get_progress",
        error: {
          message: "database is unavailable",
        },
      }),
    );

    const result = await invokeApiHandler<ApiErrorResponse>(progressHandler, {
      method: "GET",
    });

    expect(result.statusCode).toBe(500);
    expectStandardErrorEnvelope(result.body);
    expect(result.body.error.code).toBe("ALBUM_PROGRESS_RPC_FAILED");
    expect(result.body.error.message).toBe("Internal server error");
  });

  it("requires a session before album series can call RPC", async () => {
    requireSessionMock.mockRejectedValueOnce(
      ApiError.authSessionExpired("登录状态缺失，请重新进入应用。"),
    );

    const result = await invokeApiHandler<ApiErrorResponse>(seriesHandler, {
      method: "GET",
    });

    expect(result.statusCode).toBe(401);
    expectStandardErrorEnvelope(result.body);
    expect(result.body.error.code).toBe("AUTH_SESSION_EXPIRED");
    expect(callRpcRawMock).not.toHaveBeenCalled();
  });

  it("series calls album_list_books with validated filters and offset cursor", async () => {
    callRpcRawMock.mockResolvedValueOnce({
      books: [
        {
          book_id: BOOK_ID,
          book_type: "series",
          name: "Genesis",
          total_count: 12,
          collected_count: 4,
          completion_percent: 33.33,
          series_id: SERIES_ID,
        },
      ],
      total: 100,
      limit: 20,
      offset: 40,
      next_cursor: "60",
      server_time: "2026-05-24T00:00:00.000Z",
    });

    const result = await invokeApiHandler<ApiSuccessResponse>(seriesHandler, {
      method: "GET",
      query: {
        book_type: "series",
        series_ids: SERIES_ID,
        rarities: "legendary",
        limit: "20",
        cursor: "40",
      },
      headers: {
        "x-request-id": "req-album-series-test",
      },
    });

    expect(result.statusCode).toBe(200);
    expectStandardSuccessEnvelope(result.body);
    expect(callRpcRawMock).toHaveBeenCalledWith(
      "album_list_books",
      {
        p_user_id: USER_ID,
        p_book_type: "series",
        p_series_ids: [SERIES_ID],
        p_faction_ids: null,
        p_rarities: ["legendary"],
        p_limit: 20,
        p_offset: 40,
      },
      expect.objectContaining({
        schema: "api",
        context: expect.objectContaining({
          requestId: "req-album-series-test",
          userId: USER_ID,
          bookType: "series",
          limit: 20,
          offset: 40,
        }),
      }),
    );
    expect(result.body.data).toMatchObject({
      books: [
        expect.objectContaining({
          book_id: BOOK_ID,
          book_type: "series",
          series_id: SERIES_ID,
        }),
      ],
      total: 100,
      limit: 20,
      offset: 40,
      next_cursor: "60",
    });
  });

  it("series rejects filters that the current RPC cannot apply", async () => {
    const result = await invokeApiHandler<ApiErrorResponse>(seriesHandler, {
      method: "GET",
      query: {
        keyword: "Genesis",
      },
    });

    expect(result.statusCode).toBe(400);
    expectStandardErrorEnvelope(result.body);
    expect(result.body.error.code).toBe("BAD_REQUEST");
    expect(callRpcRawMock).not.toHaveBeenCalled();
  });

  it("series rejects forged user_id query fields before calling RPC", async () => {
    const result = await invokeApiHandler<ApiErrorResponse>(seriesHandler, {
      method: "GET",
      query: {
        user_id: FORGED_USER_ID,
      },
    });

    expect(result.statusCode).toBe(400);
    expectStandardErrorEnvelope(result.body);
    expect(result.body.error.code).toBe("VALIDATION_ERROR");
    expect(callRpcRawMock).not.toHaveBeenCalled();
  });

  it("series maps RPC failures to a stable error code", async () => {
    callRpcRawMock.mockRejectedValueOnce(
      new RpcError({
        rpcName: "album_list_books",
        error: {
          message: "database is unavailable",
        },
      }),
    );

    const result = await invokeApiHandler<ApiErrorResponse>(seriesHandler, {
      method: "GET",
    });

    expect(result.statusCode).toBe(500);
    expectStandardErrorEnvelope(result.body);
    expect(result.body.error.code).toBe("ALBUM_SERIES_RPC_FAILED");
  });

  it("items returns filtered album items through album_get_progress", async () => {
    callRpcRawMock.mockResolvedValueOnce({
      book: {
        book_id: BOOK_ID,
        book_type: "all",
        name: "全图鉴",
        total_count: 3,
        collected_count: 2,
        completion_percent: 66.67,
      },
      items: [
        {
          template_id: TEMPLATE_ID,
          form_id: FORM_ID,
          name: "Moon Crown Guardian",
          rarity: "LEGENDARY",
          type: "character",
          is_collected: true,
          first_collected_at: "2026-05-24T00:00:00.000Z",
          album_order: 2,
        },
        {
          template_id: "77777777-7777-4777-8777-777777777777",
          name: "Locked Pet",
          rarity: "RARE",
          type: "pet",
          is_collected: false,
          album_order: 1,
        },
        {
          template_id: "88888888-8888-4888-8888-888888888888",
          name: "Sun Crown Guardian",
          rarity: "EPIC",
          type: "character",
          is_collected: true,
          first_collected_at: "2026-05-25T00:00:00.000Z",
          album_order: 3,
        },
      ],
      server_time: "2026-05-24T00:00:00.000Z",
    });

    const result = await invokeApiHandler<ApiSuccessResponse>(itemsHandler, {
      method: "GET",
      query: {
        book_id: BOOK_ID,
        status: "collected",
        type: "character",
        sort: "collected_at_desc",
        limit: "1",
      },
      headers: {
        "x-request-id": "req-album-items-test",
      },
    });

    expect(result.statusCode).toBe(200);
    expectStandardSuccessEnvelope(result.body);
    expect(callRpcRawMock).toHaveBeenCalledWith(
      "album_get_progress",
      expect.objectContaining({
        p_user_id: USER_ID,
        p_book_id: BOOK_ID,
        p_include_items: true,
        p_include_milestones: false,
        p_include_rewards: false,
        p_include_locked_items: false,
      }),
      expect.objectContaining({
        schema: "api",
        context: expect.objectContaining({
          requestId: "req-album-items-test",
          userId: USER_ID,
          bookId: BOOK_ID,
        }),
      }),
    );
    expect(result.body.data).toMatchObject({
      book: {
        book_id: BOOK_ID,
        total_count: 3,
        collected_count: 2,
      },
      total: 2,
      limit: 1,
      offset: 0,
      next_cursor: "1",
      items: [
        expect.objectContaining({
          template_id: "88888888-8888-4888-8888-888888888888",
          name: "Sun Crown Guardian",
          rarity: "epic",
          is_collected: true,
        }),
      ],
    });
  });

  it("items rejects invalid cursors before calling RPC", async () => {
    const result = await invokeApiHandler<ApiErrorResponse>(itemsHandler, {
      method: "GET",
      query: {
        cursor: "bad-cursor",
      },
    });

    expect(result.statusCode).toBe(400);
    expectStandardErrorEnvelope(result.body);
    expect(result.body.error.code).toBe("BAD_REQUEST");
    expect(callRpcRawMock).not.toHaveBeenCalled();
  });
});
