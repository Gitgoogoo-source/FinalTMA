import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ApiError, type ApiSuccessResponse } from "../../api/_shared/handler";
import { invokeApiHandler } from "./_utils";

const { getSupabaseAdminClientMock, requireAdminMock, runReadRpcMock } =
  vi.hoisted(() => ({
    getSupabaseAdminClientMock: vi.fn(),
    requireAdminMock: vi.fn(),
    runReadRpcMock: vi.fn(),
  }));

vi.mock("../../packages/server/src/db/supabaseAdmin.js", () => ({
  getSupabaseAdminClient: getSupabaseAdminClientMock,
}));

vi.mock("../../api/_shared/requireAdmin.js", () => ({
  requireAdmin: requireAdminMock,
}));

vi.mock("../../packages/server/src/db/transactions.js", () => ({
  runReadRpc: runReadRpcMock,
}));

const ADMIN_CONTEXT = {
  sessionId: "session-admin-business-monitoring-test",
  userId: "11111111-1111-4111-8111-111111111111",
  telegramUserId: 7001,
  userStatus: "active",
  expiresAt: "2026-06-01T00:00:00.000Z",
  sessionTokenHash: "session-hash",
  adminId: "22222222-2222-4222-8222-222222222222",
  roleId: "33333333-3333-4333-8333-333333333333",
  roleCode: "SUPER_ADMIN",
  isSuperAdmin: true,
  permissions: ["*"],
};

describe("admin business monitoring API", () => {
  beforeEach(() => {
    process.env.NODE_ENV = "test";
    vi.resetModules();
    getSupabaseAdminClientMock.mockReset();
    requireAdminMock.mockReset();
    runReadRpcMock.mockReset();
    requireAdminMock.mockResolvedValue(ADMIN_CONTEXT);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it("returns business metrics through the api RPC facade", async () => {
    runReadRpcMock.mockResolvedValueOnce({
      serverTime: "2026-06-01T00:00:00.000Z",
      window: {
        hours: 168,
        startedAt: "2026-05-25T00:00:00.000Z",
        endedAt: "2026-06-01T00:00:00.000Z",
      },
      metrics: {
        starsGmv: {
          value: 50,
          paymentCount: 2,
        },
        paymentSuccessRate: {
          numerator: 2,
          denominator: 3,
          status: "critical",
        },
        operationalErrors: {
          api5xxCount: 1,
          supabaseQueryErrorCount: 1,
          rateLimitHitCount: 1,
          total: 3,
          status: "critical",
        },
      },
      sources: {
        payments: {
          starPayments: "payments.star_payments.xtr_amount",
        },
      },
    });

    const { default: handler } =
      await import("../../api/admin/monitoring/business");
    const result = await invokeApiHandler<ApiSuccessResponse>(handler, {
      method: "GET",
      url: "/api/admin/monitoring/business?windowHours=999",
      query: {
        windowHours: "999",
      },
    });

    expect(result.statusCode).toBe(200);
    expect(requireAdminMock).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        permissions: expect.arrayContaining(["admin:read", "payments:read"]),
        requireAll: false,
      }),
    );
    expect(runReadRpcMock).toHaveBeenCalledWith(
      expect.objectContaining({
        schema: "api",
        functionName: "admin_get_business_monitoring",
        args: expect.objectContaining({
          p_admin_user_id: ADMIN_CONTEXT.adminId,
          p_window_hours: 168,
          p_request_context: expect.objectContaining({
            admin_user_id: ADMIN_CONTEXT.adminId,
          }),
        }),
      }),
    );
    expect(result.body).toMatchObject({
      ok: true,
      data: {
        metrics: {
          starsGmv: {
            value: 50,
          },
          operationalErrors: {
            total: 3,
          },
        },
      },
    });
    expect(JSON.stringify(result.body)).not.toContain("raw_update");
    expect(JSON.stringify(result.body)).not.toContain(
      "telegram_payment_charge_id",
    );
  });

  it("rejects non-admin requests before reading monitoring RPCs", async () => {
    requireAdminMock.mockRejectedValue(
      new ApiError(403, "FORBIDDEN", "Admin permission required"),
    );

    const { default: handler } =
      await import("../../api/admin/monitoring/business");
    const result = await invokeApiHandler(handler, {
      method: "GET",
      url: "/api/admin/monitoring/business",
    });

    expect(result.statusCode).toBe(403);
    expect(runReadRpcMock).not.toHaveBeenCalled();
  });

  it("allows only GET", async () => {
    const { default: handler } =
      await import("../../api/admin/monitoring/business");
    const result = await invokeApiHandler(handler, {
      method: "POST",
      url: "/api/admin/monitoring/business",
    });

    expect(result.statusCode).toBe(405);
    expect(requireAdminMock).not.toHaveBeenCalled();
    expect(runReadRpcMock).not.toHaveBeenCalled();
  });
});

describe("API observability reporting", () => {
  beforeEach(() => {
    process.env.NODE_ENV = "test";
    process.env.AXIOM_TOKEN = "axiom-test-token";
    process.env.AXIOM_DATASET = "tma-game-test";
    process.env.SENTRY_ENVIRONMENT = "staging";
    delete process.env.SENTRY_DSN;
    delete process.env.LOGTAIL_SOURCE_TOKEN;
    vi.resetModules();
    getSupabaseAdminClientMock.mockReset();
    runReadRpcMock.mockReset();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    delete process.env.AXIOM_TOKEN;
    delete process.env.AXIOM_DATASET;
    delete process.env.SENTRY_ENVIRONMENT;
  });

  it("reports 5xx errors from withApiHandler without leaking secret context", async () => {
    const insertMock = vi.fn().mockResolvedValue({
      error: null,
    });
    getSupabaseAdminClientMock.mockReturnValue({
      schema: () => ({
        from: () => ({
          insert: insertMock,
        }),
      }),
    });
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 202,
    });
    vi.stubGlobal("fetch", fetchMock);

    const { withApiHandler } = await import("../../api/_shared/handler");
    const handler = withApiHandler(
      async () => {
        throw new ApiError(
          500,
          "OBSERVABILITY_TEST_FAILED",
          "Authorization: Bearer secret-value failed",
          {
            expose: false,
          },
        );
      },
      {
        methods: ["GET"],
        rateLimit: false,
      },
    );

    const result = await invokeApiHandler(handler, {
      method: "GET",
      url: "/api/test-observability",
    });

    expect(result.statusCode).toBe(500);
    await flushPromises();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(insertMock).toHaveBeenCalledWith({
      user_id: null,
      event_name: "api.5xx",
      event_source: "api.handler",
      payload: {
        requestId: expect.any(String),
      },
    });

    const [, init] = fetchMock.mock.calls[0] as [
      string,
      { body: string; headers: Record<string, string> },
    ];
    const payload = JSON.parse(init.body) as Array<{
      eventName: string;
      environment: string;
      error: { message: string };
      context: Record<string, unknown>;
    }>;

    expect(payload[0]).toMatchObject({
      eventName: "api.5xx",
      environment: "staging",
      context: {
        requestId: expect.any(String),
      },
    });
    expect(Object.keys(payload[0]?.context ?? {})).toEqual(["requestId"]);
    expect(JSON.stringify(payload)).not.toContain("secret-value");
    expect(JSON.stringify(insertMock.mock.calls)).not.toContain(
      "/api/test-observability",
    );
    expect(init.headers.Authorization).toBe("Bearer axiom-test-token");
  });

  it("records Supabase query errors into ops app events", async () => {
    const insertMock = vi.fn().mockResolvedValue({
      error: null,
    });
    getSupabaseAdminClientMock.mockReturnValue({
      schema: () => ({
        from: () => ({
          insert: insertMock,
        }),
      }),
    });

    const { withApiHandler } = await import("../../api/_shared/handler");
    const handler = withApiHandler(
      async () => {
        const queryError = new Error(
          "Supabase RPC admin_get_business_monitoring failed",
        );
        queryError.name = "RpcError";
        (queryError as Error & { code: string }).code = "PGRST116";

        throw queryError;
      },
      {
        methods: ["GET"],
        rateLimit: false,
      },
    );

    const result = await invokeApiHandler(handler, {
      method: "GET",
      url: "/api/test-supabase-query-error",
    });

    expect(result.statusCode).toBe(500);
    await flushPromises();
    expect(insertMock).toHaveBeenCalledTimes(2);
    expect(insertMock).toHaveBeenNthCalledWith(1, {
      user_id: null,
      event_name: "api.5xx",
      event_source: "api.handler",
      payload: {
        requestId: expect.any(String),
      },
    });
    expect(insertMock).toHaveBeenNthCalledWith(2, {
      user_id: null,
      event_name: "supabase.query_error",
      event_source: "supabase.query",
      payload: {
        requestId: expect.any(String),
      },
    });
  });

  it("records rate limit errors into ops app events", async () => {
    const insertMock = vi.fn().mockResolvedValue({
      error: null,
    });
    getSupabaseAdminClientMock.mockReturnValue({
      schema: () => ({
        from: () => ({
          insert: insertMock,
        }),
      }),
    });

    const { withApiHandler } = await import("../../api/_shared/handler");
    const handler = withApiHandler(
      async () => {
        throw new ApiError(429, "RATE_LIMITED", "Too many requests");
      },
      {
        methods: ["GET"],
        rateLimit: false,
      },
    );

    const result = await invokeApiHandler(handler, {
      method: "GET",
      url: "/api/test-rate-limit?token=must-not-leak",
    });

    expect(result.statusCode).toBe(429);
    await flushPromises();
    expect(insertMock).toHaveBeenCalledWith({
      user_id: null,
      event_name: "api.rate_limited",
      event_source: "api.handler",
      payload: {
        requestId: expect.any(String),
      },
    });
    expect(JSON.stringify(insertMock.mock.calls)).not.toContain(
      "must-not-leak",
    );
  });

  it("maps preview and production observability environments separately", async () => {
    const { resolveObservabilityEnvironment } =
      await import("../../api/_shared/observability");

    expect(
      resolveObservabilityEnvironment({
        VERCEL_ENV: "preview",
      } as NodeJS.ProcessEnv),
    ).toBe("staging");
    expect(
      resolveObservabilityEnvironment({
        VERCEL_ENV: "production",
      } as NodeJS.ProcessEnv),
    ).toBe("production");
  });
});

function flushPromises(): Promise<void> {
  return new Promise((resolve) => {
    setImmediate(resolve);
  });
}
