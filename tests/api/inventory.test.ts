import { beforeEach, describe, expect, it, vi } from "vitest";

import type {
  ApiErrorResponse,
  ApiSuccessResponse,
} from "../../api/_shared/handler";
import { buildInventoryListResponse } from "../../api/inventory/list";
import { invokeApiHandler } from "./_utils";

const { callRpcRawMock, requireSessionMock } = vi.hoisted(() => ({
  callRpcRawMock: vi.fn(),
  requireSessionMock: vi.fn(),
}));

vi.mock("../../packages/server/src/db/rpc.js", () => ({
  callRpcRaw: callRpcRawMock,
  RpcError: class RpcError extends Error {
    public readonly rpcName: string;

    constructor(params: { rpcName: string; error?: { message?: string } }) {
      super(params.error?.message ?? "RPC error");
      this.name = "RpcError";
      this.rpcName = params.rpcName;
    }
  },
}));

vi.mock("../../api/_shared/requireSession.js", () => ({
  requireSession: requireSessionMock,
}));

const USER_ID = "11111111-1111-4111-8111-111111111111";
const ITEM_INSTANCE_ID = "22222222-2222-4222-8222-222222222222";
const TEMPLATE_ID = "33333333-3333-4333-8333-333333333333";

describe("inventory API helpers", () => {
  beforeEach(() => {
    process.env.NODE_ENV = "test";
    callRpcRawMock.mockReset();
    requireSessionMock.mockReset();
    requireSessionMock.mockResolvedValue({
      sessionId: "session-inventory-test",
      userId: USER_ID,
      telegramUserId: 7001,
      userStatus: "active",
      expiresAt: "2026-05-28T00:00:00.000Z",
      sessionTokenHash: "session-hash",
    });
  });

  it("maps inventory_list_user_items RPC payload into first-phase API data", () => {
    const response = buildInventoryListResponse(
      {
        items: [
          {
            item_instance_id: "11111111-1111-4111-8111-111111111111",
            template_id: "22222222-2222-4222-8222-222222222222",
            template_slug: "forest_sproutling",
            name: "Forest Sproutling",
            rarity: {
              code: "COMMON",
              display_name: "Common",
              sort_order: 10,
            },
            series: {
              id: "33333333-3333-4333-8333-333333333333",
              slug: "forest_guardians",
              display_name: "Forest Guardians",
            },
            form: {
              id: "44444444-4444-4444-8444-444444444444",
              index: 1,
              display_name: "Forest Sproutling",
            },
            type_code: "CHARACTER",
            serial_no: 7,
            level: 3,
            power: 42,
            status: "available",
            image_url:
              "/storage/v1/object/public/collectibles/forest_sproutling_hero.png",
            tradeable: true,
            upgradeable: true,
            evolvable: true,
            decomposable: true,
            nft_mintable: true,
            obtained_at: "2026-05-21T00:00:00.000Z",
          },
        ],
        total: 3,
        limit: 1,
        offset: 0,
        statuses: ["available"],
        server_time: "2026-05-21T00:00:01.000Z",
      },
      0,
      1,
    );

    expect(response.next_cursor).toBe("1");
    expect(response.items[0]).toMatchObject({
      name: "Forest Sproutling",
      rarity: {
        code: "COMMON",
      },
      level: 3,
      power: 42,
      is_tradeable: true,
    });
  });

  it("/api/inventory/list returns inventory for a logged-in user", async () => {
    callRpcRawMock.mockResolvedValueOnce({
      items: [
        {
          item_instance_id: ITEM_INSTANCE_ID,
          template_id: TEMPLATE_ID,
          template_slug: "forest_sproutling",
          name: "Forest Sproutling",
          rarity: {
            code: "COMMON",
            display_name: "Common",
            sort_order: 10,
          },
          series: {
            id: "44444444-4444-4444-8444-444444444444",
            slug: "forest_guardians",
            display_name: "Forest Guardians",
          },
          form: {
            id: "55555555-5555-4555-8555-555555555555",
            index: 1,
            display_name: "Base Form",
          },
          type_code: "CHARACTER",
          serial_no: 1,
          level: 1,
          power: 10,
          status: "available",
          tradeable: true,
          upgradeable: true,
          evolvable: true,
          decomposable: true,
          nft_mintable: true,
          obtained_at: "2026-05-21T00:00:00.000Z",
        },
      ],
      total: 1,
      limit: 40,
      offset: 0,
      statuses: ["available", "minting", "minted"],
      server_time: "2026-05-21T00:00:00.000Z",
    });

    const { default: inventoryListHandler } =
      await import("../../api/inventory/list");
    const result = await invokeApiHandler<ApiSuccessResponse>(
      inventoryListHandler,
      {
        method: "GET",
        url: "/api/inventory/list",
        query: {
          limit: "40",
        },
        headers: {
          cookie: "tma_game_session=test-session-token-000000000000",
          "x-forwarded-for": "127.0.0.31",
        },
      },
    );

    expect(result.statusCode).toBe(200);
    expect(result.body).toMatchObject({
      ok: true,
      data: {
        total: 1,
        items: [
          {
            item_instance_id: ITEM_INSTANCE_ID,
            template_id: TEMPLATE_ID,
            name: "Forest Sproutling",
            status: "available",
            is_tradeable: true,
          },
        ],
      },
    });
    expect(callRpcRawMock).toHaveBeenCalledWith(
      "inventory_list_user_items",
      expect.objectContaining({
        p_user_id: USER_ID,
        p_statuses: ["available", "minting", "minted"],
        p_limit: 40,
        p_offset: 0,
      }),
      expect.any(Object),
    );
  });

  it("/api/inventory/list includes locked states only when requested", async () => {
    callRpcRawMock.mockResolvedValueOnce({
      items: [],
      total: 0,
      limit: 40,
      offset: 0,
      statuses: ["available", "locked", "listed", "minting", "minted"],
      server_time: "2026-05-21T00:00:00.000Z",
    });

    const { default: inventoryListHandler } =
      await import("../../api/inventory/list");
    const result = await invokeApiHandler<ApiSuccessResponse>(
      inventoryListHandler,
      {
        method: "GET",
        url: "/api/inventory/list",
        query: {
          include_locked: "true",
        },
      },
    );

    expect(result.statusCode).toBe(200);
    expect(callRpcRawMock).toHaveBeenCalledWith(
      "inventory_list_user_items",
      expect.objectContaining({
        p_user_id: USER_ID,
        p_statuses: ["available", "locked", "listed", "minting", "minted"],
        p_limit: 40,
        p_offset: 0,
      }),
      expect.any(Object),
    );
  });

  it("/api/inventory/list rejects the not-yet-supported only_sellable filter", async () => {
    const { default: inventoryListHandler } =
      await import("../../api/inventory/list");
    const result = await invokeApiHandler<ApiErrorResponse>(
      inventoryListHandler,
      {
        method: "GET",
        url: "/api/inventory/list",
        query: {
          only_sellable: "true",
        },
      },
    );

    expect(result.statusCode).toBe(400);
    expect(result.body).toMatchObject({
      ok: false,
      error: {
        code: "BAD_REQUEST",
        details: {
          unsupported: ["only_sellable"],
        },
      },
    });
    expect(callRpcRawMock).not.toHaveBeenCalled();
  });
});
