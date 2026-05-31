import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  ApiError,
  type ApiErrorResponse,
  type ApiSuccessResponse,
} from "../../api/_shared/handler";
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
  sessionId: "session-admin-risk-test",
  userId: "11111111-1111-4111-8111-111111111111",
  telegramUserId: 7001,
  userStatus: "active",
  expiresAt: "2026-05-30T00:00:00.000Z",
  sessionTokenHash: "session-hash",
  adminId: "22222222-2222-4222-8222-222222222222",
  roleId: "33333333-3333-4333-8333-333333333333",
  roleCode: "RISK",
  isSuperAdmin: false,
  permissions: ["risk:read", "risk:write"],
};

const RISK_EVENT_ID = "33333333-3333-4333-8333-333333333333";
const USER_ID = "44444444-4444-4444-8444-444444444444";
const STAR_ORDER_ID = "55555555-5555-4555-8555-555555555555";
const FLAG_ID = "66666666-6666-4666-8666-666666666666";

type AdminTableRows = Record<string, Array<Record<string, unknown>>>;

type QueryFilter =
  | {
      kind: "eq" | "neq" | "gte" | "lte" | "in";
      column: string;
      value: unknown;
    }
  | { kind: "not"; column: string; operator: string; value: unknown }
  | { kind: "or"; value: string };

type QueryOperation = {
  schema: string;
  table: string;
  selectedColumns: string[] | null;
  filters: QueryFilter[];
  range: [number, number] | null;
  limit: number | null;
};

describe("admin risk APIs", () => {
  beforeEach(() => {
    process.env.NODE_ENV = "test";
    vi.resetModules();
    getSupabaseAdminClientMock.mockReset();
    requireAdminMock.mockReset();
    runWriteRpcMock.mockReset();
    requireAdminMock.mockResolvedValue(ADMIN_CONTEXT);
  });

  it("rejects body-only confirmation for risk writes", async () => {
    const { default: resolveHandler } =
      await import("../../api/admin/risk/resolve");
    const result = await invokeApiHandler<ApiErrorResponse>(resolveHandler, {
      method: "POST",
      url: "/api/admin/risk/resolve",
      headers: {
        "x-idempotency-key": "admin-risk-resolve-test-001",
      },
      body: {
        riskEventId: RISK_EVENT_ID,
        status: "ignored",
        reason: "ignore in risk test",
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

  it("rejects body-only idempotency key for risk writes", async () => {
    const { default: resolveHandler } =
      await import("../../api/admin/risk/resolve");
    const result = await invokeApiHandler<ApiErrorResponse>(resolveHandler, {
      method: "POST",
      url: "/api/admin/risk/resolve",
      headers: {
        "x-admin-confirm": "true",
      },
      body: {
        riskEventId: RISK_EVENT_ID,
        status: "fixed",
        reason: "fixed in risk test",
        idempotencyKey: "admin-risk-resolve-body-only",
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

  it("lets a RISK admin resolve a risk event through the audited RPC", async () => {
    runWriteRpcMock.mockResolvedValueOnce({
      risk_event_id: RISK_EVENT_ID,
      status: "fixed",
      audit_log_id: "77777777-7777-4777-8777-777777777777",
    });

    const { default: resolveHandler } =
      await import("../../api/admin/risk/resolve");
    const result = await invokeApiHandler<ApiSuccessResponse>(resolveHandler, {
      method: "POST",
      url: "/api/admin/risk/resolve",
      headers: {
        "x-admin-confirm": "true",
        "x-idempotency-key": "admin-risk-resolve-test-002",
        "x-forwarded-for": "127.0.0.23",
        "user-agent": "vitest-admin-risk",
      },
      body: {
        riskEventId: RISK_EVENT_ID,
        status: "fixed",
        reason: "fixed in risk test",
        fixMethod: "manual_review",
      },
    });

    expect(result.statusCode).toBe(200);
    expect(requireAdminMock).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        permissions: ["risk:write", "admin:write"],
        requireAll: false,
      }),
    );
    expect(runWriteRpcMock).toHaveBeenCalledWith(
      expect.objectContaining({
        schema: "api",
        functionName: "admin_resolve_risk_event",
        args: expect.objectContaining({
          p_admin_user_id: ADMIN_CONTEXT.adminId,
          p_risk_event_id: RISK_EVENT_ID,
          p_status: "fixed",
          p_reason: "fixed in risk test",
          p_idempotency_key: "admin-risk-resolve-test-002",
          p_request_context: expect.objectContaining({
            admin_user_id: ADMIN_CONTEXT.adminId,
            ip_hash: expect.any(String),
            user_agent_hash: expect.any(String),
          }),
          p_resolution_detail: expect.objectContaining({
            fix_method: "manual_review",
          }),
        }),
      }),
    );
  });

  it("does not let SUPPORT apply user flags", async () => {
    requireAdminMock.mockRejectedValueOnce(
      new ApiError(403, "FORBIDDEN", "Admin permission required"),
    );

    const { default: applyFlagHandler } =
      await import("../../api/admin/risk/apply-user-flag");
    const result = await invokeApiHandler<ApiErrorResponse>(applyFlagHandler, {
      method: "POST",
      url: "/api/admin/risk/apply-user-flag",
      headers: {
        "x-admin-confirm": "true",
        "x-idempotency-key": "admin-risk-apply-flag-test-001",
      },
      body: {
        userId: USER_ID,
        flagCode: "gacha_blocked",
        reason: "support cannot apply flags",
      },
    });

    expect(result.statusCode).toBe(403);
    expect(runWriteRpcMock).not.toHaveBeenCalled();
    expect(requireAdminMock).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        permissions: ["risk:write", "admin:write"],
        requireAll: false,
      }),
    );
  });

  it("lists risk events with loaded payment association summaries", async () => {
    getSupabaseAdminClientMock.mockReturnValue(
      createAdminReadDbMock({
        "ops.risk_events": [
          {
            id: RISK_EVENT_ID,
            user_id: USER_ID,
            event_type: "payment_paid_not_fulfilled",
            severity: "high",
            status: "open",
            source_type: "star_order",
            source_id: STAR_ORDER_ID,
            score_delta: 30,
            detail: {
              star_order_id: STAR_ORDER_ID,
              token: "must-redact",
            },
            resolved_by_admin_id: null,
            resolved_at: null,
            created_at: "2026-05-31T00:00:00.000Z",
          },
        ],
        "payments.star_orders": [
          {
            id: STAR_ORDER_ID,
            status: "paid",
            business_type: "gacha",
            business_id: RISK_EVENT_ID,
            xtr_amount: 100,
            paid_at: "2026-05-31T00:01:00.000Z",
            fulfilled_at: null,
            created_at: "2026-05-31T00:00:00.000Z",
          },
        ],
      }).client,
    );

    const { default: eventsHandler } =
      await import("../../api/admin/risk/events");
    const result = await invokeApiHandler<
      ApiSuccessResponse<Record<string, unknown>>
    >(eventsHandler, {
      method: "GET",
      url: "/api/admin/risk/events",
      query: {
        sort: "created_at",
        limit: "20",
      },
    });

    expect(result.statusCode).toBe(200);
    expect(result.body.data).toMatchObject({
      items: [
        {
          id: RISK_EVENT_ID,
          detail: {
            token: "[REDACTED]",
          },
        },
      ],
    });
    expect(JSON.stringify(result.body.data)).toContain('"lookup":"loaded"');
    expect(JSON.stringify(result.body.data)).toContain('"status":"paid"');
    expect(JSON.stringify(result.body.data)).not.toContain("must-redact");
  });

  it("returns user profile device/IP hashes and payment failure rate", async () => {
    getSupabaseAdminClientMock.mockReturnValue(
      createAdminReadDbMock({
        "core.users": [
          {
            id: USER_ID,
            telegram_user_id: 7001,
            username: "risk_user",
            first_name: "Risk",
            last_name: "User",
            language_code: "en",
            is_premium: false,
            is_bot: false,
            invite_code: "riskuser",
            referred_by_user_id: null,
            status: "active",
            risk_score: 30,
            first_seen_at: "2026-05-01T00:00:00.000Z",
            last_seen_at: "2026-05-31T00:00:00.000Z",
            last_auth_at: "2026-05-31T00:00:00.000Z",
            metadata: {},
            created_at: "2026-05-01T00:00:00.000Z",
            updated_at: "2026-05-31T00:00:00.000Z",
          },
        ],
        "core.user_devices": [
          {
            id: "88888888-8888-4888-8888-888888888888",
            user_id: USER_ID,
            device_key: "device-secret-key",
            platform: "ios",
            user_agent: "raw user agent",
            first_seen_at: "2026-05-01T00:00:00.000Z",
            last_seen_at: "2026-05-31T00:00:00.000Z",
            metadata: {},
          },
        ],
        "core.app_sessions": [
          {
            id: "99999999-9999-4999-8999-999999999999",
            user_id: USER_ID,
            ip_hash: "ip-hash-only",
            device_id: "device-secret-key",
            platform: "ios",
            user_agent: "raw user agent",
            expires_at: "2026-06-01T00:00:00.000Z",
            revoked_at: null,
            last_seen_at: "2026-05-31T00:00:00.000Z",
            created_at: "2026-05-31T00:00:00.000Z",
          },
        ],
        "payments.star_orders": [
          {
            id: STAR_ORDER_ID,
            user_id: USER_ID,
            business_type: "gacha",
            business_id: null,
            status: "fulfilled",
            xtr_amount: 100,
            paid_at: "2026-05-31T00:00:00.000Z",
            fulfilled_at: "2026-05-31T00:01:00.000Z",
            created_at: "2026-05-31T00:00:00.000Z",
          },
          {
            id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
            user_id: USER_ID,
            business_type: "gacha",
            business_id: null,
            status: "failed",
            xtr_amount: 100,
            paid_at: null,
            fulfilled_at: null,
            created_at: "2026-05-30T00:00:00.000Z",
          },
        ],
        "core.user_flags": [
          {
            id: FLAG_ID,
            user_id: USER_ID,
            flag_code: "support_review_required",
            flag_level: "warning",
            reason: "risk test",
            active: true,
            starts_at: "2026-05-31T00:00:00.000Z",
            ends_at: null,
            created_by_admin_id: ADMIN_CONTEXT.adminId,
            metadata: {},
            created_at: "2026-05-31T00:00:00.000Z",
            updated_at: "2026-05-31T00:00:00.000Z",
          },
        ],
        "core.user_wallets": [],
        "market.orders": [],
        "tasks.referrals": [],
        "ops.risk_events": [],
      }).client,
    );

    const { default: profileHandler } =
      await import("../../api/admin/risk/user-profile");
    const result = await invokeApiHandler<
      ApiSuccessResponse<Record<string, unknown>>
    >(profileHandler, {
      method: "GET",
      url: "/api/admin/risk/user-profile",
      query: {
        userId: USER_ID,
      },
    });

    expect(result.statusCode).toBe(200);
    expect(result.body.data).toMatchObject({
      devices: {
        deviceCount: 1,
        sessionCount: 1,
        ipHashCount: 1,
        recentIpHashes: ["ip-hash-only"],
      },
      payments: {
        totalCount: 2,
        failedCount: 1,
        failureRate: 0.5,
      },
    });
    expect(JSON.stringify(result.body.data)).not.toContain("device-secret-key");
    expect(JSON.stringify(result.body.data)).not.toContain("raw user agent");
  });
});

function createAdminReadDbMock(rowsByTable: AdminTableRows): {
  client: unknown;
  operations: QueryOperation[];
} {
  const operations: QueryOperation[] = [];

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
  operations: QueryOperation[],
) {
  const operation: QueryOperation = {
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
    neq: (column: string, value: unknown) => {
      operation.filters.push({ kind: "neq", column, value });
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
    in: (column: string, value: unknown) => {
      operation.filters.push({ kind: "in", column, value });
      return builder;
    },
    not: (column: string, operator: string, value: unknown) => {
      operation.filters.push({ kind: "not", column, operator, value });
      return builder;
    },
    or: (value: string) => {
      operation.filters.push({ kind: "or", value });
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
    maybeSingle: () => {
      const resolved = resolveAdminQuery(operation, rowsByTable);
      return Promise.resolve({
        data: resolved.data[0] ?? null,
        error: null,
      });
    },
    then: (
      resolve: (value: {
        data: Array<Record<string, unknown>>;
        error: null;
        count: number;
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
  operation: QueryOperation,
  rowsByTable: AdminTableRows,
): { data: Array<Record<string, unknown>>; error: null; count: number } {
  let rows = [...(rowsByTable[`${operation.schema}.${operation.table}`] ?? [])];

  for (const filter of operation.filters) {
    if (filter.kind === "eq") {
      rows = rows.filter((row) => row[filter.column] === filter.value);
    }

    if (filter.kind === "neq") {
      rows = rows.filter((row) => row[filter.column] !== filter.value);
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

    if (filter.kind === "in") {
      const values = filter.value;

      if (Array.isArray(values)) {
        rows = rows.filter((row) => values.includes(row[filter.column]));
      }
    }

    if (filter.kind === "not" && filter.operator === "is") {
      rows = rows.filter((row) => row[filter.column] !== filter.value);
    }

    if (filter.kind === "or") {
      const clauses = filter.value.split(",");
      rows = rows.filter((row) =>
        clauses.some((clause) => {
          const [column, operator, value] = clause.split(".");
          if (!column) {
            return false;
          }

          return operator === "eq" && row[column] === value;
        }),
      );
    }
  }

  const count = rows.length;

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
    count,
  };
}
