import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { type ApiSuccessResponse } from "../../api/_shared/handler";
import { invokeApiHandler } from "./_utils";

const { requireAdminMock, runReadRpcMock, writeAdminAuditLogMock } = vi.hoisted(
  () => ({
    requireAdminMock: vi.fn(),
    runReadRpcMock: vi.fn(),
    writeAdminAuditLogMock: vi.fn(),
  }),
);

vi.mock("../../api/_shared/requireAdmin.js", () => ({
  requireAdmin: requireAdminMock,
}));

vi.mock("../../packages/server/src/db/transactions.js", () => ({
  runReadRpc: runReadRpcMock,
}));

vi.mock("../../packages/server/src/security/auditLog.js", () => ({
  writeAdminAuditLog: writeAdminAuditLogMock,
}));

const ADMIN_CONTEXT = {
  sessionId: "session-admin-reports-test",
  userId: "11111111-1111-4111-8111-111111111111",
  telegramUserId: 7001,
  userStatus: "active",
  expiresAt: "2026-06-01T00:00:00.000Z",
  sessionTokenHash: "session-hash",
  adminId: "22222222-2222-4222-8222-222222222222",
  roleId: "33333333-3333-4333-8333-333333333333",
  roleCode: "OPS",
  isSuperAdmin: false,
  permissions: ["reports:read", "reports:export"],
};

describe("admin reports APIs", () => {
  beforeEach(() => {
    process.env.NODE_ENV = "test";
    vi.resetModules();
    requireAdminMock.mockReset();
    runReadRpcMock.mockReset();
    writeAdminAuditLogMock.mockReset();
    requireAdminMock.mockResolvedValue(ADMIN_CONTEXT);
    writeAdminAuditLogMock.mockResolvedValue({
      auditLogId: "audit-report-export-1",
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("reads daily report snapshots through the reports RPC facade", async () => {
    runReadRpcMock.mockResolvedValueOnce({
      items: [
        {
          id: "report-1",
          report_date: "2026-05-31",
          campaign_id: null,
          box_id: null,
          cohort_key: "all",
          scope_key: "box=all|campaign=all|cohort=all",
          metrics: {
            starsGmv: 100,
          },
        },
      ],
      referralReports: [],
      nextCursor: null,
      serverTime: "2026-06-01T00:00:00.000Z",
    });

    const { default: handler } = await import("../../api/admin/reports/daily");
    const result = await invokeApiHandler<ApiSuccessResponse>(handler, {
      method: "GET",
      url: "/api/admin/reports/daily?from=2026-05-31&to=2026-05-31",
      query: {
        from: "2026-05-31",
        to: "2026-05-31",
      },
      headers: {
        "user-agent": "ReportsTest/1.0",
      },
    });

    expect(result.statusCode).toBe(200);
    expect(requireAdminMock).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        permissions: ["reports:read", "admin:read"],
        requireAll: false,
      }),
    );
    expect(runReadRpcMock).toHaveBeenCalledWith(
      expect.objectContaining({
        schema: "api",
        functionName: "admin_list_daily_reports",
        args: expect.objectContaining({
          p_admin_user_id: ADMIN_CONTEXT.adminId,
          p_from: "2026-05-31",
          p_to: "2026-05-31",
          p_filters: {},
        }),
      }),
    );
    expect(JSON.stringify(result.body)).not.toContain("raw_update");
    expect(JSON.stringify(result.body)).not.toContain(
      "telegram_payment_charge_id",
    );
  });

  it("rejects ranges larger than 90 days before database access", async () => {
    const { default: handler } = await import("../../api/admin/reports/gacha");
    const result = await invokeApiHandler(handler, {
      method: "GET",
      url: "/api/admin/reports/gacha?from=2026-01-01&to=2026-05-01",
      query: {
        from: "2026-01-01",
        to: "2026-05-01",
      },
    });

    expect(result.statusCode).toBe(400);
    expect(runReadRpcMock).not.toHaveBeenCalled();
  });

  it("exports CSV with export permission, audit log, and sanitized metrics", async () => {
    runReadRpcMock.mockResolvedValueOnce({
      items: [
        {
          id: "report-2",
          report_date: "2026-05-31",
          currency_code: "KCOIN",
          source_type: "market_buy",
          cohort_key: "all",
          scope_key: "cohort=all|currency=KCOIN|source=market_buy",
          metrics: {
            issuedAmount: 0,
            secretToken: "must-not-export",
          },
        },
      ],
      nextCursor: null,
      serverTime: "2026-06-01T00:00:00.000Z",
    });

    const { default: handler } = await import("../../api/admin/reports/export");
    const result = await invokeApiHandler<string>(handler, {
      method: "POST",
      url: "/api/admin/reports/export",
      body: {
        reportType: "economy",
        filters: {
          from: "2026-05-31",
          to: "2026-05-31",
          currencyCode: "KCOIN",
        },
        reason: "monthly review",
      },
    });

    expect(result.statusCode).toBe(200);
    expect(result.headers["content-type"]).toContain("text/csv");
    expect(result.headers["content-disposition"]).toContain(
      "reports-economy-2026-05-31-2026-05-31.csv",
    );
    expect(requireAdminMock).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        permissions: ["reports:export", "admin:write"],
        requireAll: false,
      }),
    );
    expect(writeAdminAuditLogMock).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "reports.export",
        targetSchema: "ops",
        targetTable: "daily_economy_reports",
      }),
    );
    expect(result.body).toContain("KCOIN");
    expect(result.body).not.toContain("must-not-export");
    expect(result.body).not.toContain("secretToken");
  });

  it("audits daily exports against the business report table", async () => {
    runReadRpcMock.mockResolvedValueOnce({
      items: [
        {
          id: "report-daily-1",
          report_date: "2026-05-31",
          campaign_id: null,
          box_id: null,
          cohort_key: "all",
          scope_key: "box=all|campaign=all|cohort=all",
          metrics: {
            starsGmv: 50,
            newUserCount: 1,
          },
        },
      ],
      referralReports: [],
      nextCursor: null,
      serverTime: "2026-06-01T00:00:00.000Z",
    });

    const { default: handler } = await import("../../api/admin/reports/export");
    const result = await invokeApiHandler<string>(handler, {
      method: "POST",
      url: "/api/admin/reports/export",
      body: {
        reportType: "daily",
        filters: {
          from: "2026-05-31",
          to: "2026-05-31",
        },
        reason: "daily review",
      },
    });

    expect(result.statusCode).toBe(200);
    expect(writeAdminAuditLogMock).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "reports.export",
        targetSchema: "ops",
        targetTable: "daily_business_reports",
      }),
    );
  });
});
