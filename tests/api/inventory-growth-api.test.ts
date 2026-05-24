import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  ApiError,
  type ApiErrorResponse,
  type ApiSuccessResponse,
} from "../../api/_shared/handler";
import activityHandler from "../../api/inventory/activity";
import decomposeHandler from "../../api/inventory/decompose";
import detailHandler from "../../api/inventory/detail";
import evolveHandler from "../../api/inventory/evolve";
import upgradeHandler from "../../api/inventory/upgrade";
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
const FORGED_USER_ID = "99999999-9999-4999-8999-999999999999";
const ITEM_ID = "22222222-2222-4222-8222-222222222222";
const ITEM_ID_2 = "33333333-3333-4333-8333-333333333333";
const ITEM_ID_3 = "44444444-4444-4444-8444-444444444444";
const TEMPLATE_ID = "55555555-5555-4555-8555-555555555555";
const ACTIVITY_ID = "66666666-6666-4666-8666-666666666666";
const IDEMPOTENCY_KEY = "inventory:growth-api-0001";
const BODY_IDEMPOTENCY_KEY = "inventory:growth-api-body";
const LEDGER_ID = "88888888-8888-4888-8888-888888888888";

describe("inventory growth API", () => {
  beforeEach(() => {
    process.env.NODE_ENV = "test";
    callRpcRawMock.mockReset();
    requireSessionMock.mockReset();
    requireSessionMock.mockResolvedValue({
      sessionId: "session-inventory-growth-api-test",
      userId: USER_ID,
      telegramUserId: 7001,
      userStatus: "active",
      expiresAt: "2026-05-28T00:00:00.000Z",
      sessionTokenHash: "session-hash",
    });
  });

  it("detail calls inventory_get_item_detail with the session user", async () => {
    callRpcRawMock.mockResolvedValueOnce({
      item_instance_id: ITEM_ID,
      template_id: TEMPLATE_ID,
      name: "Moon Crown Guardian",
      level: 1,
      power: 390,
      status: "available",
      is_tradeable: true,
      is_upgradeable: true,
      is_evolvable: true,
      is_decomposable: true,
      is_mintable: true,
    });

    const result = await invokeApiHandler<ApiSuccessResponse>(detailHandler, {
      method: "GET",
      query: {
        item_instance_id: ITEM_ID,
      },
      headers: {
        "x-request-id": "req-inventory-detail-test",
      },
    });

    expect(result.statusCode).toBe(200);
    expect(callRpcRawMock).toHaveBeenCalledWith(
      "inventory_get_item_detail",
      expect.objectContaining({
        p_user_id: USER_ID,
        p_item_instance_id: ITEM_ID,
        p_include_market_status: true,
        p_include_upgrade_preview: true,
        p_include_evolution_preview: true,
        p_include_decompose_preview: true,
        p_include_onchain_status: true,
      }),
      expect.objectContaining({
        schema: "api",
        context: expect.objectContaining({
          requestId: "req-inventory-detail-test",
          userId: USER_ID,
          itemInstanceId: ITEM_ID,
        }),
      }),
    );
    expect(result.body.data).toMatchObject({
      item_instance_id: ITEM_ID,
      template_id: TEMPLATE_ID,
      is_upgradeable: true,
    });
  });

  it("requires a session before inventory detail can call RPC", async () => {
    requireSessionMock.mockRejectedValueOnce(
      ApiError.unauthorized("Unauthorized"),
    );

    const result = await invokeApiHandler<ApiErrorResponse>(detailHandler, {
      method: "GET",
      query: {
        item_instance_id: ITEM_ID,
      },
    });

    expect(result.statusCode).toBe(401);
    expect(result.body.error.code).toBe("UNAUTHORIZED");
    expect(callRpcRawMock).not.toHaveBeenCalled();
  });

  it("upgrade rejects forged user_id before calling RPC", async () => {
    const result = await invokeApiHandler<ApiErrorResponse>(upgradeHandler, {
      method: "POST",
      body: {
        item_instance_id: ITEM_ID,
        idempotency_key: IDEMPOTENCY_KEY,
        user_id: FORGED_USER_ID,
      },
    });

    expect(result.statusCode).toBe(400);
    expect(result.body.error.code).toBe("VALIDATION_ERROR");
    expect(callRpcRawMock).not.toHaveBeenCalled();
  });

  it("upgrade reads the idempotency key from headers", async () => {
    callRpcRawMock.mockResolvedValueOnce({
      item_instance_id: ITEM_ID,
      from_level: 1,
      to_level: 2,
      from_power: 390,
      to_power: 415,
      cost_fgems: 80,
      fgems_balance_before: 1000,
      fgems_balance_after: 920,
      balance_delta: -80,
      ledger_id: LEDGER_ID,
    });

    const result = await invokeApiHandler<ApiSuccessResponse>(upgradeHandler, {
      method: "POST",
      headers: {
        "x-request-id": "req-inventory-upgrade-test",
        "x-idempotency-key": IDEMPOTENCY_KEY,
      },
      body: {
        item_instance_id: ITEM_ID,
        idempotency_key: BODY_IDEMPOTENCY_KEY,
      },
    });

    expect(result.statusCode).toBe(200);
    expect(callRpcRawMock).toHaveBeenCalledWith(
      "inventory_upgrade_item",
      {
        p_user_id: USER_ID,
        p_item_instance_id: ITEM_ID,
        p_idempotency_key: IDEMPOTENCY_KEY,
      },
      expect.objectContaining({
        schema: "api",
        context: expect.objectContaining({
          requestId: "req-inventory-upgrade-test",
          userId: USER_ID,
          itemInstanceId: ITEM_ID,
          idempotencyKey: IDEMPOTENCY_KEY,
        }),
      }),
    );
    expect(result.body.data).toMatchObject({
      item_instance_id: ITEM_ID,
      to_level: 2,
      consumed_fgems: 80,
      fgems_balance_before: 1000,
      fgems_balance_after: 920,
      balance_change: -80,
      ledger_id: LEDGER_ID,
    });
  });

  it("upgrade maps unavailable items to a stable conflict", async () => {
    callRpcRawMock.mockRejectedValueOnce(
      new RpcError({
        rpcName: "inventory_upgrade_item",
        error: {
          message: "item is not available",
        },
      }),
    );

    const result = await invokeApiHandler<ApiErrorResponse>(upgradeHandler, {
      method: "POST",
      body: {
        item_instance_id: ITEM_ID,
        idempotency_key: IDEMPOTENCY_KEY,
      },
    });

    expect(result.statusCode).toBe(409);
    expect(result.body.error.code).toBe("ITEM_NOT_AVAILABLE");
  });

  it("evolve calls inventory_evolve_item and normalizes failed results", async () => {
    callRpcRawMock.mockResolvedValueOnce({
      attempt_id: "77777777-7777-4777-8777-777777777777",
      success: false,
      main_item_instance_id: ITEM_ID,
      result_item_instance_id: null,
      cost_kcoin: 2000,
      kcoin_balance_before: 5000,
      kcoin_balance_after: 3000,
      balance_delta: -2000,
      ledger_id: LEDGER_ID,
      success_rate_bps: 5000,
      random_roll_bps: 7000,
    });

    const result = await invokeApiHandler<ApiSuccessResponse>(evolveHandler, {
      method: "POST",
      headers: {
        "x-idempotency-key": IDEMPOTENCY_KEY,
      },
      body: {
        source_item_instance_ids: [ITEM_ID, ITEM_ID_2, ITEM_ID_3],
        idempotency_key: BODY_IDEMPOTENCY_KEY,
      },
    });

    expect(result.statusCode).toBe(200);
    expect(callRpcRawMock).toHaveBeenCalledWith(
      "inventory_evolve_item",
      {
        p_user_id: USER_ID,
        p_item_instance_ids: [ITEM_ID, ITEM_ID_2, ITEM_ID_3],
        p_idempotency_key: IDEMPOTENCY_KEY,
      },
      expect.objectContaining({ schema: "api" }),
    );
    expect(result.body.data).toMatchObject({
      result: "failed",
      returned_item_instance_id: ITEM_ID,
      consumed_item_instance_ids: [ITEM_ID_2, ITEM_ID_3],
      consumed_kcoin: 2000,
      kcoin_balance_before: 5000,
      kcoin_balance_after: 3000,
      balance_change: -2000,
      ledger_id: LEDGER_ID,
    });
  });

  it("evolve maps insufficient balance errors", async () => {
    callRpcRawMock.mockRejectedValueOnce(
      new RpcError({
        rpcName: "inventory_evolve_item",
        error: {
          message:
            "insufficient balance: currency KCOIN, available 0, required 2000",
        },
      }),
    );

    const result = await invokeApiHandler<ApiErrorResponse>(evolveHandler, {
      method: "POST",
      body: {
        source_item_instance_ids: [ITEM_ID, ITEM_ID_2, ITEM_ID_3],
        idempotency_key: IDEMPOTENCY_KEY,
      },
    });

    expect(result.statusCode).toBe(409);
    expect(result.body.error.code).toBe("INSUFFICIENT_KCOIN");
  });

  it("evolve maps unavailable or non-evolvable materials to a stable conflict", async () => {
    callRpcRawMock.mockRejectedValueOnce(
      new RpcError({
        rpcName: "inventory_evolve_item",
        error: {
          message: "some items are not evolvable or not available",
        },
      }),
    );

    const result = await invokeApiHandler<ApiErrorResponse>(evolveHandler, {
      method: "POST",
      body: {
        source_item_instance_ids: [ITEM_ID, ITEM_ID_2, ITEM_ID_3],
        idempotency_key: IDEMPOTENCY_KEY,
      },
    });

    expect(result.statusCode).toBe(409);
    expect(result.body.error.code).toBe("ITEM_NOT_EVOLVABLE");
  });

  it("decompose calls the batch inventory_decompose_items RPC", async () => {
    callRpcRawMock.mockResolvedValueOnce({
      item_instance_ids: [ITEM_ID],
      total_reward_fgems: 150,
      fgems_balance_before: 100,
      fgems_balance_after: 250,
      balance_delta: 150,
      ledger_id: LEDGER_ID,
      items: [
        {
          item_instance_id: ITEM_ID,
          reward_fgems: 150,
        },
      ],
    });

    const result = await invokeApiHandler<ApiSuccessResponse>(
      decomposeHandler,
      {
        method: "POST",
        headers: {
          "x-idempotency-key": IDEMPOTENCY_KEY,
        },
        body: {
          item_instance_ids: [ITEM_ID],
          idempotency_key: BODY_IDEMPOTENCY_KEY,
        },
      },
    );

    expect(result.statusCode).toBe(200);
    expect(callRpcRawMock).toHaveBeenCalledWith(
      "inventory_decompose_items",
      {
        p_user_id: USER_ID,
        p_item_instance_ids: [ITEM_ID],
        p_idempotency_key: IDEMPOTENCY_KEY,
      },
      expect.objectContaining({ schema: "api" }),
    );
    expect(result.body.data).toMatchObject({
      decomposed_item_instance_ids: [ITEM_ID],
      gained_fgems: 150,
      fgems_balance_before: 100,
      fgems_balance_after: 250,
      balance_change: 150,
      ledger_id: LEDGER_ID,
    });
  });

  it("decompose maps locked or minting items to a stable conflict", async () => {
    callRpcRawMock.mockRejectedValueOnce(
      new RpcError({
        rpcName: "inventory_decompose_items",
        error: {
          message: "item is minting",
        },
      }),
    );

    const result = await invokeApiHandler<ApiErrorResponse>(decomposeHandler, {
      method: "POST",
      body: {
        item_instance_ids: [ITEM_ID],
        idempotency_key: IDEMPOTENCY_KEY,
      },
    });

    expect(result.statusCode).toBe(409);
    expect(result.body.error.code).toBe("ITEM_NOT_AVAILABLE");
  });

  it("activity calls inventory_list_activity with validated filters", async () => {
    callRpcRawMock.mockResolvedValueOnce({
      items: [
        {
          activity_id: ACTIVITY_ID,
          activity_type: "upgraded",
          item_instance_id: ITEM_ID,
          template_id: TEMPLATE_ID,
          source_type: "inventory_upgrade",
          title: "Item upgraded",
          created_at: "2026-05-24T15:00:00.000Z",
        },
      ],
      next_cursor:
        "2026-05-24T15:00:00.000Z|66666666-6666-4666-8666-666666666666",
    });

    const result = await invokeApiHandler<ApiSuccessResponse>(activityHandler, {
      method: "GET",
      headers: {
        "x-request-id": "req-inventory-activity-test",
      },
      query: {
        item_instance_id: ITEM_ID,
        activity_types: "upgraded,decomposed",
        limit: "20",
      },
    });

    expect(result.statusCode).toBe(200);
    expect(callRpcRawMock).toHaveBeenCalledWith(
      "inventory_list_activity",
      {
        p_user_id: USER_ID,
        p_item_instance_id: ITEM_ID,
        p_template_id: null,
        p_activity_types: ["upgraded", "decomposed"],
        p_from_at: null,
        p_to_at: null,
        p_limit: 20,
        p_cursor: null,
      },
      expect.objectContaining({
        schema: "api",
        context: expect.objectContaining({
          requestId: "req-inventory-activity-test",
          userId: USER_ID,
          itemInstanceId: ITEM_ID,
          limit: 20,
        }),
      }),
    );
    expect(result.body.data).toMatchObject({
      items: [
        {
          activity_id: ACTIVITY_ID,
          activity_type: "upgraded",
          item_instance_id: ITEM_ID,
        },
      ],
    });
  });
});
