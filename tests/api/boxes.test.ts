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

const {
  assertStarsPaymentCreateAllowedMock,
  callRpcRawMock,
  createTelegramStarsInvoiceMock,
  requireSessionMock,
} = vi.hoisted(() => ({
  assertStarsPaymentCreateAllowedMock: vi.fn(),
  callRpcRawMock: vi.fn(),
  createTelegramStarsInvoiceMock: vi.fn(),
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

vi.mock("../../packages/server/src/payments/paymentGuards.js", () => ({
  assertStarsPaymentCreateAllowed: assertStarsPaymentCreateAllowedMock,
}));

vi.mock("../../packages/server/src/payments/telegramStars.js", () => ({
  createTelegramStarsInvoice: createTelegramStarsInvoiceMock,
}));

const BOX_ID = "11111111-1111-4111-8111-111111111111";
const ORDER_ID = "22222222-2222-4222-8222-222222222222";
const STAR_ORDER_ID = "33333333-3333-4333-8333-333333333333";
const POOL_VERSION_ID = "77777777-7777-4777-8777-777777777777";
const IDEMPOTENCY_KEY = "open:test-idempotency-001";
const USER_ID = "66666666-6666-4666-8666-666666666666";
const INVOICE_PAYLOAD =
  "gacha_0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";
const INVOICE_LINK = "https://t.me/invoice/test-open-order";
const EXPIRES_AT = "2026-05-28T00:15:00.000Z";

function createInvoiceResult(overrides: Record<string, unknown> = {}) {
  return {
    starOrderId: STAR_ORDER_ID,
    payload: INVOICE_PAYLOAD,
    invoiceLink: INVOICE_LINK,
    openMode: "web_app_open_invoice",
    botApiMethod: "createInvoiceLink",
    expiresAt: EXPIRES_AT,
    invoiceStatus: "created",
    paymentOrderStatus: "created",
    reused: false,
    ...overrides,
  };
}

describe("boxes API helpers", () => {
  beforeEach(() => {
    process.env.NODE_ENV = "test";
    delete process.env.DEV_GACHA_PAYMENT_MODE;
    assertStarsPaymentCreateAllowedMock.mockReset();
    assertStarsPaymentCreateAllowedMock.mockResolvedValue(undefined);
    callRpcRawMock.mockReset();
    createTelegramStarsInvoiceMock.mockReset();
    createTelegramStarsInvoiceMock.mockResolvedValue(createInvoiceResult());
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

  it("marks dev-paid completed orders as result-ready", () => {
    const response = buildCreateOpenOrderResponse(
      {
        draw_order_id: ORDER_ID,
        star_order_id: STAR_ORDER_ID,
        invoice_payload: INVOICE_PAYLOAD,
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
        status: "completed",
        payment_status: "dev_paid",
      },
    );

    expect(response).toMatchObject({
      order_id: ORDER_ID,
      star_order_id: STAR_ORDER_ID,
      draw_count: 10,
      order_status: "completed",
      payment_status: "fulfilled",
      payment_order_status: "fulfilled",
      invoice_link: null,
      invoice_open_mode: null,
      expires_at: null,
      dev_payment_processed: true,
      result_ready: true,
    });
  });

  it("returns total K-coin reward for ten draw results", () => {
    const response = toDrawResultResponse(
      {
        draw_order_id: ORDER_ID,
        status: "completed",
        draw_count: 10,
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
        cookie: "tma_game_session=test-session-token-000000000000",
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

  it("/api/boxes/rewards reads only frontend-visible pool versions", async () => {
    callRpcRawMock.mockResolvedValueOnce({
      box_id: BOX_ID,
      box_name: "测试盲盒",
      box_status: "active",
      pool_version_id: POOL_VERSION_ID,
      pool_version: 2,
      items: [
        {
          pool_item_id: "88888888-8888-4888-8888-888888888888",
          template_id: "55555555-5555-4555-8555-555555555555",
          name: "测试藏品",
          rarity: "COMMON",
          rarity_label: "普通",
          item_type: "CHARACTER",
          item_type_label: "角色",
          display_probability: "100%",
          probability_bps: 10000,
          is_limited: false,
          is_pity_eligible: true,
        },
      ],
      pity_rule: null,
      generated_at: "2026-05-28T00:00:00.000Z",
    });

    const { default: rewardsHandler } = await import("../../api/boxes/rewards");
    const result = await invokeApiHandler<ApiSuccessResponse>(rewardsHandler, {
      method: "GET",
      url: "/api/boxes/rewards",
      query: {
        boxId: BOX_ID,
        includeInactive: "true",
        includeSoldOut: "false",
      },
      headers: {
        cookie: "tma_game_session=test-session-token-000000000000",
        "x-forwarded-for": "127.0.0.31",
      },
    });

    expect(result.statusCode).toBe(200);
    expect(result.body).toMatchObject({
      ok: true,
      data: {
        box_id: BOX_ID,
        pool_version_id: POOL_VERSION_ID,
        items: [
          {
            name: "测试藏品",
          },
        ],
      },
    });
    expect(callRpcRawMock).toHaveBeenCalledWith(
      "gacha_get_box_rewards",
      {
        p_box_id: BOX_ID,
        p_pool_version_id: null,
        p_include_inactive: false,
        p_include_sold_out: false,
      },
      expect.objectContaining({
        schema: "api",
        context: expect.objectContaining({
          userId: USER_ID,
          boxId: BOX_ID,
        }),
      }),
    );
  });

  it("/api/boxes/create-open-order creates a single draw order", async () => {
    callRpcRawMock.mockResolvedValueOnce({
      draw_order_id: ORDER_ID,
      star_order_id: STAR_ORDER_ID,
      invoice_payload: INVOICE_PAYLOAD,
      xtr_amount: 10,
      quantity: 1,
      discount_bps: 0,
      pool_version_id: POOL_VERSION_ID,
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
          cookie: "tma_game_session=test-session-token-000000000000",
          "content-type": "application/json",
          "x-forwarded-for": "127.0.0.23",
        },
        body: {
          box_id: BOX_ID,
          draw_count: 1,
          expected_price_stars: 10,
          expected_pool_version_id: POOL_VERSION_ID,
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
        payment_status: "created",
        payment_order_status: "created",
        invoice_link: INVOICE_LINK,
        invoice_open_mode: "web_app_open_invoice",
        expires_at: EXPIRES_AT,
        result_ready: false,
      },
    });
    expect(callRpcRawMock).toHaveBeenCalledWith(
      "gacha_create_order_checked",
      expect.objectContaining({
        p_user_id: USER_ID,
        p_box_id: BOX_ID,
        p_quantity: 1,
        p_idempotency_key: IDEMPOTENCY_KEY,
        p_expected_price_stars: 10,
        p_expected_pool_version_id: POOL_VERSION_ID,
      }),
      expect.any(Object),
    );
    expect(createTelegramStarsInvoiceMock).toHaveBeenCalledWith(
      expect.objectContaining({
        starOrderId: STAR_ORDER_ID,
        drawOrderId: ORDER_ID,
        userId: USER_ID,
        invoicePayload: INVOICE_PAYLOAD,
        xtrAmount: 10,
      }),
    );
  });

  it("/api/boxes/create-open-order processes the dev-paid draw loop when dev mode is enabled", async () => {
    process.env.DEV_GACHA_PAYMENT_MODE = "true";
    callRpcRawMock
      .mockResolvedValueOnce({
        draw_order_id: ORDER_ID,
        star_order_id: STAR_ORDER_ID,
        invoice_payload: INVOICE_PAYLOAD,
        xtr_amount: 10,
        quantity: 1,
        discount_bps: 0,
        idempotent: false,
      })
      .mockResolvedValueOnce({
        draw_order_id: ORDER_ID,
        status: "completed",
        payment_status: "dev_paid",
        results: [
          {
            draw_index: 1,
            item_instance_id: "44444444-4444-4444-8444-444444444444",
          },
        ],
      });

    const { default: createOrderHandler } =
      await import("../../api/boxes/create-open-order");
    const result = await invokeApiHandler<ApiSuccessResponse>(
      createOrderHandler,
      {
        method: "POST",
        url: "/api/boxes/create-open-order",
        headers: {
          cookie: "tma_game_session=test-session-token-000000000000",
          "content-type": "application/json",
          "x-forwarded-for": "127.0.0.30",
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
        order_status: "completed",
        payment_status: "fulfilled",
        invoice_link: null,
        dev_payment_processed: true,
        result_ready: true,
      },
    });
    expect(callRpcRawMock).toHaveBeenNthCalledWith(
      1,
      "gacha_create_order_checked",
      expect.objectContaining({
        p_user_id: USER_ID,
        p_box_id: BOX_ID,
        p_quantity: 1,
        p_idempotency_key: IDEMPOTENCY_KEY,
        p_expected_price_stars: null,
        p_expected_pool_version_id: null,
      }),
      expect.any(Object),
    );
    expect(callRpcRawMock).toHaveBeenNthCalledWith(
      2,
      "gacha_process_dev_paid_order",
      expect.objectContaining({
        p_order_id: ORDER_ID,
        p_user_id: USER_ID,
      }),
      expect.any(Object),
    );
    expect(createTelegramStarsInvoiceMock).not.toHaveBeenCalled();
  });

  it("/api/boxes/create-open-order accepts X-Idempotency-Key when the body omits it", async () => {
    callRpcRawMock.mockResolvedValueOnce({
      draw_order_id: ORDER_ID,
      star_order_id: STAR_ORDER_ID,
      invoice_payload: INVOICE_PAYLOAD,
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
          cookie: "tma_game_session=test-session-token-000000000000",
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
      "gacha_create_order_checked",
      expect.objectContaining({
        p_idempotency_key: IDEMPOTENCY_KEY,
        p_expected_price_stars: null,
        p_expected_pool_version_id: null,
      }),
      expect.any(Object),
    );
    expect(createTelegramStarsInvoiceMock).toHaveBeenCalledTimes(1);
  });

  it("/api/boxes/create-open-order maps RPC idempotency conflicts", async () => {
    callRpcRawMock.mockRejectedValueOnce(
      new RpcError({
        rpcName: "gacha_create_order_checked",
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
          cookie: "tma_game_session=test-session-token-000000000000",
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

  it("/api/boxes/create-open-order maps stale expected prices", async () => {
    callRpcRawMock.mockRejectedValueOnce(
      new RpcError({
        rpcName: "gacha_create_order_checked",
        error: {
          message: "expected price changed",
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
          cookie: "tma_game_session=test-session-token-000000000000",
          "content-type": "application/json",
          "x-forwarded-for": "127.0.0.35",
        },
        body: {
          box_id: BOX_ID,
          draw_count: 1,
          expected_price_stars: 9,
          idempotency_key: IDEMPOTENCY_KEY,
        },
      },
    );

    expect(result.statusCode).toBe(409);
    expect(result.body).toMatchObject({
      ok: false,
      error: {
        code: "BOX_PRICE_CHANGED",
        message: "盲盒价格已变化，请刷新后重试。",
      },
    });
    expect(createTelegramStarsInvoiceMock).not.toHaveBeenCalled();
  });

  it("/api/boxes/create-open-order maps stale expected pool versions", async () => {
    callRpcRawMock.mockRejectedValueOnce(
      new RpcError({
        rpcName: "gacha_create_order_checked",
        error: {
          message: "expected pool version changed",
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
          cookie: "tma_game_session=test-session-token-000000000000",
          "content-type": "application/json",
          "x-forwarded-for": "127.0.0.36",
        },
        body: {
          box_id: BOX_ID,
          draw_count: 1,
          expected_pool_version_id: POOL_VERSION_ID,
          idempotency_key: IDEMPOTENCY_KEY,
        },
      },
    );

    expect(result.statusCode).toBe(409);
    expect(result.body).toMatchObject({
      ok: false,
      error: {
        code: "BOX_POOL_VERSION_CHANGED",
        message: "奖励池版本已变化，请刷新后重试。",
      },
    });
    expect(createTelegramStarsInvoiceMock).not.toHaveBeenCalled();
  });

  it("/api/boxes/create-open-order maps empty drop pools to the first-phase code", async () => {
    callRpcRawMock.mockRejectedValueOnce(
      new RpcError({
        rpcName: "gacha_create_order_checked",
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
          cookie: "tma_game_session=test-session-token-000000000000",
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

  it("/api/boxes/create-open-order rejects paused boxes before invoice creation", async () => {
    callRpcRawMock.mockRejectedValueOnce(
      new RpcError({
        rpcName: "gacha_create_order_checked",
        error: {
          message: "blind box is not active: paused",
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
          cookie: "tma_game_session=test-session-token-000000000000",
          "content-type": "application/json",
          "x-forwarded-for": "127.0.0.37",
        },
        body: {
          box_id: BOX_ID,
          draw_count: 1,
          idempotency_key: IDEMPOTENCY_KEY,
        },
      },
    );

    expect(result.statusCode).toBe(400);
    expect(result.body).toMatchObject({
      ok: false,
      error: {
        code: "BOX_NOT_ACTIVE",
        message: "当前盲盒不可开启。",
      },
    });
    expect(createTelegramStarsInvoiceMock).not.toHaveBeenCalled();
  });

  it("/api/boxes/create-open-order rejects sold-out stock before invoice creation", async () => {
    callRpcRawMock.mockRejectedValueOnce(
      new RpcError({
        rpcName: "gacha_create_order_checked",
        error: {
          message: "blind box stock is insufficient",
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
          cookie: "tma_game_session=test-session-token-000000000000",
          "content-type": "application/json",
          "x-forwarded-for": "127.0.0.38",
        },
        body: {
          box_id: BOX_ID,
          draw_count: 10,
          idempotency_key: "open:test-idempotency-038",
        },
      },
    );

    expect(result.statusCode).toBe(409);
    expect(result.body).toMatchObject({
      ok: false,
      error: {
        code: "BOX_STOCK_NOT_ENOUGH",
        message: "盲盒库存不足。",
      },
    });
    expect(createTelegramStarsInvoiceMock).not.toHaveBeenCalled();
  });

  it("/api/boxes/create-open-order maps ledger failures without exposing database details", async () => {
    callRpcRawMock.mockRejectedValueOnce(
      new RpcError({
        rpcName: "gacha_create_order_checked",
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
          cookie: "tma_game_session=test-session-token-000000000000",
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

  it("/api/boxes/create-open-order returns 401 before RPC calls without a session", async () => {
    requireSessionMock.mockRejectedValueOnce({
      statusCode: 401,
      code: "AUTH_SESSION_EXPIRED",
      message: "登录状态缺失，请重新进入应用。",
      expose: true,
    });

    const { default: createOrderHandler } =
      await import("../../api/boxes/create-open-order");
    const result = await invokeApiHandler<ApiErrorResponse>(
      createOrderHandler,
      {
        method: "POST",
        url: "/api/boxes/create-open-order",
        headers: {
          "content-type": "application/json",
          "x-forwarded-for": "127.0.0.31",
        },
        body: {
          box_id: BOX_ID,
          draw_count: 1,
          idempotency_key: IDEMPOTENCY_KEY,
        },
      },
    );

    expect(result.statusCode).toBe(401);
    expect(result.body).toMatchObject({
      ok: false,
      error: {
        code: "AUTH_SESSION_EXPIRED",
      },
    });
    expect(callRpcRawMock).not.toHaveBeenCalled();
    expect(createTelegramStarsInvoiceMock).not.toHaveBeenCalled();
  });

  it("/api/boxes/create-open-order rejects when Stars payment is disabled", async () => {
    assertStarsPaymentCreateAllowedMock.mockRejectedValueOnce({
      statusCode: 503,
      code: "FEATURE_STARS_PAYMENT_DISABLED",
      message: "Stars 支付暂未开放。",
      expose: true,
    });

    const { default: createOrderHandler } =
      await import("../../api/boxes/create-open-order");
    const result = await invokeApiHandler<ApiErrorResponse>(
      createOrderHandler,
      {
        method: "POST",
        url: "/api/boxes/create-open-order",
        headers: {
          cookie: "tma_game_session=test-session-token-000000000000",
          "content-type": "application/json",
          "x-forwarded-for": "127.0.0.33",
        },
        body: {
          box_id: BOX_ID,
          draw_count: 1,
          idempotency_key: IDEMPOTENCY_KEY,
        },
      },
    );

    expect(result.statusCode).toBe(503);
    expect(result.body).toMatchObject({
      ok: false,
      error: {
        code: "FEATURE_STARS_PAYMENT_DISABLED",
        message: "Stars 支付暂未开放。",
      },
    });
    expect(callRpcRawMock).not.toHaveBeenCalled();
    expect(createTelegramStarsInvoiceMock).not.toHaveBeenCalled();
  });

  it("/api/boxes/create-open-order creates a ten-draw order", async () => {
    callRpcRawMock.mockResolvedValueOnce({
      draw_order_id: ORDER_ID,
      star_order_id: STAR_ORDER_ID,
      invoice_payload: INVOICE_PAYLOAD,
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
          cookie: "tma_game_session=test-session-token-000000000000",
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
        invoice_link: INVOICE_LINK,
        payment_order_status: "created",
      },
    });
    expect(callRpcRawMock).toHaveBeenCalledWith(
      "gacha_create_order_checked",
      expect.objectContaining({
        p_quantity: 10,
      }),
      expect.any(Object),
    );
    expect(createTelegramStarsInvoiceMock).toHaveBeenCalledWith(
      expect.objectContaining({
        starOrderId: STAR_ORDER_ID,
        drawOrderId: ORDER_ID,
        userId: USER_ID,
        invoicePayload: INVOICE_PAYLOAD,
        xtrAmount: 90,
      }),
    );
  });

  it("/api/boxes/create-open-order does not dev-fulfill when invoice creation fails", async () => {
    createTelegramStarsInvoiceMock.mockRejectedValueOnce({
      statusCode: 502,
      code: "TELEGRAM_INVOICE_CREATE_FAILED",
      message: "Telegram Stars invoice 创建失败，请稍后重试。",
      expose: true,
    });
    callRpcRawMock.mockResolvedValueOnce({
      draw_order_id: ORDER_ID,
      star_order_id: STAR_ORDER_ID,
      invoice_payload: INVOICE_PAYLOAD,
      xtr_amount: 10,
      quantity: 1,
      discount_bps: 0,
      idempotent: false,
    });

    const { default: createOrderHandler } =
      await import("../../api/boxes/create-open-order");
    const result = await invokeApiHandler<ApiErrorResponse>(
      createOrderHandler,
      {
        method: "POST",
        url: "/api/boxes/create-open-order",
        headers: {
          cookie: "tma_game_session=test-session-token-000000000000",
          "content-type": "application/json",
          "x-forwarded-for": "127.0.0.34",
        },
        body: {
          box_id: BOX_ID,
          draw_count: 1,
          idempotency_key: IDEMPOTENCY_KEY,
        },
      },
    );

    expect(result.statusCode).toBe(502);
    expect(result.body).toMatchObject({
      ok: false,
      error: {
        code: "TELEGRAM_INVOICE_CREATE_FAILED",
      },
    });
    expect(callRpcRawMock).toHaveBeenCalledTimes(1);
    expect(createTelegramStarsInvoiceMock).toHaveBeenCalledTimes(1);
  });

  it("/api/boxes/result returns completed draw results", async () => {
    callRpcRawMock.mockResolvedValueOnce({
      draw_order_id: ORDER_ID,
      status: "completed",
      draw_count: 1,
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
        cookie: "tma_game_session=test-session-token-000000000000",
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

  it("/api/boxes/result returns 401 before RPC calls without a session", async () => {
    requireSessionMock.mockRejectedValueOnce({
      statusCode: 401,
      code: "AUTH_SESSION_EXPIRED",
      message: "登录状态缺失，请重新进入应用。",
      expose: true,
    });

    const { default: resultHandler } = await import("../../api/boxes/result");
    const result = await invokeApiHandler<ApiErrorResponse>(resultHandler, {
      method: "GET",
      url: "/api/boxes/result",
      query: {
        order_id: ORDER_ID,
        include_items: "true",
      },
      headers: {
        "x-forwarded-for": "127.0.0.32",
      },
    });

    expect(result.statusCode).toBe(401);
    expect(result.body).toMatchObject({
      ok: false,
      error: {
        code: "AUTH_SESSION_EXPIRED",
      },
    });
    expect(callRpcRawMock).not.toHaveBeenCalled();
  });
});
