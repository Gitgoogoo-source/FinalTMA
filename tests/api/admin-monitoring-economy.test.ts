import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { type ApiSuccessResponse } from "../../api/_shared/handler";
import { invokeApiHandler } from "./_utils";

const {
  getSupabaseAdminClientMock,
  requireAdminMock,
  runReadRpcMock,
  runWriteRpcMock,
} = vi.hoisted(() => ({
  getSupabaseAdminClientMock: vi.fn(),
  requireAdminMock: vi.fn(),
  runReadRpcMock: vi.fn(),
  runWriteRpcMock: vi.fn(),
}));

vi.mock("../../packages/server/src/db/supabaseAdmin.js", () => ({
  getSupabaseAdminClient: getSupabaseAdminClientMock,
}));

vi.mock("../../api/_shared/requireAdmin.js", () => ({
  requireAdmin: requireAdminMock,
}));

vi.mock("../../packages/server/src/db/transactions.js", () => ({
  runReadRpc: runReadRpcMock,
  runWriteRpc: runWriteRpcMock,
}));

const ADMIN_CONTEXT = {
  sessionId: "session-admin-monitoring-economy-test",
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

const AUDIT_LOG_ID = "44444444-4444-4444-8444-444444444444";

type AdminQueryOperation = {
  schema: string;
  table: string;
  selectedColumns: string[] | null;
  filters: Array<{
    kind: "eq";
    column: string;
    value: unknown;
  }>;
};

type AdminTableRows = Record<string, Array<Record<string, unknown>>>;

describe("admin economy monitoring APIs", () => {
  beforeEach(() => {
    process.env.NODE_ENV = "test";
    vi.resetModules();
    getSupabaseAdminClientMock.mockReset();
    requireAdminMock.mockReset();
    runReadRpcMock.mockReset();
    runWriteRpcMock.mockReset();
    requireAdminMock.mockResolvedValue(ADMIN_CONTEXT);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("uses GET, admin/ops read permission and the economy monitoring read RPC", async () => {
    runReadRpcMock.mockResolvedValueOnce({
      serverTime: "2026-06-01T00:00:00.000Z",
      window: {
        hours: 168,
        startedAt: "2026-05-25T00:00:00.000Z",
        endedAt: "2026-06-01T00:00:00.000Z",
      },
      metrics: {
        currencies: {
          KCOIN: {
            issuedAmount: "1000",
            recoveredAmount: "250",
            netIssuedAmount: "750",
            byEntryType: [
              {
                entryType: "credit",
                direction: "issued",
                amount: "1000",
                entryCount: 1,
              },
            ],
          },
          FGEMS: {
            issuedAmount: "50",
            recoveredAmount: "0",
            netIssuedAmount: "50",
            byEntryType: [],
          },
        },
      },
      sources: {
        ledger: {
          schema: "economy",
          table: "currency_ledger",
          aggregation: "currency_code + entry_type",
        },
      },
    });

    const { default: economyHandler } =
      await import("../../api/admin/monitoring/economy");
    const result = await invokeApiHandler<ApiSuccessResponse>(economyHandler, {
      method: "GET",
      url: "/api/admin/monitoring/economy?windowHours=999",
      query: {
        windowHours: "999",
      },
    });

    expect(result.statusCode).toBe(200);
    expect(requireAdminMock).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        permissions: ["admin:read", "ops:read"],
        requireAll: false,
      }),
    );
    expect(runReadRpcMock).toHaveBeenCalledWith(
      expect.objectContaining({
        schema: "api",
        functionName: "admin_get_economy_monitoring",
        args: expect.objectContaining({
          p_admin_user_id: ADMIN_CONTEXT.adminId,
          p_window_hours: 168,
        }),
      }),
    );
    expect(result.body).toMatchObject({
      ok: true,
      data: {
        serverTime: "2026-06-01T00:00:00.000Z",
        metrics: {
          currencies: {
            KCOIN: {
              issuedAmount: "1000",
            },
          },
        },
        sources: {
          ledger: {
            table: "currency_ledger",
          },
        },
      },
    });
    expect(JSON.stringify(result.body)).not.toContain("user_id");
    expect(JSON.stringify(result.body)).not.toContain("telegram_user_id");
  });

  it("rejects non-GET requests to the economy monitoring interface", async () => {
    const { default: economyHandler } =
      await import("../../api/admin/monitoring/economy");
    const result = await invokeApiHandler(economyHandler, {
      method: "POST",
      url: "/api/admin/monitoring/economy",
    });

    expect(result.statusCode).toBe(405);
    expect(runReadRpcMock).not.toHaveBeenCalled();
  });

  it("reads monitoring thresholds from ops.system_settings", async () => {
    runReadRpcMock.mockResolvedValueOnce({
      key: "monitoring.thresholds",
      source: "system_settings",
      updatedAt: "2026-06-01T01:00:00.000Z",
      thresholds: {
        paymentFailureRate: {
          warning: 0.05,
          critical: 0.1,
        },
        kcoinNetIssuance: {
          warningAmount: 500000,
          windowHours: 6,
        },
      },
    });

    const { default: thresholdsHandler } =
      await import("../../api/admin/monitoring-thresholds");
    const result = await invokeApiHandler<ApiSuccessResponse>(
      thresholdsHandler,
      {
        method: "GET",
        url: "/api/admin/monitoring-thresholds",
      },
    );

    expect(result.statusCode).toBe(200);
    expect(requireAdminMock).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        permissions: ["admin:read", "ops:read"],
        requireAll: false,
      }),
    );
    expect(result.body).toMatchObject({
      ok: true,
      data: {
        key: "monitoring.thresholds",
        source: "system_settings",
        thresholds: {
          paymentFailureRate: {
            warning: 0.05,
            critical: 0.1,
          },
          kcoinNetIssuance: {
            warningAmount: 500000,
            windowHours: 6,
          },
        },
      },
    });
    expect(runReadRpcMock).toHaveBeenCalledWith(
      expect.objectContaining({
        schema: "api",
        functionName: "admin_get_monitoring_thresholds",
        args: expect.objectContaining({
          p_admin_user_id: ADMIN_CONTEXT.adminId,
        }),
      }),
    );
  });

  it("maps threshold updates to the audited admin RPC", async () => {
    runReadRpcMock.mockResolvedValueOnce({
      key: "monitoring.thresholds",
      source: "system_settings",
      updatedAt: "2026-06-01T01:00:00.000Z",
      thresholds: {
        paymentFailureRate: {
          warning: 0.05,
          critical: 0.1,
        },
      },
    });
    runWriteRpcMock.mockResolvedValueOnce({
      audit_log_id: AUDIT_LOG_ID,
      thresholds: {
        paymentFailureRate: {
          warning: 0.05,
          critical: 0.1,
        },
        kcoinNetIssuance: {
          warningAmount: 250000,
          windowHours: 12,
        },
      },
      updated_at: "2026-06-01T01:10:00.000Z",
      server_time: "2026-06-01T01:10:00.000Z",
    });

    const { default: thresholdsHandler } =
      await import("../../api/admin/monitoring-thresholds");
    const result = await invokeApiHandler<ApiSuccessResponse>(
      thresholdsHandler,
      {
        method: "PATCH",
        url: "/api/admin/monitoring-thresholds",
        headers: {
          "x-admin-confirm": "true",
          "x-idempotency-key": "admin-monitoring-thresholds-test-001",
        },
        body: {
          thresholds: {
            kcoinNetIssuance: {
              warningAmount: 250000,
              windowHours: 12,
            },
          },
          reason: "tune economy monitoring threshold",
          confirm: true,
        },
      },
    );

    expect(result.statusCode).toBe(200);
    expect(requireAdminMock).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        permissions: ["admin:write", "ops:write"],
        requireAll: false,
      }),
    );
    expect(runWriteRpcMock).toHaveBeenCalledWith(
      expect.objectContaining({
        schema: "api",
        functionName: "admin_update_monitoring_thresholds",
        args: expect.objectContaining({
          p_admin_user_id: ADMIN_CONTEXT.adminId,
          p_reason: "tune economy monitoring threshold",
          p_idempotency_key: "admin-monitoring-thresholds-test-001",
          p_thresholds: expect.objectContaining({
            kcoinNetIssuance: {
              warningAmount: 250000,
              windowHours: 12,
            },
          }),
        }),
      }),
    );
    expect(result.body).toMatchObject({
      ok: true,
      data: {
        audit_log_id: AUDIT_LOG_ID,
        key: "monitoring.thresholds",
        source: "system_settings",
      },
    });
  });

  it("rejects invalid threshold updates before calling RPC", async () => {
    runReadRpcMock.mockResolvedValueOnce({
      key: "monitoring.thresholds",
      source: "defaults",
      updatedAt: null,
      thresholds: {
        paymentFailureRate: {
          warning: 0.05,
          critical: 0.1,
        },
      },
    });

    const { default: thresholdsHandler } =
      await import("../../api/admin/monitoring-thresholds");
    const result = await invokeApiHandler(thresholdsHandler, {
      method: "PATCH",
      url: "/api/admin/monitoring-thresholds",
      headers: {
        "x-admin-confirm": "true",
        "x-idempotency-key": "admin-monitoring-thresholds-test-002",
      },
      body: {
        thresholds: {
          paymentFailureRate: {
            warning: 0.2,
            critical: 0.1,
          },
        },
        reason: "reject bad threshold",
        confirm: true,
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
    .filter(Boolean);
}

function resolveAdminQuery(
  operation: AdminQueryOperation,
  rowsByTable: AdminTableRows,
): { data: Array<Record<string, unknown>>; error: null } {
  let rows = [...(rowsByTable[`${operation.schema}.${operation.table}`] ?? [])];

  for (const filter of operation.filters) {
    rows = rows.filter((row) => row[filter.column] === filter.value);
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
