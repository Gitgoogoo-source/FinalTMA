import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  ApiError,
  type ApiErrorResponse,
  type ApiSuccessResponse,
} from "../../api/_shared/handler";
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
  sessionId: "session-admin-market-force-cancel-test",
  userId: "11111111-1111-4111-8111-111111111111",
  telegramUserId: 7001,
  userStatus: "active",
  expiresAt: "2026-06-01T00:00:00.000Z",
  sessionTokenHash: "session-hash",
  adminId: "22222222-2222-4222-8222-222222222222",
  roleId: "33333333-3333-4333-8333-333333333333",
  roleCode: "OPS",
  isSuperAdmin: false,
  permissions: ["market:write"],
};

const LISTING_ID = "44444444-4444-4444-8444-444444444444";
const AUDIT_LOG_ID = "55555555-5555-4555-8555-555555555555";
const RISK_EVENT_ID = "66666666-6666-4666-8666-666666666666";

describe("admin market force-cancel listing API", () => {
  beforeEach(() => {
    process.env.NODE_ENV = "test";
    vi.resetModules();
    requireAdminMock.mockReset();
    runWriteRpcMock.mockReset();
    requireAdminMock.mockResolvedValue(ADMIN_CONTEXT);
  });

  it("rejects non-POST requests before admin or database access", async () => {
    const { default: handler } =
      await import("../../api/admin/market/force-cancel-listing");
    const result = await invokeApiHandler(handler, {
      method: "GET",
      url: "/api/admin/market/force-cancel-listing",
    });

    expect(result.statusCode).toBe(405);
    expect(requireAdminMock).not.toHaveBeenCalled();
    expect(runWriteRpcMock).not.toHaveBeenCalled();
  });

  it("requires market write or admin write permission", async () => {
    requireAdminMock.mockRejectedValueOnce(
      new ApiError(403, "FORBIDDEN", "Missing admin permission"),
    );

    const { default: handler } =
      await import("../../api/admin/market/force-cancel-listing");
    const result = await invokeApiHandler<ApiErrorResponse>(handler, {
      method: "POST",
      url: "/api/admin/market/force-cancel-listing",
      headers: {
        "x-admin-confirm": "true",
        "x-idempotency-key": "admin-force-cancel-market-listing-test-001",
      },
      body: {
        listingId: LISTING_ID,
        reason: "support cannot force cancel listing",
      },
    });

    expect(result.statusCode).toBe(403);
    expect(runWriteRpcMock).not.toHaveBeenCalled();
    expect(requireAdminMock).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        permissions: ["market:write", "admin:write"],
        requireAll: false,
      }),
    );
  });

  it("rejects body-only confirmation for force-cancel writes", async () => {
    const { default: handler } =
      await import("../../api/admin/market/force-cancel-listing");
    const result = await invokeApiHandler<ApiErrorResponse>(handler, {
      method: "POST",
      url: "/api/admin/market/force-cancel-listing",
      headers: {
        "x-idempotency-key": "admin-force-cancel-market-listing-test-002",
      },
      body: {
        listingId: LISTING_ID,
        reason: "cancel abnormal listing from admin market ops",
        confirm: true,
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

  it("rejects body-only idempotency keys for force-cancel writes", async () => {
    const { default: handler } =
      await import("../../api/admin/market/force-cancel-listing");
    const result = await invokeApiHandler<ApiErrorResponse>(handler, {
      method: "POST",
      url: "/api/admin/market/force-cancel-listing",
      headers: {
        "x-admin-confirm": "true",
      },
      body: {
        listingId: LISTING_ID,
        reason: "cancel abnormal listing from admin market ops",
        idempotencyKey: "admin-force-cancel-market-listing-body-only",
      },
    });

    expect(result.statusCode).toBe(400);
    expect(result.body).toMatchObject({
      error: {
        code: "IDEMPOTENCY_KEY_REQUIRED",
      },
    });
    expect(runWriteRpcMock).not.toHaveBeenCalled();
  });

  it("validates listing id and reason before calling the dedicated RPC", async () => {
    const { default: handler } =
      await import("../../api/admin/market/force-cancel-listing");

    const invalidListingResult = await invokeApiHandler<ApiErrorResponse>(
      handler,
      {
        method: "POST",
        url: "/api/admin/market/force-cancel-listing",
        headers: {
          "x-admin-confirm": "true",
          "x-idempotency-key": "admin-force-cancel-market-listing-test-003",
        },
        body: {
          listingId: "not-a-uuid",
          reason: "cancel abnormal listing from admin market ops",
        },
      },
    );

    expect(invalidListingResult.statusCode).toBe(400);
    expect(invalidListingResult.body).toMatchObject({
      error: {
        code: "VALIDATION_FAILED",
      },
    });
    expect(runWriteRpcMock).not.toHaveBeenCalled();

    const missingReasonResult = await invokeApiHandler<ApiErrorResponse>(
      handler,
      {
        method: "POST",
        url: "/api/admin/market/force-cancel-listing",
        headers: {
          "x-admin-confirm": "true",
          "x-idempotency-key": "admin-force-cancel-market-listing-test-004",
        },
        body: {
          listingId: LISTING_ID,
        },
      },
    );

    expect(missingReasonResult.statusCode).toBe(400);
    expect(missingReasonResult.body).toMatchObject({
      error: {
        code: "VALIDATION_FAILED",
      },
    });
    expect(runWriteRpcMock).not.toHaveBeenCalled();
  });

  it("calls only the dedicated audited force-cancel RPC with risk context", async () => {
    runWriteRpcMock.mockResolvedValueOnce({
      listing_id: LISTING_ID,
      previous_status: "active",
      status: "cancelled",
      audit_log_id: AUDIT_LOG_ID,
      risk_event_id: RISK_EVENT_ID,
      idempotent: false,
      server_time: "2026-06-01T06:00:00.000Z",
    });

    const { default: handler } =
      await import("../../api/admin/market/force-cancel-listing");
    const result = await invokeApiHandler<ApiSuccessResponse>(handler, {
      method: "POST",
      url: "/api/admin/market/force-cancel-listing",
      headers: {
        "x-admin-confirm": "true",
        "x-idempotency-key": "admin-force-cancel-market-listing-test-005",
        "x-forwarded-for": "127.0.0.40",
        "user-agent": "vitest-admin-market-force-cancel",
      },
      body: {
        listingId: LISTING_ID,
        reason: "abnormal under-floor listing requires admin force cancel",
        confirm: true,
      },
    });

    expect(result.statusCode).toBe(200);
    expect(result.body).toMatchObject({
      ok: true,
      data: {
        listing_id: LISTING_ID,
        previous_status: "active",
        status: "cancelled",
        audit_log_id: AUDIT_LOG_ID,
        risk_event_id: RISK_EVENT_ID,
        serverTime: "2026-06-01T06:00:00.000Z",
      },
    });
    expect(requireAdminMock).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        permissions: ["market:write", "admin:write"],
        requireAll: false,
      }),
    );
    expect(runWriteRpcMock).toHaveBeenCalledTimes(1);
    expect(runWriteRpcMock).toHaveBeenCalledWith(
      expect.objectContaining({
        schema: "api",
        functionName: "admin_force_cancel_market_listing",
        args: expect.objectContaining({
          p_admin_user_id: ADMIN_CONTEXT.adminId,
          p_listing_id: LISTING_ID,
          p_reason: "abnormal under-floor listing requires admin force cancel",
          p_idempotency_key: "admin-force-cancel-market-listing-test-005",
          p_request_context: expect.objectContaining({
            admin_user_id: ADMIN_CONTEXT.adminId,
            request_id: expect.any(String),
            ip_hash: expect.any(String),
            user_agent_hash: expect.any(String),
          }),
        }),
      }),
    );
  });

  it("rejects RPC results that do not prove an audit log was written", async () => {
    runWriteRpcMock.mockResolvedValueOnce({
      listing_id: LISTING_ID,
      status: "cancelled",
      risk_event_id: RISK_EVENT_ID,
    });

    const { default: handler } =
      await import("../../api/admin/market/force-cancel-listing");
    const result = await invokeApiHandler<ApiErrorResponse>(handler, {
      method: "POST",
      url: "/api/admin/market/force-cancel-listing",
      headers: {
        "x-admin-confirm": "true",
        "x-idempotency-key": "admin-force-cancel-market-listing-test-006",
      },
      body: {
        listingId: LISTING_ID,
        reason: "verify audit id requirement for force cancel",
      },
    });

    expect(result.statusCode).toBe(500);
    expect(result.body).toMatchObject({
      error: {
        code: "ADMIN_AUDIT_LOG_REQUIRED",
      },
    });
  });

  it("rejects RPC results that do not prove a risk event was written", async () => {
    runWriteRpcMock.mockResolvedValueOnce({
      listing_id: LISTING_ID,
      status: "cancelled",
      audit_log_id: AUDIT_LOG_ID,
    });

    const { default: handler } =
      await import("../../api/admin/market/force-cancel-listing");
    const result = await invokeApiHandler<ApiErrorResponse>(handler, {
      method: "POST",
      url: "/api/admin/market/force-cancel-listing",
      headers: {
        "x-admin-confirm": "true",
        "x-idempotency-key": "admin-force-cancel-market-listing-test-007",
      },
      body: {
        listingId: LISTING_ID,
        reason: "verify risk event id requirement for force cancel",
      },
    });

    expect(result.statusCode).toBe(500);
    expect(result.body).toMatchObject({
      error: {
        code: "ADMIN_RISK_EVENT_REQUIRED",
      },
    });
  });
});
