import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ApiError, type ApiSuccessResponse } from "../../api/_shared/handler";
import { invokeApiHandler } from "./_utils";

const { requireAdminMock, runWriteRpcMock } = vi.hoisted(() => ({
  requireAdminMock: vi.fn(),
  runWriteRpcMock: vi.fn(),
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
const STAR_ORDER_ID = "66666666-6666-4666-8666-666666666666";

describe("admin ops APIs", () => {
  beforeEach(() => {
    process.env.NODE_ENV = "test";
    requireAdminMock.mockReset();
    runWriteRpcMock.mockReset();
    requireAdminMock.mockResolvedValue(ADMIN_CONTEXT);
  });

  afterEach(() => {
    vi.restoreAllMocks();
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

    const { default: retryFulfillmentHandler } = await import(
      "../../api/admin/retry-fulfillment"
    );
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
    const { default: retryFulfillmentHandler } = await import(
      "../../api/admin/retry-fulfillment"
    );
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
});
