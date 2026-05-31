import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ApiError, type ApiSuccessResponse } from "../../api/_shared/handler";
import { invokeApiHandler } from "./_utils";

const {
  getSupabaseAdminClientMock,
  requireAdminMock,
  runPhase5ReconciliationMock,
  runWriteRpcMock,
  withIdempotencyMock,
} =
  vi.hoisted(() => ({
    getSupabaseAdminClientMock: vi.fn(),
    requireAdminMock: vi.fn(),
    runPhase5ReconciliationMock: vi.fn(),
    runWriteRpcMock: vi.fn(),
    withIdempotencyMock: vi.fn(),
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

vi.mock("../../packages/server/src/jobs/ledgerReconcileJob.js", () => ({
  runPhase5Reconciliation: runPhase5ReconciliationMock,
}));

vi.mock("../../packages/server/src/db/idempotency.js", () => ({
  IdempotencyError: class IdempotencyError extends Error {
    readonly status: number;
    readonly code: string;
    readonly details: unknown;

    constructor(status: number, code: string, message: string, details?: unknown) {
      super(message);
      this.status = status;
      this.code = code;
      this.details = details;
    }
  },
  withIdempotency: withIdempotencyMock,
}));

const ADMIN_CONTEXT = {
  sessionId: "session-admin-reconciliation-test",
  userId: "11111111-1111-4111-8111-111111111111",
  telegramUserId: 7001,
  userStatus: "active",
  expiresAt: "2026-05-31T00:00:00.000Z",
  sessionTokenHash: "session-hash",
  adminId: "22222222-2222-4222-8222-222222222222",
  roleId: "33333333-3333-4333-8333-333333333333",
  roleCode: "OPS",
  isSuperAdmin: false,
  permissions: ["ops:read", "ops:write"],
};
const RISK_ADMIN_CONTEXT = {
  ...ADMIN_CONTEXT,
  roleCode: "RISK",
  permissions: ["risk:write"],
};

const RUN_ID = "44444444-4444-4444-8444-444444444444";
const RISK_EVENT_ID = "55555555-5555-4555-8555-555555555555";
const ORDINARY_RISK_EVENT_ID = "66666666-6666-4666-8666-666666666666";
const STAR_ORDER_ID = "77777777-7777-4777-8777-777777777777";
const AUDIT_LOG_ID = "88888888-8888-4888-8888-888888888888";

type AdminQueryOperation = {
  schema: string;
  table: string;
  selectedColumns: string[] | null;
  filters: Array<{
    kind: "eq" | "ilike" | "not";
    column: string;
    value: unknown;
    operator?: string;
  }>;
  range: [number, number] | null;
};

type AdminTableRows = Record<string, Array<Record<string, unknown>>>;

describe("admin reconciliation APIs", () => {
  beforeEach(() => {
    process.env.NODE_ENV = "test";
    vi.resetModules();
    getSupabaseAdminClientMock.mockReset();
    requireAdminMock.mockReset();
    runPhase5ReconciliationMock.mockReset();
    runWriteRpcMock.mockReset();
    withIdempotencyMock.mockReset();
    requireAdminMock.mockResolvedValue(ADMIN_CONTEXT);
    withIdempotencyMock.mockImplementation(
      async (input: { handler: () => Promise<Record<string, unknown>> }) => ({
        data: await input.handler(),
        replayed: false,
      }),
    );
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("lists only reconciliation risk events by default", async () => {
    const db = createAdminReadDbMock({
      "ops.risk_events": [
        {
          id: RISK_EVENT_ID,
          user_id: ADMIN_CONTEXT.userId,
          event_type: "PAYMENT_FULFILLMENT_MISSING",
          severity: "high",
          status: "open",
          source_type: "star_order",
          source_id: STAR_ORDER_ID,
          score_delta: 25,
          detail: {
            message: "paid order not fulfilled",
            reconciliation_run_id: RUN_ID,
            reconciliation_run_type: "payment_fulfillment",
            star_order_id: STAR_ORDER_ID,
          },
          resolved_by_admin_id: null,
          resolved_at: null,
          created_at: "2026-05-31T01:00:00.000Z",
        },
        {
          id: ORDINARY_RISK_EVENT_ID,
          user_id: ADMIN_CONTEXT.userId,
          event_type: "LOGIN_RISK",
          severity: "medium",
          status: "open",
          source_type: "auth",
          source_id: null,
          score_delta: 5,
          detail: {
            message: "ordinary risk event",
          },
          resolved_by_admin_id: null,
          resolved_at: null,
          created_at: "2026-05-31T01:01:00.000Z",
        },
      ],
    });
    getSupabaseAdminClientMock.mockReturnValue(db.client);

    const { default: findingsHandler } =
      await import("../../api/admin/reconciliation/findings");
    const result = await invokeApiHandler<ApiSuccessResponse>(
      findingsHandler,
      {
        method: "GET",
        url: "/api/admin/reconciliation/findings?status=open",
        query: {
          status: "open",
        },
      },
    );

    expect(result.statusCode).toBe(200);
    expect(requireAdminMock).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        permissions: ["ops:read", "risk:read"],
        requireAll: false,
      }),
    );
    expect(result.body).toMatchObject({
      ok: true,
      data: {
        items: [
          expect.objectContaining({
            risk_event_id: RISK_EVENT_ID,
            starOrderId: STAR_ORDER_ID,
          }),
        ],
        summary: {
          findingCount: 1,
          riskEventCount: 1,
        },
      },
    });
    expect(JSON.stringify(result.body)).not.toContain(ORDINARY_RISK_EVENT_ID);
    expect(db.operations[0]?.filters).toEqual(
      expect.arrayContaining([
        {
          kind: "not",
          column: "detail->>reconciliation_run_id",
          operator: "is",
          value: null,
        },
        {
          kind: "not",
          column: "detail->>reconciliation_run_type",
          operator: "is",
          value: null,
        },
      ]),
    );
  });

  it("falls back to dry-run run findings without counting them as risk events", async () => {
    const db = createAdminReadDbMock({
      "ops.risk_events": [],
      "economy.reconciliation_runs": [
        {
          id: RUN_ID,
          run_type: "payment_fulfillment",
          started_at: "2026-05-31T02:00:00.000Z",
          result: {
            dry_run: true,
            findings: [
              {
                code: "PAYMENT_FULFILLMENT_MISSING",
                message: "dry-run finding",
                severity: "critical",
                source_type: "star_order",
                source_id: STAR_ORDER_ID,
                star_order_id: STAR_ORDER_ID,
              },
            ],
          },
        },
      ],
    });
    getSupabaseAdminClientMock.mockReturnValue(db.client);

    const { default: findingsHandler } =
      await import("../../api/admin/reconciliation/findings");
    const result = await invokeApiHandler<ApiSuccessResponse>(
      findingsHandler,
      {
        method: "GET",
        url: `/api/admin/reconciliation/findings?runId=${RUN_ID}`,
        query: {
          runId: RUN_ID,
        },
      },
    );

    expect(result.statusCode).toBe(200);
    expect(result.body).toMatchObject({
      ok: true,
      data: {
        items: [
          expect.objectContaining({
            id: `${RUN_ID}:0`,
            dryRun: true,
          }),
        ],
        summary: {
          findingCount: 1,
          criticalCount: 1,
          riskEventCount: 0,
        },
      },
    });
    const data = result.body.data as { items: Array<Record<string, unknown>> };
    expect(data.items[0]).not.toHaveProperty("risk_event_id");
  });

  it("merges run result findings that were not written as risk events", async () => {
    const db = createAdminReadDbMock({
      "ops.risk_events": [
        {
          id: RISK_EVENT_ID,
          user_id: ADMIN_CONTEXT.userId,
          event_type: "PAYMENT_FULFILLMENT_MISSING",
          severity: "high",
          status: "open",
          source_type: "star_order",
          source_id: STAR_ORDER_ID,
          score_delta: 25,
          detail: {
            message: "paid order not fulfilled",
            reconciliation_run_id: RUN_ID,
            reconciliation_run_type: "payment_fulfillment",
            star_order_id: STAR_ORDER_ID,
          },
          resolved_by_admin_id: null,
          resolved_at: null,
          created_at: "2026-05-31T01:00:00.000Z",
        },
      ],
      "economy.reconciliation_runs": [
        {
          id: RUN_ID,
          run_type: "payment_fulfillment",
          started_at: "2026-05-31T02:00:00.000Z",
          result: {
            findings: [
              {
                code: "PAYMENT_FULFILLMENT_MISSING",
                message: "risk event finding",
                severity: "high",
                source_type: "star_order",
                source_id: STAR_ORDER_ID,
                star_order_id: STAR_ORDER_ID,
              },
              {
                code: "PAYMENT_RECONCILIATION_SKIPPED",
                message: "run result only finding",
                severity: "medium",
                source_type: "reconciliation_run",
                source_id: null,
              },
            ],
          },
        },
      ],
    });
    getSupabaseAdminClientMock.mockReturnValue(db.client);

    const { default: findingsHandler } =
      await import("../../api/admin/reconciliation/findings");
    const result = await invokeApiHandler<ApiSuccessResponse>(
      findingsHandler,
      {
        method: "GET",
        url: `/api/admin/reconciliation/findings?runId=${RUN_ID}`,
        query: {
          runId: RUN_ID,
        },
      },
    );

    expect(result.statusCode).toBe(200);
    expect(result.body).toMatchObject({
      ok: true,
      data: {
        summary: {
          findingCount: 2,
          riskEventCount: 1,
        },
      },
    });
    expect(JSON.stringify(result.body)).toContain(
      "PAYMENT_RECONCILIATION_SKIPPED",
    );
  });

  it("lists reconciliation runs with run type filters", async () => {
    const marketRunId = "44444444-4444-4444-8444-444444444445";
    const db = createAdminReadDbMock({
      "economy.reconciliation_runs": [
        {
          id: RUN_ID,
          run_type: "payment_fulfillment",
          status: "success",
          started_at: "2026-05-31T01:00:00.000Z",
          finished_at: "2026-05-31T01:00:01.000Z",
          result: {
            checked_count: 10,
            finding_count: 1,
            critical_count: 0,
            risk_event_count: 1,
            elapsed_ms: 1000,
          },
          error_message: null,
          created_by: "cron",
        },
        {
          id: marketRunId,
          run_type: "market_settlement",
          status: "success",
          started_at: "2026-05-31T02:00:00.000Z",
          finished_at: "2026-05-31T02:00:02.000Z",
          result: {
            checked_count: 20,
            finding_count: 2,
            critical_count: 1,
            risk_event_count: 2,
            elapsed_ms: 2000,
          },
          error_message: null,
          created_by: "admin",
        },
      ],
    });
    getSupabaseAdminClientMock.mockReturnValue(db.client);

    const { default: runsHandler } =
      await import("../../api/admin/reconciliation/runs");
    const result = await invokeApiHandler<ApiSuccessResponse>(runsHandler, {
      method: "GET",
      url: "/api/admin/reconciliation/runs?runType=market",
      query: {
        runType: "market",
      },
    });

    expect(result.statusCode).toBe(200);
    expect(result.body).toMatchObject({
      ok: true,
      data: {
        items: [
          expect.objectContaining({
            id: marketRunId,
            runType: "market",
            checkedCount: 20,
          }),
        ],
        summary: {
          totalRuns: 1,
          findingCount: 2,
        },
      },
    });
    expect(db.operations[0]?.filters).toContainEqual({
      kind: "eq",
      column: "run_type",
      value: "market_settlement",
    });
  });

  it("applies severity and status filters to dry-run run result fallback", async () => {
    const db = createAdminReadDbMock({
      "ops.risk_events": [],
      "economy.reconciliation_runs": [
        {
          id: RUN_ID,
          run_type: "payment_fulfillment",
          started_at: "2026-05-31T02:00:00.000Z",
          result: {
            dry_run: true,
            findings: [
              {
                code: "PAYMENT_FULFILLMENT_MISSING",
                message: "critical dry-run finding",
                severity: "critical",
                source_type: "star_order",
                source_id: STAR_ORDER_ID,
              },
              {
                code: "PAYMENT_FULFILLMENT_DELAYED",
                message: "high dry-run finding",
                severity: "high",
                source_type: "star_order",
                source_id: "99999999-9999-4999-8999-999999999999",
              },
            ],
          },
        },
      ],
    });
    getSupabaseAdminClientMock.mockReturnValue(db.client);

    const { default: findingsHandler } =
      await import("../../api/admin/reconciliation/findings");
    const filteredResult = await invokeApiHandler<ApiSuccessResponse>(
      findingsHandler,
      {
        method: "GET",
        url: `/api/admin/reconciliation/findings?runId=${RUN_ID}&severity=critical&status=open`,
        query: {
          runId: RUN_ID,
          severity: "critical",
          status: "open",
        },
      },
    );

    expect(filteredResult.statusCode).toBe(200);
    expect(filteredResult.body).toMatchObject({
      ok: true,
      data: {
        items: [
          expect.objectContaining({
            code: "PAYMENT_FULFILLMENT_MISSING",
            severity: "critical",
            status: "open",
            dryRun: true,
          }),
        ],
        summary: {
          findingCount: 1,
          criticalCount: 1,
          riskEventCount: 0,
        },
      },
    });
    expect(JSON.stringify(filteredResult.body)).not.toContain(
      "PAYMENT_FULFILLMENT_DELAYED",
    );

    const closedStatusResult = await invokeApiHandler<ApiSuccessResponse>(
      findingsHandler,
      {
        method: "GET",
        url: `/api/admin/reconciliation/findings?runId=${RUN_ID}&status=ignored`,
        query: {
          runId: RUN_ID,
          status: "ignored",
        },
      },
    );

    expect(closedStatusResult.statusCode).toBe(200);
    expect(closedStatusResult.body).toMatchObject({
      ok: true,
      data: {
        items: [],
        summary: {
          findingCount: 0,
          riskEventCount: 0,
        },
      },
    });
  });

  it("runs reconciliation through the shared job with admin idempotency", async () => {
    runPhase5ReconciliationMock.mockResolvedValueOnce({
      requestId: "req-run-now",
      startedAt: "2026-05-31T04:00:00.000Z",
      finishedAt: "2026-05-31T04:00:01.000Z",
      limit: 20,
      checkedCount: 5,
      findingCount: 1,
      criticalCount: 0,
      riskEventCount: 1,
      riskEventInsertedCount: 1,
      riskEventExistingCount: 0,
      riskEventSkippedCount: 0,
      elapsedMs: 1000,
      runs: [],
      serverTime: "2026-05-31T04:00:01.000Z",
    });

    const { default: runNowHandler } =
      await import("../../api/admin/reconciliation/run-now");
    const result = await invokeApiHandler<ApiSuccessResponse>(runNowHandler, {
      method: "POST",
      url: "/api/admin/reconciliation/run-now",
      headers: {
        "x-admin-confirm": "true",
        "x-idempotency-key": "admin-reconcile-run-now-test",
      },
      body: {
        runTypes: ["payment"],
        limit: 20,
        dryRun: false,
        writeRiskEvents: true,
        reason: "run payment reconciliation from admin",
        confirmationTarget: "payment",
        confirmationCode: "payment",
        confirm: true,
      },
    });

    expect(result.statusCode).toBe(200);
    expect(requireAdminMock).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        permissions: ["ops:write", "risk:write"],
        requireAll: false,
      }),
    );
    expect(withIdempotencyMock).toHaveBeenCalledWith(
      expect.objectContaining({
        scope: "admin.reconciliation.run_now",
        key: "admin-reconcile-run-now-test",
        userId: ADMIN_CONTEXT.userId,
        requestPayload: expect.objectContaining({
          runTypes: ["payment_fulfillment"],
          dryRun: false,
          limit: 20,
        }),
      }),
    );
    expect(runPhase5ReconciliationMock).toHaveBeenCalledWith(
      expect.objectContaining({
        runTypes: ["payment_fulfillment"],
        limit: 20,
        createdBy: `admin:${ADMIN_CONTEXT.adminId}`,
        writeRiskEvents: true,
      }),
    );
    expect(result.body).toMatchObject({
      ok: true,
      data: {
        checkedCount: 5,
        dryRun: false,
        writeRiskEvents: true,
        idempotent: false,
      },
    });
  });

  it("rejects POST for resolve-finding before calling the RPC", async () => {
    const { default: resolveHandler } =
      await import("../../api/admin/reconciliation/resolve-finding");
    const result = await invokeApiHandler(resolveHandler, {
      method: "POST",
      url: "/api/admin/reconciliation/resolve-finding",
      headers: {
        "x-admin-confirm": "true",
        "x-idempotency-key": "admin-reconcile-resolve-post-test",
      },
      body: {
        findingId: RISK_EVENT_ID,
        status: "ignored",
        reason: "reject post method",
        confirm: true,
      },
    });

    expect(result.statusCode).toBe(405);
    expect(requireAdminMock).not.toHaveBeenCalled();
    expect(runWriteRpcMock).not.toHaveBeenCalled();
  });

  it("uses PATCH with risk write permission to resolve findings", async () => {
    requireAdminMock.mockResolvedValueOnce(RISK_ADMIN_CONTEXT);
    runWriteRpcMock.mockResolvedValueOnce({
      risk_event_id: RISK_EVENT_ID,
      status: "ignored",
      previous_status: "open",
      audit_log_id: AUDIT_LOG_ID,
      resolved_at: "2026-05-31T03:00:00.000Z",
    });

    const { default: resolveHandler } =
      await import("../../api/admin/reconciliation/resolve-finding");
    const result = await invokeApiHandler<ApiSuccessResponse>(
      resolveHandler,
      {
        method: "PATCH",
        url: "/api/admin/reconciliation/resolve-finding",
        headers: {
          "x-admin-confirm": "true",
          "x-idempotency-key": "admin-reconcile-resolve-patch-test",
        },
        body: {
          findingId: RISK_EVENT_ID,
          status: "ignored",
          reason: "ignore duplicated open risk event",
          confirmationTarget: RISK_EVENT_ID,
          confirmationCode: RISK_EVENT_ID.slice(-6),
          confirm: true,
        },
      },
    );

    expect(result.statusCode).toBe(200);
    expect(requireAdminMock).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        permissions: ["risk:write"],
      }),
    );
    expect(runWriteRpcMock).toHaveBeenCalledWith(
      expect.objectContaining({
        schema: "api",
        functionName: "admin_resolve_reconciliation_finding",
        args: expect.objectContaining({
          p_admin_user_id: RISK_ADMIN_CONTEXT.adminId,
          p_risk_event_id: RISK_EVENT_ID,
          p_status: "ignored",
          p_reason: "ignore duplicated open risk event",
          p_idempotency_key: "admin-reconcile-resolve-patch-test",
        }),
      }),
    );
    expect(result.body).toMatchObject({
      ok: true,
      data: {
        risk_event_id: RISK_EVENT_ID,
        status: "ignored",
        audit_log_id: AUDIT_LOG_ID,
      },
    });
  });

  it("does not allow ops write permission alone to resolve findings", async () => {
    requireAdminMock.mockImplementationOnce((...args: unknown[]) => {
      expect(args[1]).toMatchObject({
        permissions: ["risk:write"],
      });
      throw new ApiError(
        403,
        "FORBIDDEN",
        "risk:write permission is required.",
      );
    });

    const { default: resolveHandler } =
      await import("../../api/admin/reconciliation/resolve-finding");
    const result = await invokeApiHandler(resolveHandler, {
      method: "PATCH",
      url: "/api/admin/reconciliation/resolve-finding",
      headers: {
        "x-admin-confirm": "true",
        "x-idempotency-key": "admin-reconcile-resolve-ops-denied-test",
      },
      body: {
        findingId: RISK_EVENT_ID,
        status: "ignored",
        reason: "ops write cannot resolve reconciliation findings",
        confirmationTarget: RISK_EVENT_ID,
        confirmationCode: RISK_EVENT_ID.slice(-6),
        confirm: true,
      },
    });

    expect(result.statusCode).toBe(403);
    expect(result.body).toMatchObject({
      error: {
        code: "FORBIDDEN",
      },
    });
    expect(runWriteRpcMock).not.toHaveBeenCalled();
  });

  it("rejects mismatched resolve confirmation before calling the RPC", async () => {
    const { default: resolveHandler } =
      await import("../../api/admin/reconciliation/resolve-finding");
    const result = await invokeApiHandler(resolveHandler, {
      method: "PATCH",
      url: "/api/admin/reconciliation/resolve-finding",
      headers: {
        "x-admin-confirm": "true",
        "x-idempotency-key": "admin-reconcile-resolve-confirmation-test",
      },
      body: {
        findingId: RISK_EVENT_ID,
        status: "ignored",
        reason: "ignore duplicated open risk event",
        confirmationTarget: RISK_EVENT_ID,
        confirmationCode: "wrong",
        confirm: true,
      },
    });

    expect(result.statusCode).toBe(400);
    expect(result.body).toMatchObject({
      error: {
        code: "ADMIN_CONFIRMATION_CODE_INVALID",
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
    range: null,
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
    ilike: (column: string, value: unknown) => {
      operation.filters.push({ kind: "ilike", column, value });
      return builder;
    },
    not: (column: string, operator: string, value: unknown) => {
      operation.filters.push({ kind: "not", column, operator, value });
      return builder;
    },
    order: () => builder,
    range: (from: number, to: number) => {
      operation.range = [from, to];
      return builder;
    },
    maybeSingle: () => {
      const result = resolveAdminQuery(operation, rowsByTable);

      return Promise.resolve({
        data: result.data[0] ?? null,
        error: result.error,
      });
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
      rows = rows.filter((row) => readColumn(row, filter.column) === filter.value);
    }

    if (filter.kind === "ilike") {
      const pattern = String(filter.value ?? "")
        .replace(/^%/, "")
        .replace(/%$/, "")
        .toLowerCase();
      rows = rows.filter((row) =>
        String(readColumn(row, filter.column) ?? "")
          .toLowerCase()
          .includes(pattern),
      );
    }

    if (filter.kind === "not" && filter.operator === "is") {
      rows = rows.filter((row) => {
        const columnValue = readColumn(row, filter.column);

        if (filter.value === null) {
          return columnValue !== null && columnValue !== undefined;
        }

        return columnValue !== filter.value;
      });
    }
  }

  if (operation.range) {
    rows = rows.slice(operation.range[0], operation.range[1] + 1);
  }

  if (operation.selectedColumns) {
    rows = rows.map((row) => {
      const selectedRow: Record<string, unknown> = {};

      for (const column of operation.selectedColumns ?? []) {
        selectedRow[column] = readColumn(row, column);
      }

      return selectedRow;
    });
  }

  return {
    data: rows,
    error: null,
  };
}

function readColumn(row: Record<string, unknown>, column: string): unknown {
  const [baseColumn, jsonKey] = column.split("->>");
  const safeBaseColumn = baseColumn ?? column;

  if (jsonKey) {
    const jsonValue = row[safeBaseColumn];

    if (
      typeof jsonValue === "object" &&
      jsonValue !== null &&
      !Array.isArray(jsonValue)
    ) {
      return (jsonValue as Record<string, unknown>)[jsonKey];
    }

    return undefined;
  }

  return row[column];
}
