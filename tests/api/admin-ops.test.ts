import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ApiError, type ApiSuccessResponse } from "../../api/_shared/handler";
import { invokeApiHandler } from "./_utils";

const { getSupabaseAdminClientMock, requireAdminMock, runWriteRpcMock } =
  vi.hoisted(() => ({
    getSupabaseAdminClientMock: vi.fn(),
    requireAdminMock: vi.fn(),
    runWriteRpcMock: vi.fn(),
  }));

vi.mock("../../packages/server/src/db/supabaseAdmin.js", () => ({
  getSupabaseAdminClient: getSupabaseAdminClientMock,
}));

vi.mock("../../api/_shared/requireAdmin.js", () => ({
  requireAdmin: requireAdminMock,
}));

vi.mock("../../packages/server/src/db/transactions.js", () => ({
  runWriteRpc: runWriteRpcMock,
}));

const ADMIN_CONTEXT = {
  sessionId: "session-admin-ops-test",
  userId: "11111111-1111-4111-8111-111111111111",
  telegramUserId: 7001,
  userStatus: "active",
  expiresAt: "2026-05-30T00:00:00.000Z",
  sessionTokenHash: "session-hash",
  adminId: "22222222-2222-4222-8222-222222222222",
  roleId: "33333333-3333-4333-8333-333333333333",
  roleCode: "SUPER_ADMIN",
  isSuperAdmin: true,
  permissions: ["*"],
};

const MINT_QUEUE_ID = "44444444-4444-4444-8444-444444444444";
const TARGET_ADMIN_USER_ID = "55555555-5555-4555-8555-555555555555";
const ADMIN_ROLE_ID = "99999999-9999-4999-8999-999999999999";
const STAR_ORDER_ID = "66666666-6666-4666-8666-666666666666";
const PAYMENT_ID = "77777777-7777-4777-8777-777777777777";

type AdminQueryOperation = {
  schema: string;
  table: string;
  selectedColumns: string[] | null;
  filters: Array<{
    kind: "eq" | "gte" | "lte" | "ilike" | "in";
    column: string;
    value: unknown;
  }>;
  range: [number, number] | null;
  limit: number | null;
};

type AdminTableRows = Record<string, Array<Record<string, unknown>>>;

describe("admin ops APIs", () => {
  beforeEach(() => {
    process.env.NODE_ENV = "test";
    getSupabaseAdminClientMock.mockReset();
    requireAdminMock.mockReset();
    runWriteRpcMock.mockReset();
    requireAdminMock.mockResolvedValue(ADMIN_CONTEXT);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it("rejects non-admin payment queries before reading admin payment tables", async () => {
    requireAdminMock.mockRejectedValue(
      new ApiError(403, "FORBIDDEN", "Admin permission required"),
    );

    const { default: paymentsHandler } =
      await import("../../api/admin/payments");
    const result = await invokeApiHandler(paymentsHandler, {
      method: "GET",
      url: "/api/admin/payments",
    });

    expect(result.statusCode).toBe(403);
    expect(getSupabaseAdminClientMock).not.toHaveBeenCalled();
  });

  it("returns the current admin session permissions without leaking session token data", async () => {
    const { default: meHandler } = await import("../../api/admin/me");
    const result = await invokeApiHandler<ApiSuccessResponse>(meHandler, {
      method: "GET",
      url: "/api/admin/me",
    });

    expect(result.statusCode).toBe(200);
    expect(result.body).toMatchObject({
      ok: true,
      data: {
        adminId: ADMIN_CONTEXT.adminId,
        roleCode: "SUPER_ADMIN",
        isSuperAdmin: true,
        permissions: ["*"],
      },
    });
    expect(JSON.stringify(result.body)).not.toContain("session-hash");
    expect(requireAdminMock).toHaveBeenCalledWith(expect.anything());
  });

  it("rejects non-admin /admin/me requests", async () => {
    requireAdminMock.mockRejectedValue(
      new ApiError(403, "FORBIDDEN", "Admin permission required"),
    );

    const { default: meHandler } = await import("../../api/admin/me");
    const result = await invokeApiHandler(meHandler, {
      method: "GET",
      url: "/api/admin/me",
    });

    expect(result.statusCode).toBe(403);
    expect(result.body).toMatchObject({
      error: {
        code: "FORBIDDEN",
      },
    });
    expect(getSupabaseAdminClientMock).not.toHaveBeenCalled();
  });

  it("lets admins query payment orders with payment and exception context", async () => {
    const db = createAdminReadDbMock({
      "payments.star_orders": [
        {
          id: STAR_ORDER_ID,
          user_id: ADMIN_CONTEXT.userId,
          business_type: "gacha_open",
          business_id: null,
          status: "failed",
          xtr_amount: 10,
          telegram_invoice_payload: "invoice-admin-query-test",
          title: "Admin query payment",
          description: null,
          expires_at: null,
          precheckout_at: null,
          paid_at: "2026-05-29T00:00:00.000Z",
          fulfilled_at: null,
          error_message: "fulfillment failed",
          metadata: {},
          created_at: "2026-05-29T00:00:00.000Z",
          updated_at: "2026-05-29T00:00:00.000Z",
        },
      ],
      "payments.star_payments": [
        {
          id: PAYMENT_ID,
          star_order_id: STAR_ORDER_ID,
          user_id: ADMIN_CONTEXT.userId,
          xtr_amount: 10,
          currency: "XTR",
          invoice_payload: "invoice-admin-query-test",
          paid_at: "2026-05-29T00:00:01.000Z",
          created_at: "2026-05-29T00:00:01.000Z",
        },
      ],
      "payments.telegram_webhook_events": [
        {
          id: "88888888-8888-4888-8888-888888888888",
          update_id: 1001,
          event_type: "successful_payment",
          user_id: ADMIN_CONTEXT.userId,
          telegram_user_id: ADMIN_CONTEXT.telegramUserId,
          invoice_payload: "invoice-admin-query-test",
          process_status: "failed",
          processed_at: null,
          error_message: "fulfillment failed",
          retry_count: 1,
          next_retry_at: null,
          webhook_secret_verified: true,
          status_context: {},
          created_at: "2026-05-29T00:00:02.000Z",
        },
      ],
      "payments.star_refunds": [],
      "payments.payment_disputes": [],
    });
    getSupabaseAdminClientMock.mockReturnValue(db.client);

    const { default: paymentsHandler } =
      await import("../../api/admin/payments");
    const result = await invokeApiHandler<ApiSuccessResponse>(paymentsHandler, {
      method: "GET",
      url: "/api/admin/payments?status=failed&limit=10",
      query: {
        status: "failed",
        limit: "10",
      },
    });

    expect(result.statusCode).toBe(200);
    expect(result.body).toMatchObject({
      ok: true,
      data: {
        orders: [
          {
            id: STAR_ORDER_ID,
            status: "failed",
            xtr_amount: 10,
            payment: {
              id: PAYMENT_ID,
              star_order_id: STAR_ORDER_ID,
              currency: "XTR",
            },
          },
        ],
        events: [
          {
            event_type: "successful_payment",
            process_status: "failed",
          },
        ],
        exceptions: [
          {
            id: STAR_ORDER_ID,
            status: "failed",
          },
        ],
        summary: {
          failed: 1,
        },
      },
    });
    expect(requireAdminMock).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        permissions: "payments:read",
      }),
    );
    expect(db.operations).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          schema: "payments",
          table: "star_orders",
          filters: expect.arrayContaining([
            {
              kind: "eq",
              column: "status",
              value: "failed",
            },
          ]),
        }),
      ]),
    );
  });

  it("lets admins query phase 5 monitoring metrics", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-05-30T00:00:00.000Z"));

    const db = createAdminReadDbMock({
      "payments.star_orders": [
        {
          id: STAR_ORDER_ID,
          user_id: ADMIN_CONTEXT.userId,
          status: "failed",
          paid_at: "2026-05-29T23:10:00.000Z",
          fulfilled_at: null,
          error_message: "fulfillment failed",
          created_at: "2026-05-29T23:00:00.000Z",
          updated_at: "2026-05-29T23:11:00.000Z",
        },
        {
          id: "66666666-6666-4666-8666-666666666667",
          user_id: ADMIN_CONTEXT.userId,
          status: "fulfilled",
          paid_at: "2026-05-29T22:30:00.000Z",
          fulfilled_at: "2026-05-29T22:31:00.000Z",
          error_message: null,
          created_at: "2026-05-29T22:00:00.000Z",
          updated_at: "2026-05-29T22:31:00.000Z",
        },
        {
          id: "66666666-6666-4666-8666-666666666668",
          user_id: ADMIN_CONTEXT.userId,
          status: "paid",
          paid_at: "2026-05-29T23:20:00.000Z",
          fulfilled_at: null,
          error_message: null,
          created_at: "2026-05-29T23:19:00.000Z",
          updated_at: "2026-05-29T23:20:00.000Z",
        },
      ],
      "payments.telegram_webhook_events": [
        {
          id: "88888888-8888-4888-8888-888888888888",
          update_id: 1001,
          event_type: "successful_payment",
          process_status: "processed",
          processed_at: "2026-05-29T23:00:03.000Z",
          error_message: null,
          created_at: "2026-05-29T23:00:00.000Z",
        },
        {
          id: "88888888-8888-4888-8888-888888888889",
          update_id: 1002,
          event_type: "successful_payment",
          process_status: "processing",
          processed_at: null,
          error_message: null,
          created_at: "2026-05-29T23:50:00.000Z",
        },
      ],
      "onchain.mint_queue": [
        {
          id: MINT_QUEUE_ID,
          user_id: ADMIN_CONTEXT.userId,
          status: "processing",
          attempt_count: 1,
          max_attempts: 3,
          next_attempt_at: null,
          completed_at: null,
          error_message: null,
          created_at: "2026-05-29T22:00:00.000Z",
          updated_at: "2026-05-29T23:00:00.000Z",
        },
      ],
    });
    getSupabaseAdminClientMock.mockReturnValue(db.client);

    const { default: monitoringHandler } =
      await import("../../api/admin/monitoring");
    const result = await invokeApiHandler<ApiSuccessResponse>(
      monitoringHandler,
      {
        method: "GET",
        url: "/api/admin/monitoring?windowHours=24",
        query: {
          windowHours: "24",
        },
      },
    );

    expect(result.statusCode).toBe(200);
    expect(result.body).toMatchObject({
      ok: true,
      data: {
        metrics: {
          paymentFailureRate: {
            key: "payment_failure_rate",
            numerator: 1,
            denominator: 3,
            status: "critical",
          },
          fulfillmentFailureRate: {
            key: "fulfillment_failure_rate",
            numerator: 1,
            denominator: 3,
            stuckCount: 1,
            status: "critical",
          },
          webhookLatency: {
            key: "webhook_latency",
            p95Ms: 3000,
            pendingCount: 1,
            stuckCount: 1,
            status: "critical",
          },
          mintStuckCount: {
            key: "mint_stuck_count",
            activeCount: 1,
            stuckCount: 1,
            status: "warning",
          },
        },
      },
    });
    expect(requireAdminMock).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        permissions: ["payments:read", "mint:read", "onchain:read"],
      }),
    );
    expect(db.operations).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          schema: "payments",
          table: "star_orders",
          filters: expect.arrayContaining([
            expect.objectContaining({
              kind: "gte",
              column: "created_at",
            }),
          ]),
        }),
        expect.objectContaining({
          schema: "onchain",
          table: "mint_queue",
        }),
      ]),
    );
  });

  it("lets admins query admin users with role summaries without leaking metadata", async () => {
    const db = createAdminReadDbMock({
      "ops.admin_users": [
        {
          id: TARGET_ADMIN_USER_ID,
          core_user_id: ADMIN_CONTEXT.userId,
          telegram_user_id: 7002,
          display_name: "Ops Admin",
          status: "active",
          last_login_at: "2026-05-29T00:00:00.000Z",
          metadata: {
            permissions: ["admin:write"],
            secret_note: "do-not-return",
          },
          created_at: "2026-05-28T00:00:00.000Z",
          updated_at: "2026-05-29T00:00:00.000Z",
        },
      ],
      "ops.admin_user_roles": [
        {
          admin_user_id: TARGET_ADMIN_USER_ID,
          role_id: ADMIN_ROLE_ID,
          granted_by_admin_id: ADMIN_CONTEXT.adminId,
          granted_at: "2026-05-29T00:00:00.000Z",
        },
      ],
      "ops.admin_roles": [
        {
          id: ADMIN_ROLE_ID,
          code: "OPS",
          display_name: "Operations",
          permissions: ["gacha:read"],
          created_at: "2026-05-28T00:00:00.000Z",
          updated_at: "2026-05-29T00:00:00.000Z",
        },
      ],
    });
    getSupabaseAdminClientMock.mockReturnValue(db.client);

    const { default: adminUsersHandler } =
      await import("../../api/admin/admin-users");
    const result = await invokeApiHandler<ApiSuccessResponse>(
      adminUsersHandler,
      {
        method: "GET",
        url: "/api/admin/admin-users?status=active&limit=10",
        query: {
          status: "active",
          limit: "10",
        },
      },
    );

    expect(result.statusCode).toBe(200);
    expect(result.body).toMatchObject({
      ok: true,
      data: {
        items: [
          {
            id: TARGET_ADMIN_USER_ID,
            core_user_id: ADMIN_CONTEXT.userId,
            telegram_user_id: 7002,
            display_name: "Ops Admin",
            status: "active",
            roles: [
              {
                id: ADMIN_ROLE_ID,
                code: "OPS",
                display_name: "Operations",
              },
            ],
          },
        ],
        summary: {
          active: 1,
        },
      },
    });
    expect(JSON.stringify(result.body)).not.toContain("do-not-return");
    expect(requireAdminMock).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        permissions: ["admin:read", "roles:read"],
        requireAll: false,
      }),
    );
  });

  it("lets admins query roles with bound admin counts", async () => {
    const db = createAdminReadDbMock({
      "ops.admin_roles": [
        {
          id: ADMIN_ROLE_ID,
          code: "OPS",
          display_name: "Operations",
          permissions: ["gacha:read", "gacha:write"],
          created_at: "2026-05-28T00:00:00.000Z",
          updated_at: "2026-05-29T00:00:00.000Z",
        },
      ],
      "ops.admin_user_roles": [
        {
          admin_user_id: TARGET_ADMIN_USER_ID,
          role_id: ADMIN_ROLE_ID,
          granted_by_admin_id: ADMIN_CONTEXT.adminId,
          granted_at: "2026-05-29T00:00:00.000Z",
        },
      ],
    });
    getSupabaseAdminClientMock.mockReturnValue(db.client);

    const { default: rolesHandler } = await import("../../api/admin/roles");
    const result = await invokeApiHandler<ApiSuccessResponse>(rolesHandler, {
      method: "GET",
      url: "/api/admin/roles",
    });

    expect(result.statusCode).toBe(200);
    expect(result.body).toMatchObject({
      ok: true,
      data: {
        items: [
          {
            id: ADMIN_ROLE_ID,
            code: "OPS",
            permissions: ["gacha:read", "gacha:write"],
            admin_user_count: 1,
          },
        ],
      },
    });
    expect(requireAdminMock).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        permissions: ["admin:read", "roles:read"],
        requireAll: false,
      }),
    );
  });

  it("calls the admin grant role RPC with confirmation, reason and idempotency", async () => {
    runWriteRpcMock.mockResolvedValue({
      admin_user_id: TARGET_ADMIN_USER_ID,
      role_id: ADMIN_ROLE_ID,
      audit_log_id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    });

    const { default: grantRoleHandler } =
      await import("../../api/admin/grant-role");
    const result = await invokeApiHandler<ApiSuccessResponse>(
      grantRoleHandler,
      {
        method: "POST",
        url: "/api/admin/grant-role",
        headers: {
          "x-admin-confirm": "true",
          "x-idempotency-key": "admin-grant-role-test-001",
          "x-forwarded-for": "127.0.0.30",
          "user-agent": "vitest-admin-grant-role",
        },
        body: {
          adminUserId: TARGET_ADMIN_USER_ID,
          roleId: ADMIN_ROLE_ID,
          reason: "grant ops role in admin test",
        },
      },
    );

    expect(result.statusCode).toBe(200);
    expect(result.body).toMatchObject({
      ok: true,
      data: {
        admin_user_id: TARGET_ADMIN_USER_ID,
        role_id: ADMIN_ROLE_ID,
      },
    });
    expect(runWriteRpcMock).toHaveBeenCalledWith(
      expect.objectContaining({
        schema: "api",
        functionName: "admin_grant_role",
        args: expect.objectContaining({
          p_admin_user_id: ADMIN_CONTEXT.adminId,
          p_target_admin_user_id: TARGET_ADMIN_USER_ID,
          p_role_id: ADMIN_ROLE_ID,
          p_reason: "grant ops role in admin test",
          p_idempotency_key: "admin-grant-role-test-001",
          p_request_context: expect.objectContaining({
            admin_user_id: ADMIN_CONTEXT.adminId,
            ip_hash: expect.any(String),
            user_agent_hash: expect.any(String),
          }),
        }),
      }),
    );
    expect(requireAdminMock).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        permissions: ["admin:write", "roles:write"],
        requireAll: false,
      }),
    );
  });

  it("calls the admin revoke role RPC with confirmation, reason and idempotency", async () => {
    runWriteRpcMock.mockResolvedValue({
      admin_user_id: TARGET_ADMIN_USER_ID,
      role_id: ADMIN_ROLE_ID,
      audit_log_id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
    });

    const { default: revokeRoleHandler } =
      await import("../../api/admin/revoke-role");
    const result = await invokeApiHandler<ApiSuccessResponse>(
      revokeRoleHandler,
      {
        method: "POST",
        url: "/api/admin/revoke-role",
        headers: {
          "x-admin-confirm": "true",
          "x-idempotency-key": "admin-revoke-role-test-001",
          "x-forwarded-for": "127.0.0.31",
          "user-agent": "vitest-admin-revoke-role",
        },
        body: {
          adminUserId: TARGET_ADMIN_USER_ID,
          roleId: ADMIN_ROLE_ID,
          reason: "revoke ops role in admin test",
        },
      },
    );

    expect(result.statusCode).toBe(200);
    expect(result.body).toMatchObject({
      ok: true,
      data: {
        admin_user_id: TARGET_ADMIN_USER_ID,
        role_id: ADMIN_ROLE_ID,
      },
    });
    expect(runWriteRpcMock).toHaveBeenCalledWith(
      expect.objectContaining({
        schema: "api",
        functionName: "admin_revoke_role",
        args: expect.objectContaining({
          p_admin_user_id: ADMIN_CONTEXT.adminId,
          p_target_admin_user_id: TARGET_ADMIN_USER_ID,
          p_role_id: ADMIN_ROLE_ID,
          p_reason: "revoke ops role in admin test",
          p_idempotency_key: "admin-revoke-role-test-001",
          p_request_context: expect.objectContaining({
            admin_user_id: ADMIN_CONTEXT.adminId,
            ip_hash: expect.any(String),
            user_agent_hash: expect.any(String),
          }),
        }),
      }),
    );
  });

  it("requires explicit confirmation for grant-role requests", async () => {
    const { default: grantRoleHandler } =
      await import("../../api/admin/grant-role");
    const result = await invokeApiHandler(grantRoleHandler, {
      method: "POST",
      url: "/api/admin/grant-role",
      headers: {
        "x-idempotency-key": "admin-grant-role-test-002",
      },
      body: {
        adminUserId: TARGET_ADMIN_USER_ID,
        roleId: ADMIN_ROLE_ID,
        reason: "grant ops role in admin test",
      },
    });

    expect(result.statusCode).toBe(400);
    expect(result.body).toMatchObject({
      error: {
        code: "ADMIN_CONFIRMATION_REQUIRED",
      },
    });
    expect(runWriteRpcMock).not.toHaveBeenCalled();
  });

  it("rejects non-admin retry-mint requests before calling the write RPC", async () => {
    requireAdminMock.mockRejectedValue(
      new ApiError(403, "FORBIDDEN", "Admin permission required"),
    );

    const { default: retryMintHandler } =
      await import("../../api/admin/retry-mint");
    const result = await invokeApiHandler(retryMintHandler, {
      method: "POST",
      url: "/api/admin/retry-mint",
      headers: {
        "x-admin-confirm": "true",
        "x-idempotency-key": "admin-retry-mint-test-001",
      },
      body: {
        mintQueueId: MINT_QUEUE_ID,
        reason: "retry failed mint in admin test",
      },
    });

    expect(result.statusCode).toBe(403);
    expect(runWriteRpcMock).not.toHaveBeenCalled();
  });

  it("calls the admin retry mint RPC with audit context and idempotency key", async () => {
    runWriteRpcMock.mockResolvedValue({
      mint_queue_id: MINT_QUEUE_ID,
      status: "retrying",
      previous_status: "failed",
      audit_log_id: "55555555-5555-4555-8555-555555555555",
    });

    const { default: retryMintHandler } =
      await import("../../api/admin/retry-mint");
    const result = await invokeApiHandler<ApiSuccessResponse>(
      retryMintHandler,
      {
        method: "POST",
        url: "/api/admin/retry-mint",
        headers: {
          "x-admin-confirm": "true",
          "x-idempotency-key": "admin-retry-mint-test-002",
          "x-forwarded-for": "127.0.0.20",
          "user-agent": "vitest-admin-ops",
        },
        body: {
          mintQueueId: MINT_QUEUE_ID,
          priority: "HIGH",
          reason: "retry failed mint in admin test",
        },
      },
    );

    expect(result.statusCode).toBe(200);
    expect(result.body).toMatchObject({
      ok: true,
      data: {
        mint_queue_id: MINT_QUEUE_ID,
        status: "retrying",
      },
    });
    expect(runWriteRpcMock).toHaveBeenCalledWith(
      expect.objectContaining({
        schema: "api",
        functionName: "admin_retry_mint_queue",
        args: expect.objectContaining({
          p_admin_user_id: ADMIN_CONTEXT.adminId,
          p_mint_queue_id: MINT_QUEUE_ID,
          p_priority: "HIGH",
          p_reason: "retry failed mint in admin test",
          p_idempotency_key: "admin-retry-mint-test-002",
          p_request_context: expect.objectContaining({
            admin_user_id: ADMIN_CONTEXT.adminId,
            ip_hash: expect.any(String),
            user_agent_hash: expect.any(String),
          }),
        }),
      }),
    );
  });

  it("requires explicit confirmation for retry-mint requests", async () => {
    const { default: retryMintHandler } =
      await import("../../api/admin/retry-mint");
    const result = await invokeApiHandler(retryMintHandler, {
      method: "POST",
      url: "/api/admin/retry-mint",
      headers: {
        "x-idempotency-key": "admin-retry-mint-test-003",
      },
      body: {
        mintQueueId: MINT_QUEUE_ID,
        reason: "retry failed mint in admin test",
      },
    });

    expect(result.statusCode).toBe(400);
    expect(result.body).toMatchObject({
      error: {
        code: "ADMIN_CONFIRMATION_REQUIRED",
      },
    });
    expect(runWriteRpcMock).not.toHaveBeenCalled();
  });

  it("calls the admin retry fulfillment RPC with audit context and idempotency key", async () => {
    runWriteRpcMock.mockResolvedValue({
      star_order_id: STAR_ORDER_ID,
      status: "fulfilled",
      previous_status: "failed",
      fulfilled: true,
      audit_log_id: "77777777-7777-4777-8777-777777777777",
    });

    const { default: retryFulfillmentHandler } =
      await import("../../api/admin/retry-fulfillment");
    const result = await invokeApiHandler<ApiSuccessResponse>(
      retryFulfillmentHandler,
      {
        method: "POST",
        url: "/api/admin/retry-fulfillment",
        headers: {
          "x-admin-confirm": "true",
          "x-idempotency-key": "admin-retry-fulfillment-test-001",
          "x-forwarded-for": "127.0.0.21",
          "user-agent": "vitest-admin-fulfillment",
        },
        body: {
          starOrderId: STAR_ORDER_ID,
          reason: "retry failed fulfillment in admin test",
        },
      },
    );

    expect(result.statusCode).toBe(200);
    expect(result.body).toMatchObject({
      ok: true,
      data: {
        star_order_id: STAR_ORDER_ID,
        status: "fulfilled",
      },
    });
    expect(runWriteRpcMock).toHaveBeenCalledWith(
      expect.objectContaining({
        schema: "api",
        functionName: "admin_retry_payment_fulfillment",
        args: expect.objectContaining({
          p_admin_user_id: ADMIN_CONTEXT.adminId,
          p_star_order_id: STAR_ORDER_ID,
          p_reason: "retry failed fulfillment in admin test",
          p_idempotency_key: "admin-retry-fulfillment-test-001",
          p_request_context: expect.objectContaining({
            admin_user_id: ADMIN_CONTEXT.adminId,
            ip_hash: expect.any(String),
            user_agent_hash: expect.any(String),
          }),
        }),
      }),
    );
  });

  it("requires a reason for retry-fulfillment requests", async () => {
    const { default: retryFulfillmentHandler } =
      await import("../../api/admin/retry-fulfillment");
    const result = await invokeApiHandler(retryFulfillmentHandler, {
      method: "POST",
      url: "/api/admin/retry-fulfillment",
      headers: {
        "x-admin-confirm": "true",
        "x-idempotency-key": "admin-retry-fulfillment-test-002",
      },
      body: {
        starOrderId: STAR_ORDER_ID,
      },
    });

    expect(result.statusCode).toBe(400);
    expect(result.body).toMatchObject({
      error: {
        code: "VALIDATION_FAILED",
      },
    });
    expect(runWriteRpcMock).not.toHaveBeenCalled();
  });

  it("requires explicit confirmation for retry-fulfillment requests", async () => {
    const { default: retryFulfillmentHandler } =
      await import("../../api/admin/retry-fulfillment");
    const result = await invokeApiHandler(retryFulfillmentHandler, {
      method: "POST",
      url: "/api/admin/retry-fulfillment",
      headers: {
        "x-idempotency-key": "admin-retry-fulfillment-test-003",
      },
      body: {
        starOrderId: STAR_ORDER_ID,
        reason: "retry failed fulfillment in admin test",
      },
    });

    expect(result.statusCode).toBe(400);
    expect(result.body).toMatchObject({
      error: {
        code: "ADMIN_CONFIRMATION_REQUIRED",
      },
    });
    expect(runWriteRpcMock).not.toHaveBeenCalled();
  });

  it("rejects non-admin feature flag updates before calling the write RPC", async () => {
    requireAdminMock.mockRejectedValue(
      new ApiError(403, "FORBIDDEN", "Admin permission required"),
    );

    const { default: featureFlagsHandler } =
      await import("../../api/admin/feature-flags");
    const result = await invokeApiHandler(featureFlagsHandler, {
      method: "PATCH",
      url: "/api/admin/feature-flags",
      headers: {
        "x-admin-confirm": "true",
        "x-idempotency-key": "admin-feature-flag-test-001",
      },
      body: {
        key: "FEATURE_STARS_PAYMENT_ENABLED",
        enabled: false,
        reason: "pause payment creation in admin test",
      },
    });

    expect(result.statusCode).toBe(403);
    expect(runWriteRpcMock).not.toHaveBeenCalled();
  });

  it("requires explicit confirmation for feature flag updates", async () => {
    const { default: featureFlagsHandler } =
      await import("../../api/admin/feature-flags");
    const result = await invokeApiHandler(featureFlagsHandler, {
      method: "PATCH",
      url: "/api/admin/feature-flags",
      headers: {
        "x-idempotency-key": "admin-feature-flag-test-002",
      },
      body: {
        key: "FEATURE_TON_MINT_ENABLED",
        enabled: false,
        reason: "pause mint creation in admin test",
      },
    });

    expect(result.statusCode).toBe(400);
    expect(result.body).toMatchObject({
      error: {
        code: "ADMIN_CONFIRMATION_REQUIRED",
      },
    });
    expect(runWriteRpcMock).not.toHaveBeenCalled();
  });

  it("calls the admin feature flag RPC with audit context and idempotency key", async () => {
    runWriteRpcMock.mockResolvedValue({
      key: "FEATURE_TON_MINT_ENABLED",
      enabled: false,
      previous_enabled: true,
      audit_log_id: "88888888-8888-4888-8888-888888888888",
    });

    const { default: featureFlagsHandler } =
      await import("../../api/admin/feature-flags");
    const result = await invokeApiHandler<ApiSuccessResponse>(
      featureFlagsHandler,
      {
        method: "PATCH",
        url: "/api/admin/feature-flags",
        headers: {
          "x-admin-confirm": "true",
          "x-idempotency-key": "admin-feature-flag-test-003",
          "x-forwarded-for": "127.0.0.22",
          "user-agent": "vitest-admin-feature-flags",
        },
        body: {
          key: "FEATURE_TON_MINT_ENABLED",
          enabled: false,
          description: "Allow users to request NFT minting.",
          reason: "pause mint creation in admin test",
        },
      },
    );

    expect(result.statusCode).toBe(200);
    expect(result.body).toMatchObject({
      ok: true,
      data: {
        key: "FEATURE_TON_MINT_ENABLED",
        enabled: false,
      },
    });
    expect(runWriteRpcMock).toHaveBeenCalledWith(
      expect.objectContaining({
        schema: "api",
        functionName: "admin_update_feature_flag",
        args: expect.objectContaining({
          p_admin_user_id: ADMIN_CONTEXT.adminId,
          p_key: "FEATURE_TON_MINT_ENABLED",
          p_enabled: false,
          p_description: "Allow users to request NFT minting.",
          p_reason: "pause mint creation in admin test",
          p_idempotency_key: "admin-feature-flag-test-003",
          p_request_context: expect.objectContaining({
            admin_user_id: ADMIN_CONTEXT.adminId,
            ip_hash: expect.any(String),
            user_agent_hash: expect.any(String),
          }),
        }),
      }),
    );
  });
});

function createAdminReadDbMock(rowsByTable: AdminTableRows): {
  client: unknown;
  operations: AdminQueryOperation[];
} {
  const operations: AdminQueryOperation[] = [];

  return {
    client: {
      schema: (schema: string) => ({
        from: (table: string) =>
          createAdminQueryBuilder(schema, table, rowsByTable, operations),
      }),
    },
    operations,
  };
}

function createAdminQueryBuilder(
  schema: string,
  table: string,
  rowsByTable: AdminTableRows,
  operations: AdminQueryOperation[],
) {
  const operation: AdminQueryOperation = {
    schema,
    table,
    selectedColumns: null,
    filters: [],
    range: null,
    limit: null,
  };
  operations.push(operation);

  const builder = {
    select: (columns?: string) => {
      operation.selectedColumns = parseSelectedColumns(columns);
      return builder;
    },
    eq: (column: string, value: unknown) => {
      operation.filters.push({ kind: "eq", column, value });
      return builder;
    },
    gte: (column: string, value: unknown) => {
      operation.filters.push({ kind: "gte", column, value });
      return builder;
    },
    lte: (column: string, value: unknown) => {
      operation.filters.push({ kind: "lte", column, value });
      return builder;
    },
    ilike: (column: string, value: unknown) => {
      operation.filters.push({ kind: "ilike", column, value });
      return builder;
    },
    in: (column: string, value: unknown) => {
      operation.filters.push({ kind: "in", column, value });
      return builder;
    },
    order: () => builder,
    range: (from: number, to: number) => {
      operation.range = [from, to];
      return builder;
    },
    limit: (limit: number) => {
      operation.limit = limit;
      return builder;
    },
    then: (
      resolve: (value: {
        data: Array<Record<string, unknown>>;
        error: null;
      }) => unknown,
      reject?: (reason: unknown) => unknown,
    ) =>
      Promise.resolve(resolve(resolveAdminQuery(operation, rowsByTable))).catch(
        reject,
      ),
  };

  return builder;
}

function parseSelectedColumns(columns: string | undefined): string[] | null {
  if (!columns) {
    return null;
  }

  return columns
    .split(",")
    .map((column) => column.trim())
    .filter(Boolean)
    .map((column) => column.split(":").at(0)?.trim() ?? "")
    .filter(Boolean);
}

function resolveAdminQuery(
  operation: AdminQueryOperation,
  rowsByTable: AdminTableRows,
): { data: Array<Record<string, unknown>>; error: null } {
  let rows = [...(rowsByTable[`${operation.schema}.${operation.table}`] ?? [])];

  for (const filter of operation.filters) {
    if (filter.kind === "eq") {
      rows = rows.filter((row) => row[filter.column] === filter.value);
    }

    if (filter.kind === "gte") {
      rows = rows.filter(
        (row) => String(row[filter.column] ?? "") >= String(filter.value),
      );
    }

    if (filter.kind === "lte") {
      rows = rows.filter(
        (row) => String(row[filter.column] ?? "") <= String(filter.value),
      );
    }

    const values = filter.value;

    if (filter.kind === "in" && Array.isArray(values)) {
      rows = rows.filter((row) => values.includes(row[filter.column]));
    }
  }

  if (operation.range) {
    rows = rows.slice(operation.range[0], operation.range[1] + 1);
  }

  if (operation.limit !== null) {
    rows = rows.slice(0, operation.limit);
  }

  if (operation.selectedColumns) {
    rows = rows.map((row) => {
      const selectedRow: Record<string, unknown> = {};

      for (const column of operation.selectedColumns ?? []) {
        selectedRow[column] = row[column];
      }

      return selectedRow;
    });
  }

  return {
    data: rows,
    error: null,
  };
}
