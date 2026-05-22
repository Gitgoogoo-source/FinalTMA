import { beforeEach, describe, expect, it, vi } from "vitest";

import type {
  ApiErrorResponse,
  ApiSuccessResponse,
} from "../../api/_shared/handler";
import {
  buildCreateOpenOrderResponse,
  isDevGachaPaymentModeEnabled,
  normalizeCreateOpenOrderInput,
} from "../../api/boxes/create-open-order";
import { toDrawResultResponse } from "../../api/boxes/result";
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

const BOX_ID = "11111111-1111-4111-8111-111111111111";
const ORDER_ID = "22222222-2222-4222-8222-222222222222";
const STAR_ORDER_ID = "33333333-3333-4333-8333-333333333333";
const IDEMPOTENCY_KEY = "open:test-idempotency-001";
const USER_ID = "66666666-6666-4666-8666-666666666666";

describe("boxes API helpers", () => {
  beforeEach(() => {
    process.env.NODE_ENV = "test";
    delete process.env.DEV_GACHA_PAYMENT_MODE;
    callRpcRawMock.mockReset();
    requireSessionMock.mockReset();
    requireSessionMock.mockResolvedValue({
      sessionId: "session-boxes-test",
      userId: USER_ID,
      telegramUserId: 7001,
      userStatus: "active",
      expiresAt: "2026-05-28T00:00:00.000Z",
      sessionTokenHash: "session-hash",
    });
  });

  it("normalizes first-phase snake_case create-order input", () => {
    expect(
      normalizeCreateOpenOrderInput(
        {
          box_id: BOX_ID,
          draw_count: 10,
          idempotency_key: IDEMPOTENCY_KEY,
        },
        null,
      ),
    ).toMatchObject({
      boxId: BOX_ID,
      openType: "ten",
      quantity: 10,
      idempotencyKey: IDEMPOTENCY_KEY,
    });
  });

  it("uses the idempotency header when the body omits idempotency_key", () => {
    expect(
      normalizeCreateOpenOrderInput(
        {
          box_id: BOX_ID,
          draw_count: 1,
        },
        IDEMPOTENCY_KEY,
      ),
    ).toMatchObject({
      openType: "single",
      quantity: 1,
      idempotencyKey: IDEMPOTENCY_KEY,
    });
  });

  it("detects enabled dev gacha payment modes", () => {
    expect(isDevGachaPaymentModeEnabled("true")).toBe(true);
    expect(isDevGachaPaymentModeEnabled("1")).toBe(true);
    expect(isDevGachaPaymentModeEnabled("false")).toBe(false);
    expect(isDevGachaPaymentModeEnabled(undefined)).toBe(false);
  });

  it("marks dev-paid opened orders as result-ready", () => {
    const response = buildCreateOpenOrderResponse(
      {
        draw_order_id: ORDER_ID,
        star_order_id: STAR_ORDER_ID,
        invoice_payload: `gacha:${ORDER_ID}`,
        xtr_amount: 90,
        quantity: 10,
        discount_bps: 1000,
        idempotent: false,
      },
      {
        boxId: BOX_ID,
        openType: "ten",
        quantity: 10,
        paymentProvider: "telegram_stars",
        idempotencyKey: IDEMPOTENCY_KEY,
      },
      {
        draw_order_id: ORDER_ID,
        status: "opened",
        payment_status: "dev_paid",
      },
    );

    expect(response).toMatchObject({
      order_id: ORDER_ID,
      star_order_id: STAR_ORDER_ID,
      draw_count: 10,
      order_status: "opened",
      payment_status: "dev_paid",
      dev_payment_processed: true,
      result_ready: true,
    });
  });

  it("returns total K-coin reward for ten draw results", () => {
    const response = toDrawResultResponse(
      {
        draw_order_id: ORDER_ID,
        status: "opened",
        quantity: 10,
        total_price_stars: 90,
        open_reward_kcoin: 100,
        paid_at: "2026-05-21T00:00:00.000Z",
        opened_at: "2026-05-21T00:00:01.000Z",
        results: [
          {
            draw_index: 1,
            was_pity: true,
            item_instance_id: "44444444-4444-4444-8444-444444444444",
            template_id: "55555555-5555-4555-8555-555555555555",
            display_name: "测试藏品",
            rarity_code: "EPIC",
            rarity_display_name: "史诗",
            type_code: "character",
            level: 1,
            power: 100,
          },
        ],
      },
      true,
    );

    expect(response).toMatchObject({
      status: "completed",
      quantity: 10,
      paid_stars: 90,
      returned_kcoin: 1000,
    });
    expect(response.results).toHaveLength(1);
    expect(response.results[0]).toMatchObject({
      draw_index: 1,
      is_pity_hit: true,
      name: "测试藏品",
    });
  });

  it("/api/me/bootstrap returns 401 without a session", async () => {
    requireSessionMock.mockRejectedValueOnce({
      statusCode: 401,
      code: "AUTH_SESSION_EXPIRED",
      message: "登录状态缺失，请重新进入应用。",
      expose: true,
    });

    const { default: bootstrapHandler } =
      await import("../../api/me/bootstrap");
    const result = await invokeApiHandler<ApiErrorResponse>(bootstrapHandler, {
      method: "GET",
      url: "/api/me/bootstrap",
      headers: {
        "x-forwarded-for": "127.0.0.21",
      },
    });

    expect(result.statusCode).toBe(401);
    expect(result.body).toMatchObject({
      ok: false,
      error: {
        code: "AUTH_SESSION_EXPIRED",
      },
    });
  });

  it("/api/boxes/list returns boxes for a logged-in user", async () => {
    callRpcRawMock.mockResolvedValueOnce({
      items: [
        {
          id: BOX_ID,
          slug: "test-box",
          display_name: "测试盲盒",
          status: "active",
          single_star_price: 10,
          ten_draw_price: 90,
          is_openable: true,
        },
      ],
      next_cursor: null,
      server_time: "2026-05-21T00:00:00.000Z",
    });

    const { default: listHandler } = await import("../../api/boxes/list");
    const result = await invokeApiHandler<ApiSuccessResponse>(listHandler, {
      method: "GET",
      url: "/api/boxes/list",
      query: {
        limit: "20",
      },
      headers: {
        authorization: "Bearer test-session-token-000000000000",
        "x-forwarded-for": "127.0.0.22",
      },
    });

    expect(result.statusCode).toBe(200);
    expect(result.body).toMatchObject({
      ok: true,
      data: {
        items: [
          {
            id: BOX_ID,
            display_name: "测试盲盒",
            status: "active",
          },
        ],
      },
    });
    expect(callRpcRawMock).toHaveBeenCalledWith(
      "gacha_list_boxes",
      expect.objectContaining({
        p_user_id: USER_ID,
        p_limit: 20,
      }),
      expect.any(Object),
    );
  });

  it("/api/boxes/create-open-order creates a single draw order", async () => {
    callRpcRawMock.mockResolvedValueOnce({
      draw_order_id: ORDER_ID,
      star_order_id: STAR_ORDER_ID,
      invoice_payload: `gacha:${ORDER_ID}`,
      xtr_amount: 10,
      quantity: 1,
      discount_bps: 0,
      idempotent: false,
    });

    const { default: createOrderHandler } =
      await import("../../api/boxes/create-open-order");
    const result = await invokeApiHandler<ApiSuccessResponse>(
      createOrderHandler,
      {
        method: "POST",
        url: "/api/boxes/create-open-order",
        headers: {
          authorization: "Bearer test-session-token-000000000000",
          "content-type": "application/json",
          "x-forwarded-for": "127.0.0.23",
        },
        body: {
          box_id: BOX_ID,
          draw_count: 1,
          idempotency_key: IDEMPOTENCY_KEY,
        },
      },
    );

    expect(result.statusCode).toBe(200);
    expect(result.body).toMatchObject({
      ok: true,
      data: {
        order_id: ORDER_ID,
        draw_count: 1,
        xtr_amount: 10,
        result_ready: false,
      },
    });
    expect(callRpcRawMock).toHaveBeenCalledWith(
      "gacha_create_order",
      expect.objectContaining({
        p_user_id: USER_ID,
        p_box_id: BOX_ID,
        p_quantity: 1,
        p_idempotency_key: IDEMPOTENCY_KEY,
      }),
      expect.any(Object),
    );
  });

  it("/api/boxes/create-open-order accepts X-Idempotency-Key when the body omits it", async () => {
    callRpcRawMock.mockResolvedValueOnce({
      draw_order_id: ORDER_ID,
      star_order_id: STAR_ORDER_ID,
      invoice_payload: `gacha:${ORDER_ID}`,
      xtr_amount: 10,
      quantity: 1,
      discount_bps: 0,
      idempotent: false,
    });

    const { default: createOrderHandler } =
      await import("../../api/boxes/create-open-order");
    const result = await invokeApiHandler<ApiSuccessResponse>(
      createOrderHandler,
      {
        method: "POST",
        url: "/api/boxes/create-open-order",
        headers: {
          authorization: "Bearer test-session-token-000000000000",
          "content-type": "application/json",
          "x-forwarded-for": "127.0.0.26",
          "x-idempotency-key": IDEMPOTENCY_KEY,
        },
        body: {
          box_id: BOX_ID,
          draw_count: 1,
        },
      },
    );

    expect(result.statusCode).toBe(200);
    expect(callRpcRawMock).toHaveBeenCalledWith(
      "gacha_create_order",
      expect.objectContaining({
        p_idempotency_key: IDEMPOTENCY_KEY,
      }),
      expect.any(Object),
    );
  });

  it("/api/boxes/create-open-order maps RPC idempotency conflicts", async () => {
    callRpcRawMock.mockRejectedValueOnce(
      new RpcError({
        rpcName: "gacha_create_order",
        error: {
          message: "idempotency key conflict",
        },
      }),
    );

    const { default: createOrderHandler } =
      await import("../../api/boxes/create-open-order");
    const result = await invokeApiHandler<ApiErrorResponse>(
      createOrderHandler,
      {
        method: "POST",
        url: "/api/boxes/create-open-order",
        headers: {
          authorization: "Bearer test-session-token-000000000000",
          "content-type": "application/json",
          "x-forwarded-for": "127.0.0.27",
        },
        body: {
          box_id: BOX_ID,
          draw_count: 1,
          idempotency_key: IDEMPOTENCY_KEY,
        },
      },
    );

    expect(result.statusCode).toBe(409);
    expect(result.body).toMatchObject({
      ok: false,
      error: {
        code: "IDEMPOTENCY_CONFLICT",
      },
    });
  });

  it("/api/boxes/create-open-order maps empty drop pools to the first-phase code", async () => {
    callRpcRawMock.mockRejectedValueOnce(
      new RpcError({
        rpcName: "gacha_create_order",
        error: {
          message: "active drop pool not found",
        },
      }),
    );

    const { default: createOrderHandler } =
      await import("../../api/boxes/create-open-order");
    const result = await invokeApiHandler<ApiErrorResponse>(
      createOrderHandler,
      {
        method: "POST",
        url: "/api/boxes/create-open-order",
        headers: {
          authorization: "Bearer test-session-token-000000000000",
          "content-type": "application/json",
          "x-forwarded-for": "127.0.0.28",
        },
        body: {
          box_id: BOX_ID,
          draw_count: 1,
          idempotency_key: IDEMPOTENCY_KEY,
        },
      },
    );

    expect(result.statusCode).toBe(409);
    expect(result.body).toMatchObject({
      ok: false,
      error: {
        code: "DROP_POOL_EMPTY",
        message: "当前奖励池为空，暂时无法开盒。",
      },
    });
  });

  it("/api/boxes/create-open-order maps ledger failures without exposing database details", async () => {
    callRpcRawMock.mockRejectedValueOnce(
      new RpcError({
        rpcName: "gacha_create_order",
        error: {
          message:
            "currency ledger insert failed: duplicate key raw database detail",
        },
      }),
    );

    const { default: createOrderHandler } =
      await import("../../api/boxes/create-open-order");
    const result = await invokeApiHandler<ApiErrorResponse>(
      createOrderHandler,
      {
        method: "POST",
        url: "/api/boxes/create-open-order",
        headers: {
          authorization: "Bearer test-session-token-000000000000",
          "content-type": "application/json",
          "x-forwarded-for": "127.0.0.29",
        },
        body: {
          box_id: BOX_ID,
          draw_count: 1,
          idempotency_key: IDEMPOTENCY_KEY,
        },
      },
    );

    expect(result.statusCode).toBe(500);
    expect(result.body).toMatchObject({
      ok: false,
      error: {
        code: "BALANCE_LEDGER_FAILED",
        message: "资产流水写入失败，请稍后重试。",
      },
    });
    expect(JSON.stringify(result.body)).not.toContain("duplicate key");
  });

  it("/api/boxes/create-open-order creates a ten-draw order", async () => {
    callRpcRawMock.mockResolvedValueOnce({
      draw_order_id: ORDER_ID,
      star_order_id: STAR_ORDER_ID,
      invoice_payload: `gacha:${ORDER_ID}`,
      xtr_amount: 90,
      quantity: 10,
      discount_bps: 1000,
      idempotent: false,
    });

    const { default: createOrderHandler } =
      await import("../../api/boxes/create-open-order");
    const result = await invokeApiHandler<ApiSuccessResponse>(
      createOrderHandler,
      {
        method: "POST",
        url: "/api/boxes/create-open-order",
        headers: {
          authorization: "Bearer test-session-token-000000000000",
          "content-type": "application/json",
          "x-forwarded-for": "127.0.0.24",
        },
        body: {
          box_id: BOX_ID,
          draw_count: 10,
          idempotency_key: "open:test-idempotency-010",
        },
      },
    );

    expect(result.statusCode).toBe(200);
    expect(result.body).toMatchObject({
      ok: true,
      data: {
        order_id: ORDER_ID,
        draw_count: 10,
        xtr_amount: 90,
      },
    });
    expect(callRpcRawMock).toHaveBeenCalledWith(
      "gacha_create_order",
      expect.objectContaining({
        p_quantity: 10,
      }),
      expect.any(Object),
    );
  });

  it("/api/boxes/result returns completed draw results", async () => {
    callRpcRawMock.mockResolvedValueOnce({
      draw_order_id: ORDER_ID,
      status: "opened",
      quantity: 1,
      total_price_stars: 10,
      open_reward_kcoin: 100,
      paid_at: "2026-05-21T00:00:00.000Z",
      opened_at: "2026-05-21T00:00:01.000Z",
      results: [
        {
          draw_index: 1,
          was_pity: false,
          item_instance_id: "44444444-4444-4444-8444-444444444444",
          template_id: "55555555-5555-4555-8555-555555555555",
          display_name: "测试藏品",
          rarity_code: "COMMON",
          rarity_display_name: "普通",
          type_code: "CHARACTER",
          level: 1,
          power: 10,
        },
      ],
    });

    const { default: resultHandler } = await import("../../api/boxes/result");
    const result = await invokeApiHandler<ApiSuccessResponse>(resultHandler, {
      method: "GET",
      url: "/api/boxes/result",
      query: {
        order_id: ORDER_ID,
        include_items: "true",
      },
      headers: {
        authorization: "Bearer test-session-token-000000000000",
        "x-forwarded-for": "127.0.0.25",
      },
    });

    expect(result.statusCode).toBe(200);
    expect(result.body).toMatchObject({
      ok: true,
      data: {
        order_id: ORDER_ID,
        status: "completed",
        returned_kcoin: 100,
        results: [
          {
            draw_index: 1,
            name: "测试藏品",
          },
        ],
      },
    });
    expect(callRpcRawMock).toHaveBeenCalledWith(
      "gacha_get_draw_result",
      expect.objectContaining({
        p_user_id: USER_ID,
        p_draw_order_id: ORDER_ID,
      }),
      expect.any(Object),
    );
  });
});
