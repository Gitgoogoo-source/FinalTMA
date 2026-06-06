import { beforeEach, describe, expect, it, vi } from "vitest";

import type {
  ApiErrorResponse,
  ApiSuccessResponse,
} from "../../api/_shared/handler";
import {
  buildCreateOpenOrderResponse,
  normalizeCreateOpenOrderInput,
} from "../../api/boxes/create-open-order";
import {
  buildOpenVipDailyBoxResponse,
  normalizeOpenVipDailyBoxInput,
} from "../../api/boxes/open-vip-daily";
import { toDrawResultResponse } from "../../api/boxes/result";
import { RpcError } from "../../packages/server/src/db/rpc";
import { invokeApiHandler } from "./_utils";

const {
  assertStarsPaymentCreateAllowedMock,
  callRpcRawMock,
  createTelegramStarsInvoiceMock,
  getSupabaseAdminMock,
  requireSessionMock,
} = vi.hoisted(() => ({
  assertStarsPaymentCreateAllowedMock: vi.fn(),
  callRpcRawMock: vi.fn(),
  createTelegramStarsInvoiceMock: vi.fn(),
  getSupabaseAdminMock: vi.fn(),
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
  getSupabaseAdmin: getSupabaseAdminMock,
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

function createNoRiskDbMock() {
  const builder = {
    select: vi.fn(() => builder),
    eq: vi.fn(() => builder),
    gte: vi.fn(() => builder),
    limit: vi.fn(() => Promise.resolve({ data: [], count: 0, error: null })),
    then: (
      resolve: (value: {
        data: unknown[];
        count: number;
        error: null;
      }) => unknown,
      reject?: (reason: unknown) => unknown,
    ) =>
      Promise.resolve(resolve({ data: [], count: 0, error: null })).catch(
        reject,
      ),
  };

  return {
    schema: vi.fn(() => ({
      from: vi.fn(() => builder),
    })),
  };
}

function createRiskFlagDbMock(flagCode: string) {
  const builder = {
    select: vi.fn(() => builder),
    eq: vi.fn(() => builder),
    limit: vi.fn(() =>
      Promise.resolve({
        data: [
          {
            flag_code: flagCode,
            flag_level: "restriction",
            active: true,
            ends_at: null,
            metadata: { reason: "risk test" },
          },
        ],
        count: 1,
        error: null,
      }),
    ),
    then: (
      resolve: (value: {
        data: unknown[];
        count: number;
        error: null;
      }) => unknown,
      reject?: (reason: unknown) => unknown,
    ) =>
      Promise.resolve(
        resolve({
          data: [
            {
              flag_code: flagCode,
              flag_level: "restriction",
              active: true,
              ends_at: null,
              metadata: { reason: "risk test" },
            },
          ],
          count: 1,
          error: null,
        }),
      ).catch(reject),
  };

  return {
    schema: vi.fn(() => ({
      from: vi.fn(() => builder),
    })),
  };
}

describe("boxes API helpers", () => {
  beforeEach(() => {
    process.env.NODE_ENV = "test";
    vi.stubEnv("SUPABASE_URL", "https://project-ref.supabase.co");
    vi.stubEnv("SUPABASE_STORAGE_PUBLIC_URL", "");
    vi.stubEnv("GACHA_STARTER_EGG_PRICE_STARS", "10");
    vi.stubEnv("GACHA_PREMIUM_EGG_PRICE_STARS", "30");
    vi.stubEnv("GACHA_LEGENDARY_EGG_PRICE_STARS", "80");
    vi.stubEnv("GACHA_TEN_DRAW_DISCOUNT_RATE", "0.1");
    delete process.env.DEV_GACHA_PAYMENT_MODE;
    assertStarsPaymentCreateAllowedMock.mockReset();
    assertStarsPaymentCreateAllowedMock.mockResolvedValue(undefined);
    callRpcRawMock.mockReset();
    createTelegramStarsInvoiceMock.mockReset();
    createTelegramStarsInvoiceMock.mockResolvedValue(createInvoiceResult());
    getSupabaseAdminMock.mockReset();
    getSupabaseAdminMock.mockReturnValue(createNoRiskDbMock());
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
          box_slug: "starter_egg",
          draw_count: 10,
          idempotency_key: IDEMPOTENCY_KEY,
        },
        null,
      ),
    ).toMatchObject({
      boxSlug: "starter_egg",
      openType: "ten",
      quantity: 10,
      idempotencyKey: IDEMPOTENCY_KEY,
    });
  });

  it("uses the idempotency header when the body omits idempotency_key", () => {
    expect(
      normalizeCreateOpenOrderInput(
        {
          box_slug: "starter_egg",
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

  it("builds K-coin completed orders as result-ready", () => {
    const response = buildCreateOpenOrderResponse(
      {
        draw_order_id: ORDER_ID,
        star_order_id: null,
        xtr_amount: 0,
        paid_kcoin: 90,
        total_price_kcoin: 90,
        quantity: 10,
        discount_bps: 1000,
        idempotent: false,
        status: "completed",
        payment_status: "fulfilled",
        result_ready: true,
      },
      {
        boxSlug: "starter_egg",
        openType: "ten",
        quantity: 10,
        paymentProvider: "kcoin",
        idempotencyKey: IDEMPOTENCY_KEY,
      },
    );

    expect(response).toMatchObject({
      order_id: ORDER_ID,
      star_order_id: null,
      draw_count: 10,
      xtr_amount: 0,
      paid_kcoin: 90,
      total_price_kcoin: 90,
      order_status: "completed",
      payment_status: "fulfilled",
      payment_order_status: "fulfilled",
      invoice_link: null,
      invoice_open_mode: null,
      expires_at: null,
      dev_payment_processed: false,
      result_ready: true,
    });
  });

  it("normalizes VIP daily free open input from the idempotency header only", () => {
    expect(normalizeOpenVipDailyBoxInput({}, IDEMPOTENCY_KEY)).toEqual({
      idempotencyKey: IDEMPOTENCY_KEY,
    });
  });

  it("builds VIP daily free open responses as result-ready zero-Star orders", () => {
    expect(
      buildOpenVipDailyBoxResponse({
        draw_order_id: ORDER_ID,
        status: "completed",
        payment_status: "vip_daily_free",
        draw_count: 1,
        quantity: 1,
        xtr_amount: 0,
        total_price_stars: 0,
        claim_id: "88888888-8888-4888-8888-888888888888",
        free_box_count: 1,
        free_box_used_count: 1,
        consume_ledger_id: "99999999-9999-4999-8999-999999999999",
        idempotent: false,
        result_ready: true,
      }),
    ).toMatchObject({
      order_id: ORDER_ID,
      star_order_id: null,
      invoice_payload: null,
      xtr_amount: 0,
      draw_count: 1,
      order_status: "completed",
      payment_status: "fulfilled",
      payment_order_status: "fulfilled",
      result_ready: true,
      free_box_count: 1,
      free_box_used_count: 1,
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
            image_url:
              "/storage/v1/object/public/collectibles/test_item_card.png",
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
      image_url:
        "https://project-ref.supabase.co/storage/v1/object/public/collectibles/test_item_card.png",
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

  it("/api/boxes/create-open-order rejects gacha_blocked users before creating orders", async () => {
    getSupabaseAdminMock.mockReturnValue(createRiskFlagDbMock("gacha_blocked"));

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
        },
        body: {
          box_slug: "starter_egg",
          draw_count: 1,
          idempotency_key: IDEMPOTENCY_KEY,
        },
      },
    );

    expect(result.statusCode).toBe(403);
    expect(result.body.error.code).toBe("RISK_REJECTED");
    expect(callRpcRawMock).not.toHaveBeenCalled();
  });

  it("/api/boxes/open-vip-daily rejects forged box and user fields before RPC", async () => {
    const { default: openVipDailyHandler } =
      await import("../../api/boxes/open-vip-daily");
    const result = await invokeApiHandler<ApiErrorResponse>(
      openVipDailyHandler,
      {
        method: "POST",
        url: "/api/boxes/open-vip-daily",
        headers: {
          cookie: "tma_game_session=test-session-token-000000000000",
          "content-type": "application/json",
          "x-idempotency-key": IDEMPOTENCY_KEY,
        },
        body: {
          user_id: "99999999-9999-4999-8999-999999999999",
          box_slug: "legendary_egg",
          draw_count: 10,
          xtr_amount: 1,
        },
      },
    );

    expect(result.statusCode).toBe(400);
    expect(result.body.error.code).toBe("VALIDATION_ERROR");
    expect(callRpcRawMock).not.toHaveBeenCalled();
  });

  it("/api/boxes/open-vip-daily opens one premium egg through the session user", async () => {
    callRpcRawMock
      .mockResolvedValueOnce({
        draw_order_id: ORDER_ID,
        box_slug: "premium_egg",
        status: "completed",
        payment_status: "vip_daily_free",
        draw_count: 1,
        quantity: 1,
        xtr_amount: 0,
        total_price_stars: 0,
        claim_id: "88888888-8888-4888-8888-888888888888",
        free_box_count: 1,
        free_box_used_count: 1,
        consume_ledger_id: "99999999-9999-4999-8999-999999999999",
        idempotent: false,
        result_ready: true,
      })
      .mockResolvedValueOnce({
        risk_event_id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
        status: "open",
      });

    const { default: openVipDailyHandler } =
      await import("../../api/boxes/open-vip-daily");
    const result = await invokeApiHandler<ApiSuccessResponse>(
      openVipDailyHandler,
      {
        method: "POST",
        url: "/api/boxes/open-vip-daily",
        headers: {
          cookie: "tma_game_session=test-session-token-000000000000",
          "content-type": "application/json",
          "x-request-id": "req-vip-free-box",
          "x-idempotency-key": IDEMPOTENCY_KEY,
        },
        body: {},
      },
    );

    expect(result.statusCode).toBe(200);
    expect(result.body).toMatchObject({
      ok: true,
      data: {
        order_id: ORDER_ID,
        star_order_id: null,
        xtr_amount: 0,
        draw_count: 1,
        payment_status: "fulfilled",
        result_ready: true,
      },
    });
    expect(callRpcRawMock).toHaveBeenNthCalledWith(
      1,
      "vip_open_daily_free_premium_egg",
      {
        p_user_id: USER_ID,
        p_idempotency_key: IDEMPOTENCY_KEY,
      },
      expect.objectContaining({
        schema: "api",
        context: expect.objectContaining({
          requestId: "req-vip-free-box",
          userId: USER_ID,
          boxSlug: "premium_egg",
          quantity: 1,
          idempotencyKey: IDEMPOTENCY_KEY,
        }),
      }),
    );
    expect(callRpcRawMock).toHaveBeenNthCalledWith(
      2,
      "risk_record_event",
      expect.objectContaining({
        p_event_type: "vip_daily_free_box_open",
        p_source_type: "gacha_order",
        p_source_id: ORDER_ID,
      }),
      expect.objectContaining({
        schema: "api",
      }),
    );
    expect(createTelegramStarsInvoiceMock).not.toHaveBeenCalled();
  });

  it("/api/boxes/open-vip-daily requires the free box claim first", async () => {
    callRpcRawMock.mockRejectedValueOnce(
      new RpcError({
        rpcName: "vip_open_daily_free_premium_egg",
        error: {
          message: "VIP_DAILY_FREE_BOX_NOT_CLAIMED",
        },
      }),
    );

    const { default: openVipDailyHandler } =
      await import("../../api/boxes/open-vip-daily");
    const result = await invokeApiHandler<ApiErrorResponse>(
      openVipDailyHandler,
      {
        method: "POST",
        url: "/api/boxes/open-vip-daily",
        headers: {
          cookie: "tma_game_session=test-session-token-000000000000",
          "content-type": "application/json",
          "x-idempotency-key": IDEMPOTENCY_KEY,
        },
        body: {},
      },
    );

    expect(result.statusCode).toBe(409);
    expect(result.body.error.code).toBe("VIP_DAILY_FREE_BOX_NOT_CLAIMED");
    expect(result.body.error.message).toBe("请先领取今日免费盲盒。");
  });

  it("/api/payments/kcoin-topup/create-order creates a Stars invoice for K-coin recharge", async () => {
    const topupOrderId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
    const topupStarOrderId = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
    const topupPayload =
      "kcoin_topup_0123456789abcdef0123456789abcdef0123456789abcdef";
    callRpcRawMock.mockResolvedValueOnce({
      topup_order_id: topupOrderId,
      star_order_id: topupStarOrderId,
      invoice_payload: topupPayload,
      xtr_amount: 500,
      kcoin_amount: 500,
      status: "created",
      payment_order_status: "created",
      expires_at: EXPIRES_AT,
      idempotent: false,
    });
    createTelegramStarsInvoiceMock.mockResolvedValueOnce(
      createInvoiceResult({
        starOrderId: topupStarOrderId,
        payload: topupPayload,
        invoiceLink: "https://t.me/invoice/kcoin-topup",
        paymentOrderStatus: "invoice_created",
      }),
    );

    const { default: createTopupHandler } =
      await import("../../api/payments/kcoin-topup/create-order");
    const result = await invokeApiHandler<ApiSuccessResponse>(
      createTopupHandler,
      {
        method: "POST",
        url: "/api/payments/kcoin-topup/create-order",
        headers: {
          cookie: "tma_game_session=test-session-token-000000000000",
          "content-type": "application/json",
          "x-forwarded-for": "127.0.0.39",
          "x-idempotency-key": "kcoin:topup:test-001",
        },
        body: {
          amount: 500,
        },
      },
    );

    expect(result.statusCode).toBe(200);
    expect(result.body).toMatchObject({
      ok: true,
      data: {
        topup_order_id: topupOrderId,
        star_order_id: topupStarOrderId,
        invoice_link: "https://t.me/invoice/kcoin-topup",
        xtr_amount: 500,
        kcoin_amount: 500,
        payment_order_status: "invoice_created",
      },
    });
    expect(assertStarsPaymentCreateAllowedMock).toHaveBeenCalledOnce();
    expect(callRpcRawMock).toHaveBeenCalledWith(
      "kcoin_topup_create_order",
      {
        p_user_id: USER_ID,
        p_amount: 500,
        p_idempotency_key: "kcoin:topup:test-001",
        p_intent: "MANUAL_TOPUP",
        p_box_slug: null,
        p_draw_count: null,
        p_required_kcoin: null,
      },
      expect.objectContaining({
        schema: "api",
        context: expect.objectContaining({
          userId: USER_ID,
          amount: 500,
          intent: "MANUAL_TOPUP",
          idempotencyKey: "kcoin:topup:test-001",
        }),
      }),
    );
    expect(createTelegramStarsInvoiceMock).toHaveBeenCalledWith(
      expect.objectContaining({
        businessType: "kcoin_topup",
        drawOrderId: topupOrderId,
        invoicePayload: topupPayload,
        starOrderId: topupStarOrderId,
        userId: USER_ID,
        xtrAmount: 500,
      }),
    );
  });

  it("/api/boxes/create-open-order creates a single draw order", async () => {
    callRpcRawMock.mockResolvedValueOnce({
      draw_order_id: ORDER_ID,
      star_order_id: null,
      xtr_amount: 0,
      paid_kcoin: 10,
      total_price_kcoin: 10,
      quantity: 1,
      discount_bps: 0,
      pool_version_id: POOL_VERSION_ID,
      idempotent: false,
      status: "completed",
      payment_status: "fulfilled",
      result_ready: true,
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
          box_slug: "starter_egg",
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
        xtr_amount: 0,
        paid_kcoin: 10,
        total_price_kcoin: 10,
        payment_status: "fulfilled",
        payment_order_status: "fulfilled",
        invoice_link: null,
        invoice_open_mode: null,
        expires_at: null,
        result_ready: true,
      },
    });
    expect(callRpcRawMock).toHaveBeenCalledWith(
      "gacha_open_with_kcoin_from_server_price",
      expect.objectContaining({
        p_user_id: USER_ID,
        p_box_slug: "starter_egg",
        p_quantity: 1,
        p_idempotency_key: IDEMPOTENCY_KEY,
        p_unit_price_kcoin: 10,
        p_discount_bps: 0,
      }),
      expect.any(Object),
    );
    expect(createTelegramStarsInvoiceMock).not.toHaveBeenCalled();
  });

  it("/api/boxes/create-open-order returns K-coin shortage details when balance is low", async () => {
    callRpcRawMock.mockRejectedValueOnce(
      new RpcError({
        rpcName: "gacha_open_with_kcoin_from_server_price",
        error: {
          message: "insufficient balance: required=10, balance=1, shortage=9",
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
          "x-forwarded-for": "127.0.0.24",
        },
        body: {
          box_slug: "starter_egg",
          draw_count: 1,
          idempotency_key: IDEMPOTENCY_KEY,
        },
      },
    );

    expect(result.statusCode).toBe(402);
    expect(result.body).toMatchObject({
      ok: false,
      error: {
        code: "INSUFFICIENT_KCOIN",
        details: {
          required: 10,
          balance: 1,
          shortage: 9,
          canTopup: true,
          fixedTopupPackages: [500, 1000, 5000, 10000],
        },
      },
    });
    expect(createTelegramStarsInvoiceMock).not.toHaveBeenCalled();
  });

  it("/api/boxes/create-open-order records gacha_high_frequency risk events", async () => {
    callRpcRawMock
      .mockResolvedValueOnce({
        draw_order_id: ORDER_ID,
        star_order_id: null,
        xtr_amount: 0,
        paid_kcoin: 10,
        total_price_kcoin: 10,
        quantity: 1,
        discount_bps: 0,
        pool_version_id: POOL_VERSION_ID,
        idempotent: false,
        status: "completed",
        payment_status: "fulfilled",
        result_ready: true,
      })
      .mockResolvedValueOnce({
        count: 6,
      })
      .mockResolvedValueOnce({
        risk_event_id: "99999999-9999-4999-8999-999999999999",
        status: "open",
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
          "x-request-id": "req-gacha-high-frequency",
        },
        body: {
          box_slug: "starter_egg",
          draw_count: 1,
          idempotency_key: IDEMPOTENCY_KEY,
        },
      },
    );

    expect(result.statusCode).toBe(200);
    expect(callRpcRawMock).toHaveBeenNthCalledWith(
      2,
      "gacha_count_recent_draw_orders",
      expect.objectContaining({
        p_user_id: USER_ID,
      }),
      expect.objectContaining({
        schema: "api",
        context: expect.objectContaining({
          requestId: "req-gacha-high-frequency",
          userId: USER_ID,
          orderId: ORDER_ID,
        }),
      }),
    );
    expect(callRpcRawMock).toHaveBeenNthCalledWith(
      3,
      "risk_record_event",
      expect.objectContaining({
        p_event_type: "gacha_high_frequency",
        p_source_type: "gacha_order",
        p_source_id: ORDER_ID,
        p_idempotency_key: `risk:gacha_high_frequency:${ORDER_ID}:${IDEMPOTENCY_KEY}`,
      }),
      expect.objectContaining({
        schema: "api",
        context: expect.objectContaining({
          requestId: "req-gacha-high-frequency",
          userId: USER_ID,
        }),
      }),
    );
  });

  it("/api/boxes/create-open-order accepts X-Idempotency-Key when the body omits it", async () => {
    callRpcRawMock
      .mockResolvedValueOnce({
        draw_order_id: ORDER_ID,
        star_order_id: null,
        xtr_amount: 0,
        paid_kcoin: 10,
        total_price_kcoin: 10,
        quantity: 1,
        discount_bps: 0,
        idempotent: false,
        status: "completed",
        payment_status: "fulfilled",
        result_ready: true,
      })
      .mockResolvedValueOnce({
        count: 0,
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
          box_slug: "starter_egg",
          draw_count: 1,
        },
      },
    );

    expect(result.statusCode).toBe(200);
    expect(callRpcRawMock).toHaveBeenCalledWith(
      "gacha_open_with_kcoin_from_server_price",
      expect.objectContaining({
        p_idempotency_key: IDEMPOTENCY_KEY,
        p_box_slug: "starter_egg",
        p_unit_price_kcoin: 10,
        p_discount_bps: 0,
      }),
      expect.any(Object),
    );
    expect(createTelegramStarsInvoiceMock).not.toHaveBeenCalled();
  });

  it("/api/boxes/create-open-order maps RPC idempotency conflicts", async () => {
    callRpcRawMock.mockRejectedValueOnce(
      new RpcError({
        rpcName: "gacha_open_with_kcoin_from_server_price",
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
          box_slug: "starter_egg",
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

  it("/api/boxes/create-open-order rejects missing server price config before RPC calls", async () => {
    vi.stubEnv("GACHA_STARTER_EGG_PRICE_STARS", "");

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
          box_slug: "starter_egg",
          draw_count: 1,
          idempotency_key: IDEMPOTENCY_KEY,
        },
      },
    );

    expect(result.statusCode).toBe(500);
    expect(result.body).toMatchObject({
      ok: false,
      error: {
        code: "GACHA_PRICE_CONFIG_INVALID",
      },
    });
    expect(callRpcRawMock).not.toHaveBeenCalled();
    expect(createTelegramStarsInvoiceMock).not.toHaveBeenCalled();
  });

  it("/api/boxes/create-open-order uses Vercel ten-draw discount rate config", async () => {
    vi.stubEnv("GACHA_STARTER_EGG_PRICE_STARS", "25");
    vi.stubEnv("GACHA_TEN_DRAW_DISCOUNT_RATE", "0.15");
    callRpcRawMock
      .mockResolvedValueOnce({
        draw_order_id: ORDER_ID,
        star_order_id: null,
        xtr_amount: 0,
        paid_kcoin: 213,
        total_price_kcoin: 213,
        quantity: 10,
        discount_bps: 1500,
        idempotent: false,
        status: "completed",
        payment_status: "fulfilled",
        result_ready: true,
      })
      .mockResolvedValueOnce({
        count: 0,
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
          "x-forwarded-for": "127.0.0.36",
        },
        body: {
          box_slug: "starter_egg",
          draw_count: 10,
          idempotency_key: "open:test-idempotency-036",
        },
      },
    );

    expect(result.statusCode).toBe(200);
    expect(result.body).toMatchObject({
      ok: true,
      data: {
        draw_count: 10,
        xtr_amount: 0,
        paid_kcoin: 213,
        total_price_kcoin: 213,
      },
    });
    expect(callRpcRawMock).toHaveBeenNthCalledWith(
      1,
      "gacha_open_with_kcoin_from_server_price",
      expect.objectContaining({
        p_box_slug: "starter_egg",
        p_quantity: 10,
        p_unit_price_kcoin: 25,
        p_discount_bps: 1500,
      }),
      expect.any(Object),
    );
    expect(createTelegramStarsInvoiceMock).not.toHaveBeenCalled();
  });

  it("/api/boxes/create-open-order maps empty drop pools to the first-phase code", async () => {
    callRpcRawMock.mockRejectedValueOnce(
      new RpcError({
        rpcName: "gacha_open_with_kcoin_from_server_price",
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
          box_slug: "starter_egg",
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
        rpcName: "gacha_open_with_kcoin_from_server_price",
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
          box_slug: "starter_egg",
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

  it("/api/boxes/create-open-order keeps legacy stock RPC errors generic", async () => {
    callRpcRawMock.mockRejectedValueOnce(
      new RpcError({
        rpcName: "gacha_open_with_kcoin_from_server_price",
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
          box_slug: "starter_egg",
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
        message: "当前盲盒暂时不可开启，请刷新后重试。",
      },
    });
    expect(createTelegramStarsInvoiceMock).not.toHaveBeenCalled();
  });

  it("/api/boxes/create-open-order maps ledger failures without exposing database details", async () => {
    callRpcRawMock.mockRejectedValueOnce(
      new RpcError({
        rpcName: "gacha_open_with_kcoin_from_server_price",
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
          box_slug: "starter_egg",
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
          box_slug: "starter_egg",
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

  it("/api/boxes/create-open-order still opens with K-coin when Stars payment is disabled", async () => {
    assertStarsPaymentCreateAllowedMock.mockRejectedValueOnce({
      statusCode: 503,
      code: "FEATURE_STARS_PAYMENT_DISABLED",
      message: "Stars 支付暂未开放。",
      expose: true,
    });
    callRpcRawMock.mockResolvedValueOnce({
      draw_order_id: ORDER_ID,
      star_order_id: null,
      xtr_amount: 0,
      paid_kcoin: 10,
      total_price_kcoin: 10,
      quantity: 1,
      discount_bps: 0,
      idempotent: false,
      status: "completed",
      payment_status: "fulfilled",
      result_ready: true,
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
          "x-forwarded-for": "127.0.0.33",
        },
        body: {
          box_slug: "starter_egg",
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
        xtr_amount: 0,
        paid_kcoin: 10,
        payment_order_status: "fulfilled",
      },
    });
    expect(assertStarsPaymentCreateAllowedMock).not.toHaveBeenCalled();
    expect(createTelegramStarsInvoiceMock).not.toHaveBeenCalled();
  });

  it("/api/boxes/create-open-order creates a ten-draw order", async () => {
    callRpcRawMock.mockResolvedValueOnce({
      draw_order_id: ORDER_ID,
      star_order_id: null,
      xtr_amount: 0,
      paid_kcoin: 90,
      total_price_kcoin: 90,
      quantity: 10,
      discount_bps: 1000,
      idempotent: false,
      status: "completed",
      payment_status: "fulfilled",
      result_ready: true,
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
          box_slug: "starter_egg",
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
        xtr_amount: 0,
        paid_kcoin: 90,
        total_price_kcoin: 90,
        invoice_link: null,
        payment_order_status: "fulfilled",
      },
    });
    expect(callRpcRawMock).toHaveBeenCalledWith(
      "gacha_open_with_kcoin_from_server_price",
      expect.objectContaining({
        p_box_slug: "starter_egg",
        p_quantity: 10,
        p_unit_price_kcoin: 10,
        p_discount_bps: 1000,
      }),
      expect.any(Object),
    );
    expect(createTelegramStarsInvoiceMock).not.toHaveBeenCalled();
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
