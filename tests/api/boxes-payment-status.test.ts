import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

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

const USER_ID = "66666666-6666-4666-8666-666666666666";
const OTHER_USER_ID = "99999999-9999-4999-8999-999999999999";
const BOX_ID = "11111111-1111-4111-8111-111111111111";
const ORDER_ID = "22222222-2222-4222-8222-222222222222";
const STAR_ORDER_ID = "33333333-3333-4333-8333-333333333333";
const PAYMENT_ID = "44444444-4444-4444-8444-444444444444";

type QueryState = {
  schema: string;
  functionName: string;
  args: Record<string, unknown>;
};

type QueryResult = {
  data: unknown;
  error: unknown;
};

describe("boxes payment-status API", () => {
  beforeEach(() => {
    process.env.NODE_ENV = "test";
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-05-28T12:00:00.000Z"));
    getSupabaseAdminClientMock.mockReset();
    requireSessionMock.mockReset();
    requireSessionMock.mockResolvedValue({
      sessionId: "session-payment-status-test",
      userId: USER_ID,
      telegramUserId: 7001,
      userStatus: "active",
      expiresAt: "2026-05-29T00:00:00.000Z",
      sessionTokenHash: "session-hash",
    });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("returns a fulfilled payment status without exposing payment secrets or draw results", async () => {
    const db = createSupabaseMock({
      "api.gacha_get_payment_status": {
        data: {
          draw_order: createDrawOrder({
            status: "completed",
            payment_status: "dev_paid",
            opened_at: "2026-05-28T11:00:02.000Z",
            telegram_payment_charge_id: "tg-charge-should-not-leak",
          }),
          star_order: createStarOrder({
            status: "fulfilled",
            fulfilled_at: "2026-05-28T11:00:02.000Z",
          }),
          payment: {
            ...createStarPayment(),
            telegram_payment_charge_id: "tg-charge-should-not-leak",
            provider_payment_charge_id: "provider-charge-should-not-leak",
            raw_update: {
              secret: "raw-update-should-not-leak",
            },
          },
        },
        error: null,
      },
    });
    getSupabaseAdminClientMock.mockReturnValue(db.client);

    const { default: paymentStatusHandler } =
      await import("../../api/boxes/payment-status");
    const result = await invokeApiHandler<ApiSuccessResponse>(
      paymentStatusHandler,
      {
        method: "GET",
        url: "/api/boxes/payment-status",
        query: {
          orderId: ORDER_ID,
        },
        headers: {
          cookie: "tma_game_session=test-session-token-000000000000",
          "x-forwarded-for": "127.0.0.41",
        },
      },
    );

    expect(result.statusCode).toBe(200);
    expect(result.body).toMatchObject({
      ok: true,
      data: {
        order_id: ORDER_ID,
        star_order_id: STAR_ORDER_ID,
        status: "fulfilled",
        payment_order_status: "fulfilled",
        result_ready: true,
        draw_order: {
          id: ORDER_ID,
          status: "completed",
          payment_status: "fulfilled",
          draw_count: 10,
          quantity: 10,
          total_price_stars: 90,
          returned_kcoin: 0,
        },
        star_order: {
          id: STAR_ORDER_ID,
          status: "fulfilled",
          payment_order_status: "fulfilled",
        },
        payment: {
          recorded: true,
          status: "paid",
          currency: "XTR",
          xtr_amount: 90,
        },
        fulfillment: {
          status: "fulfilled",
          result_ready: true,
          failed: false,
          retryable: false,
        },
      },
    });
    expect(JSON.stringify(result.body)).not.toContain("results");
    expect(JSON.stringify(result.body)).not.toContain(
      "telegram_payment_charge_id",
    );
    expect(JSON.stringify(result.body)).not.toContain(
      "provider_payment_charge_id",
    );
    expect(JSON.stringify(result.body)).not.toContain("raw_update");
    expect(JSON.stringify(result.body)).not.toContain(
      "tg-charge-should-not-leak",
    );

    expect(db.queries).toEqual([
      {
        schema: "api",
        functionName: "gacha_get_payment_status",
        args: {
          p_user_id: USER_ID,
          p_draw_order_id: ORDER_ID,
        },
      },
    ]);
  });

  it("derives expired for unpaid pending orders without mutating the database", async () => {
    const db = createSupabaseMock({
      "api.gacha_get_payment_status": {
        data: {
          draw_order: createDrawOrder({
            status: "invoice_created",
            payment_status: "invoice_created",
            paid_at: null,
            opened_at: null,
          }),
          star_order: createStarOrder({
            status: "invoice_created",
            expires_at: "2026-05-28T00:00:00.000Z",
            paid_at: null,
            fulfilled_at: null,
          }),
          payment: null,
        },
        error: null,
      },
    });
    getSupabaseAdminClientMock.mockReturnValue(db.client);

    const { default: paymentStatusHandler } =
      await import("../../api/boxes/payment-status");
    const result = await invokeApiHandler<ApiSuccessResponse>(
      paymentStatusHandler,
      {
        method: "GET",
        url: "/api/boxes/payment-status",
        query: {
          order_id: ORDER_ID,
        },
        headers: {
          cookie: "tma_game_session=test-session-token-000000000000",
          "x-forwarded-for": "127.0.0.42",
        },
      },
    );

    expect(result.statusCode).toBe(200);
    expect(result.body).toMatchObject({
      ok: true,
      data: {
        status: "expired",
        payment_order_status: "expired",
        result_ready: false,
        payment: {
          recorded: false,
          status: "expired",
          paid_at: null,
        },
        fulfillment: {
          status: "expired",
          result_ready: false,
        },
      },
    });
    expect(db.mutations).toHaveLength(0);
  });

  it("returns 404 for orders not owned by the current session user", async () => {
    const db = createSupabaseMock({
      "api.gacha_get_payment_status": {
        data: null,
        error: null,
      },
    });
    getSupabaseAdminClientMock.mockReturnValue(db.client);

    const { default: paymentStatusHandler } =
      await import("../../api/boxes/payment-status");
    const result = await invokeApiHandler<ApiErrorResponse>(
      paymentStatusHandler,
      {
        method: "GET",
        url: "/api/boxes/payment-status",
        query: {
          orderId: ORDER_ID,
          user_id: OTHER_USER_ID,
        },
        headers: {
          cookie: "tma_game_session=test-session-token-000000000000",
          "x-forwarded-for": "127.0.0.43",
        },
      },
    );

    expect(result.statusCode).toBe(404);
    expect(result.body).toMatchObject({
      ok: false,
      error: {
        code: "ORDER_NOT_FOUND",
      },
    });
    expect(db.queries).toEqual([
      {
        schema: "api",
        functionName: "gacha_get_payment_status",
        args: {
          p_user_id: USER_ID,
          p_draw_order_id: ORDER_ID,
        },
      },
    ]);
  });
});

function createSupabaseMock(results: Record<string, QueryResult>) {
  const queries: QueryState[] = [];
  const mutations: unknown[] = [];

  const client = {
    schema(schema: string) {
      return {
        rpc(functionName: string, args: Record<string, unknown>) {
          const state: QueryState = {
            schema,
            functionName,
            args,
          };
          queries.push(state);

          return Promise.resolve(
            results[`${schema}.${functionName}`] ?? {
              data: null,
              error: null,
            },
          );
        },
      };
    },
  };

  return {
    client,
    queries,
    mutations,
  };
}

function createDrawOrder(overrides: Record<string, unknown> = {}) {
  return {
    id: ORDER_ID,
    user_id: USER_ID,
    box_id: BOX_ID,
    payment_star_order_id: STAR_ORDER_ID,
    status: "completed",
    payment_status: "dev_paid",
    draw_count: 10,
    quantity: 10,
    total_price_stars: 90,
    open_reward_kcoin: "100",
    paid_at: "2026-05-28T11:00:01.000Z",
    opened_at: "2026-05-28T11:00:02.000Z",
    created_at: "2026-05-28T10:59:00.000Z",
    updated_at: "2026-05-28T11:00:02.000Z",
    error_message: null,
    ...overrides,
  };
}

function createStarOrder(overrides: Record<string, unknown> = {}) {
  return {
    id: STAR_ORDER_ID,
    user_id: USER_ID,
    business_type: "gacha_open",
    business_id: ORDER_ID,
    status: "fulfilled",
    xtr_amount: 90,
    expires_at: "2026-05-28T12:15:00.000Z",
    precheckout_at: "2026-05-28T11:00:00.000Z",
    paid_at: "2026-05-28T11:00:01.000Z",
    fulfilled_at: "2026-05-28T11:00:02.000Z",
    created_at: "2026-05-28T10:59:00.000Z",
    updated_at: "2026-05-28T11:00:02.000Z",
    error_message: null,
    ...overrides,
  };
}

function createStarPayment(overrides: Record<string, unknown> = {}) {
  return {
    id: PAYMENT_ID,
    star_order_id: STAR_ORDER_ID,
    user_id: USER_ID,
    currency: "XTR",
    xtr_amount: 90,
    paid_at: "2026-05-28T11:00:01.000Z",
    created_at: "2026-05-28T11:00:01.000Z",
    ...overrides,
  };
}
