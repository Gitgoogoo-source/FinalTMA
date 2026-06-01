import { beforeEach, describe, expect, it, vi } from "vitest";

import {
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
  sessionId: "session-admin-market-rebuild-stats-test",
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

const AUDIT_LOG_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const RISK_EVENT_ID = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

describe("admin market stats rebuild API", () => {
  beforeEach(() => {
    process.env.NODE_ENV = "test";
    vi.resetModules();
    requireAdminMock.mockReset();
    runWriteRpcMock.mockReset();
    requireAdminMock.mockResolvedValue(ADMIN_CONTEXT);
  });

  it("calls the audited manual rebuild RPC with confirmation and idempotency", async () => {
    runWriteRpcMock.mockResolvedValueOnce({
      status: "success",
      snapshot_at: "2026-06-01T12:00:00.000Z",
      price_snapshot_count: 3,
      depth_snapshot_count: 5,
      price_health_update_count: 2,
      start_app_event_id: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
      end_app_event_id: "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
      audit_log_id: AUDIT_LOG_ID,
      risk_event_id: RISK_EVENT_ID,
      server_time: "2026-06-01T12:00:01.000Z",
    });

    const { default: handler } =
      await import("../../api/admin/market/rebuild-stats");
    const result = await invokeApiHandler<ApiSuccessResponse>(handler, {
      method: "POST",
      url: "/api/admin/market/rebuild-stats",
      headers: {
        "x-admin-confirm": "true",
        "x-idempotency-key": "admin-market-stats-rebuild-001",
        "x-request-id": "req-admin-market-stats-rebuild",
      },
      body: {
        reason: "manual rebuild after fee rule change",
        confirm: true,
      },
    });

    expect(result.statusCode).toBe(200);
    expect(requireAdminMock).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        permissions: ["market:write", "admin:write"],
        requireAll: false,
      }),
    );
    expect(runWriteRpcMock).toHaveBeenCalledWith(
      expect.objectContaining({
        schema: "api",
        functionName: "admin_rebuild_market_stats",
        args: expect.objectContaining({
          p_admin_user_id: ADMIN_CONTEXT.adminId,
          p_reason: "manual rebuild after fee rule change",
          p_idempotency_key: "admin-market-stats-rebuild-001",
          p_request_context: expect.objectContaining({
            request_id: "req-admin-market-stats-rebuild",
            admin_user_id: ADMIN_CONTEXT.adminId,
            session_id: ADMIN_CONTEXT.sessionId,
          }),
        }),
      }),
    );
    expect(result.body).toMatchObject({
      data: {
        status: "success",
        audit_log_id: AUDIT_LOG_ID,
        risk_event_id: RISK_EVENT_ID,
        serverTime: "2026-06-01T12:00:01.000Z",
      },
    });
  });

  it("requires confirmation, reason, idempotency and risk event result", async () => {
    const { default: handler } =
      await import("../../api/admin/market/rebuild-stats");

    const missingConfirm = await invokeApiHandler<ApiErrorResponse>(handler, {
      method: "POST",
      url: "/api/admin/market/rebuild-stats",
      headers: {
        "x-idempotency-key": "admin-market-stats-rebuild-002",
      },
      body: {
        reason: "missing confirm",
        confirm: true,
      },
    });
    expect(missingConfirm.statusCode).toBe(400);
    expect(missingConfirm.body.error.code).toBe("ADMIN_CONFIRMATION_REQUIRED");

    const missingReason = await invokeApiHandler<ApiErrorResponse>(handler, {
      method: "POST",
      url: "/api/admin/market/rebuild-stats",
      headers: {
        "x-admin-confirm": "true",
        "x-idempotency-key": "admin-market-stats-rebuild-003",
      },
      body: {},
    });
    expect(missingReason.statusCode).toBe(400);
    expect(missingReason.body.error.code).toBe("VALIDATION_FAILED");

    const missingIdempotency = await invokeApiHandler<ApiErrorResponse>(
      handler,
      {
        method: "POST",
        url: "/api/admin/market/rebuild-stats",
        headers: {
          "x-admin-confirm": "true",
        },
        body: {
          reason: "missing idempotency",
        },
      },
    );
    expect(missingIdempotency.statusCode).toBe(400);
    expect(missingIdempotency.body.error.code).toBe("IDEMPOTENCY_KEY_REQUIRED");

    runWriteRpcMock.mockResolvedValueOnce({
      audit_log_id: AUDIT_LOG_ID,
      status: "success",
    });
    const missingRisk = await invokeApiHandler<ApiErrorResponse>(handler, {
      method: "POST",
      url: "/api/admin/market/rebuild-stats",
      headers: {
        "x-admin-confirm": "true",
        "x-idempotency-key": "admin-market-stats-rebuild-004",
      },
      body: {
        reason: "risk id missing",
      },
    });
    expect(missingRisk.statusCode).toBe(500);
    expect(missingRisk.body.error.code).toBe("ADMIN_RISK_EVENT_REQUIRED");
  });
});
