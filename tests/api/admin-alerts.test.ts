import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  ApiError,
  type ApiErrorResponse,
  type ApiSuccessResponse,
} from "../../api/_shared/handler";
import { invokeApiHandler } from "./_utils";

const { callRpcRawMock, requireAdminMock, runWriteRpcMock } = vi.hoisted(
  () => ({
    callRpcRawMock: vi.fn(),
    requireAdminMock: vi.fn(),
    runWriteRpcMock: vi.fn(),
  }),
);

vi.mock("../../packages/server/src/db/rpc.js", () => ({
  callRpcRaw: callRpcRawMock,
}));

vi.mock("../../api/_shared/requireAdmin.js", () => ({
  requireAdmin: requireAdminMock,
}));

vi.mock("../../packages/server/src/db/transactions.js", () => ({
  runWriteRpc: runWriteRpcMock,
}));

const ADMIN_CONTEXT = {
  sessionId: "session-admin-alert-test",
  userId: "11111111-1111-4111-8111-111111111111",
  telegramUserId: 7001,
  userStatus: "active",
  expiresAt: "2026-06-01T00:00:00.000Z",
  sessionTokenHash: "session-hash",
  adminId: "22222222-2222-4222-8222-222222222222",
  roleId: "33333333-3333-4333-8333-333333333333",
  roleCode: "OPS",
  isSuperAdmin: false,
  permissions: ["ops:read", "ops:write"],
};

const ALERT_ID = "44444444-4444-4444-8444-444444444444";
const STAR_ORDER_ID = "55555555-5555-4555-8555-555555555555";
const AUDIT_LOG_ID = "66666666-6666-4666-8666-666666666666";

describe("admin alert APIs", () => {
  beforeEach(() => {
    process.env.NODE_ENV = "test";
    vi.resetModules();
    callRpcRawMock.mockReset();
    requireAdminMock.mockReset();
    runWriteRpcMock.mockReset();
    requireAdminMock.mockResolvedValue(ADMIN_CONTEXT);
  });

  it("rejects non-admin alert reads before calling RPC", async () => {
    requireAdminMock.mockRejectedValueOnce(
      new ApiError(403, "FORBIDDEN", "Admin permission required"),
    );

    const { default: alertsHandler } = await import("../../api/admin/alerts");
    const result = await invokeApiHandler<ApiErrorResponse>(alertsHandler, {
      method: "GET",
      url: "/api/admin/alerts",
    });

    expect(result.statusCode).toBe(403);
    expect(callRpcRawMock).not.toHaveBeenCalled();
  });

  it("lists active alerts through the api RPC and redacts detail", async () => {
    callRpcRawMock.mockResolvedValueOnce({
      total_count: 1,
      rows: [
        {
          id: ALERT_ID,
          alert_type: "payment_paid_not_fulfilled",
          severity: "critical",
          status: "open",
          title: "Paid order not fulfilled",
          message: "order exceeded fulfillment threshold",
          source_type: "star_order",
          source_id: STAR_ORDER_ID,
          detail: {
            source_type: "star_order",
            source_id: STAR_ORDER_ID,
            token: "must-redact",
            nested: {
              service_role_key: "must-redact",
            },
          },
          occurrence_count: 1,
          first_seen_at: "2026-06-01T00:00:00.000Z",
          last_seen_at: "2026-06-01T00:05:00.000Z",
          acknowledged_by_admin_id: null,
          acknowledged_at: null,
          resolved_by_admin_id: null,
          resolved_at: null,
          ignored_by_admin_id: null,
          ignored_at: null,
          status_reason: null,
          resolution_result: null,
          created_at: "2026-06-01T00:00:00.000Z",
          updated_at: "2026-06-01T00:05:00.000Z",
        },
      ],
    });

    const { default: alertsHandler } = await import("../../api/admin/alerts");
    const result = await invokeApiHandler<
      ApiSuccessResponse<Record<string, unknown>>
    >(alertsHandler, {
      method: "GET",
      url: "/api/admin/alerts?limit=20",
      query: {
        limit: "20",
      },
    });

    expect(result.statusCode).toBe(200);
    expect(requireAdminMock).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        permissions: ["admin:read", "ops:read", "risk:read"],
        requireAll: false,
      }),
    );
    expect(callRpcRawMock).toHaveBeenCalledWith(
      "admin_list_alerts",
      expect.objectContaining({
        p_filters: {
          statuses: ["open", "acknowledged"],
        },
        p_sort: "last_seen_at",
        p_limit: 20,
        p_offset: 0,
      }),
      expect.objectContaining({
        schema: "api",
      }),
    );
    expect(result.body.data).toMatchObject({
      items: [
        {
          id: ALERT_ID,
          alertType: "payment_paid_not_fulfilled",
          source: {
            routeKey: "payment-detail",
          },
          detail: {
            token: "[REDACTED]",
            nested: {
              service_role_key: "[REDACTED]",
            },
          },
        },
      ],
      summary: {
        totalCount: 1,
        openCount: 1,
        criticalCount: 1,
      },
    });
    expect(JSON.stringify(result.body.data)).not.toContain("must-redact");
  });

  it("requires idempotency for alert status writes", async () => {
    const { default: alertsHandler } = await import("../../api/admin/alerts");
    const result = await invokeApiHandler<ApiErrorResponse>(alertsHandler, {
      method: "POST",
      url: "/api/admin/alerts",
      body: {
        alertId: ALERT_ID,
        action: "ack",
        reason: "seen by ops",
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

  it("acknowledges alerts with reason but without resolution result", async () => {
    runWriteRpcMock.mockResolvedValueOnce({
      alert_id: ALERT_ID,
      status: "acknowledged",
      previous_status: "open",
      audit_log_id: AUDIT_LOG_ID,
    });

    const { default: alertsHandler } = await import("../../api/admin/alerts");
    const result = await invokeApiHandler<ApiSuccessResponse>(alertsHandler, {
      method: "POST",
      url: "/api/admin/alerts",
      headers: {
        "x-idempotency-key": "admin-alert-ack-test-001",
        "x-forwarded-for": "127.0.0.22",
        "user-agent": "vitest-admin-alerts",
      },
      body: {
        alertId: ALERT_ID,
        action: "ack",
        reason: "seen by ops",
      },
    });

    expect(result.statusCode).toBe(200);
    expect(requireAdminMock).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        permissions: ["admin:write", "ops:write", "risk:write"],
        requireAll: false,
      }),
    );
    expect(runWriteRpcMock).toHaveBeenCalledWith(
      expect.objectContaining({
        schema: "api",
        functionName: "admin_update_alert_status",
        args: expect.objectContaining({
          p_admin_user_id: ADMIN_CONTEXT.adminId,
          p_alert_id: ALERT_ID,
          p_status: "acknowledged",
          p_reason: "seen by ops",
          p_idempotency_key: "admin-alert-ack-test-001",
          p_request_context: expect.objectContaining({
            admin_user_id: ADMIN_CONTEXT.adminId,
            ip_hash: expect.any(String),
            user_agent_hash: expect.any(String),
          }),
          p_resolution_result: undefined,
        }),
      }),
    );
  });

  it("requires resolution result before calling resolve RPC", async () => {
    const { default: alertsHandler } = await import("../../api/admin/alerts");
    const result = await invokeApiHandler<ApiErrorResponse>(alertsHandler, {
      method: "PATCH",
      url: "/api/admin/alerts",
      headers: {
        "x-idempotency-key": "admin-alert-resolve-missing-result",
      },
      body: {
        alertId: ALERT_ID,
        action: "resolve",
        reason: "fixed",
      },
    });

    expect(result.statusCode).toBe(400);
    expect(result.body).toMatchObject({
      error: {
        code: "ADMIN_ALERT_RESOLUTION_RESULT_REQUIRED",
      },
    });
    expect(runWriteRpcMock).not.toHaveBeenCalled();
  });

  it("resolves alerts with processing result", async () => {
    runWriteRpcMock.mockResolvedValueOnce({
      alert_id: ALERT_ID,
      status: "resolved",
      previous_status: "acknowledged",
      audit_log_id: AUDIT_LOG_ID,
    });

    const { default: alertsHandler } = await import("../../api/admin/alerts");
    const result = await invokeApiHandler<ApiSuccessResponse>(alertsHandler, {
      method: "PATCH",
      url: "/api/admin/alerts",
      headers: {
        "x-idempotency-key": "admin-alert-resolve-test-001",
      },
      body: {
        alertId: ALERT_ID,
        action: "resolve",
        reason: "queue drained",
        resolutionResult: "order fulfilled after retry",
      },
    });

    expect(result.statusCode).toBe(200);
    expect(runWriteRpcMock).toHaveBeenCalledWith(
      expect.objectContaining({
        functionName: "admin_update_alert_status",
        args: expect.objectContaining({
          p_status: "resolved",
          p_reason: "queue drained",
          p_resolution_result: "order fulfilled after retry",
        }),
      }),
    );
  });

  it("ignores alerts through the same audited lifecycle RPC", async () => {
    runWriteRpcMock.mockResolvedValueOnce({
      alert_id: ALERT_ID,
      status: "ignored",
      previous_status: "open",
      audit_log_id: AUDIT_LOG_ID,
    });

    const { default: alertsHandler } = await import("../../api/admin/alerts");
    const result = await invokeApiHandler<ApiSuccessResponse>(alertsHandler, {
      method: "POST",
      url: "/api/admin/alerts",
      headers: {
        "x-idempotency-key": "admin-alert-ignore-test-001",
      },
      body: {
        alertId: ALERT_ID,
        action: "ignore",
        reason: "known maintenance window",
      },
    });

    expect(result.statusCode).toBe(200);
    expect(runWriteRpcMock).toHaveBeenCalledWith(
      expect.objectContaining({
        functionName: "admin_update_alert_status",
        args: expect.objectContaining({
          p_status: "ignored",
          p_reason: "known maintenance window",
        }),
      }),
    );
  });
});
