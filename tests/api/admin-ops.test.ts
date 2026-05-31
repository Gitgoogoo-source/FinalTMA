import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ApiError, type ApiSuccessResponse } from "../../api/_shared/handler";
import { invokeApiHandler } from "./_utils";

const {
  assertAdminPermissionsMock,
  getSupabaseAdminClientMock,
  requireAdminMock,
  runWriteRpcMock,
} = vi.hoisted(() => ({
  assertAdminPermissionsMock: vi.fn(),
  getSupabaseAdminClientMock: vi.fn(),
  requireAdminMock: vi.fn(),
  runWriteRpcMock: vi.fn(),
}));

vi.mock("../../packages/server/src/db/supabaseAdmin.js", () => ({
  getSupabaseAdminClient: getSupabaseAdminClientMock,
}));

vi.mock("../../api/_shared/requireAdmin.js", () => ({
  assertAdminPermissions: assertAdminPermissionsMock,
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
const DRAW_ORDER_ID = "88888888-8888-4888-8888-888888888888";
const DRAW_RESULT_ID = "99999999-9999-4999-8999-999999999999";
const ITEM_INSTANCE_ID = "12121212-1212-4121-8121-121212121212";
const DISPUTE_ID = "13131313-1313-4131-8131-131313131313";
const LEDGER_ID = "14141414-1414-4141-8141-141414141414";
const CORE_USER_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const LOCK_ID = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const BOX_ID = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const AUDIT_LOG_ID = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";

type AdminQueryOperation = {
  schema: string;
  table: string;
  selectedColumns: string[] | null;
  filters: Array<{
    kind: "eq" | "gte" | "lte" | "ilike" | "in" | "or" | "not";
    column: string;
    value: unknown;
    operator?: string;
  }>;
  range: [number, number] | null;
  limit: number | null;
};

type AdminTableRows = Record<string, Array<Record<string, unknown>>>;

describe("admin ops APIs", () => {
  beforeEach(() => {
    process.env.NODE_ENV = "test";
    getSupabaseAdminClientMock.mockReset();
    assertAdminPermissionsMock.mockReset();
    requireAdminMock.mockReset();
    runWriteRpcMock.mockReset();
    assertAdminPermissionsMock.mockImplementation(() => undefined);
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

  it("rejects non-admin audit log queries before reading admin audit tables", async () => {
    requireAdminMock.mockRejectedValue(
      new ApiError(403, "FORBIDDEN", "Admin permission required"),
    );

    const { default: auditLogsHandler } =
      await import("../../api/admin/audit-logs");
    const result = await invokeApiHandler(auditLogsHandler, {
      method: "GET",
      url: "/api/admin/audit-logs",
    });

    expect(result.statusCode).toBe(403);
    expect(result.body).toMatchObject({
      error: {
        code: "FORBIDDEN",
      },
    });
    expect(getSupabaseAdminClientMock).not.toHaveBeenCalled();
    expect(requireAdminMock).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        permissions: ["audit:read", "admin:read"],
        requireAll: false,
      }),
    );
  });

  it("lets admins query audit logs with filters and safe admin summaries", async () => {
    const db = createAdminReadDbMock({
      "ops.admin_audit_logs": [
        {
          id: AUDIT_LOG_ID,
          admin_user_id: ADMIN_CONTEXT.adminId,
          action: "feature_flag.update",
          target_schema: "ops",
          target_table: "feature_flags",
          target_id: LOCK_ID,
          before_state: {
            enabled: false,
            service_role_key: "secret-service-role",
          },
          after_state: {
            enabled: true,
            request_context: {
              request_id: "req-audit-1",
            },
          },
          ip_hash: "ip-hash",
          user_agent: "user-agent-hash",
          reason: "enable payment gate",
          created_at: "2026-05-30T10:00:00.000Z",
        },
      ],
      "ops.admin_users": [
        {
          id: ADMIN_CONTEXT.adminId,
          display_name: "Ops Admin",
          telegram_user_id: ADMIN_CONTEXT.telegramUserId,
          email: "ops@example.test",
          metadata: {
            should_not_leak: true,
          },
        },
      ],
    });
    getSupabaseAdminClientMock.mockReturnValue(db.client);

    const { default: auditLogsHandler } =
      await import("../../api/admin/audit-logs");
    const result = await invokeApiHandler<ApiSuccessResponse>(
      auditLogsHandler,
      {
        method: "GET",
        url: "/api/admin/audit-logs",
        query: {
          adminUserId: ADMIN_CONTEXT.adminId,
          action: "feature_flag",
          targetSchema: "ops",
          targetTable: "feature_flags",
          targetId: LOCK_ID,
          from: "2026-05-30T00:00:00.000Z",
          to: "2026-05-30T23:59:59.999Z",
          riskLevel: "medium",
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
            id: AUDIT_LOG_ID,
            admin_user_id: ADMIN_CONTEXT.adminId,
            admin: {
              id: ADMIN_CONTEXT.adminId,
              display_name: "Ops Admin",
              telegram_user_id: ADMIN_CONTEXT.telegramUserId,
              email: "ops@example.test",
            },
            action: "feature_flag.update",
            target_schema: "ops",
            target_table: "feature_flags",
            target_id: LOCK_ID,
            before_state: {
              enabled: false,
              service_role_key: "[redacted]",
            },
            after_state: {
              enabled: true,
              request_context: {
                request_id: "req-audit-1",
              },
            },
            request_id: "req-audit-1",
            risk_level: "medium",
          },
        ],
        summary: {
          total: 1,
          medium: 1,
        },
        nextCursor: null,
      },
    });
    expect(JSON.stringify(result.body)).not.toContain("secret-service-role");
    expect(JSON.stringify(result.body)).not.toContain("should_not_leak");
    expect(requireAdminMock).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        permissions: ["audit:read", "admin:read"],
        requireAll: false,
      }),
    );
    expect(db.operations).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          schema: "ops",
          table: "admin_audit_logs",
          filters: expect.arrayContaining([
            {
              kind: "eq",
              column: "admin_user_id",
              value: ADMIN_CONTEXT.adminId,
            },
            {
              kind: "ilike",
              column: "action",
              value: "%feature_flag%",
            },
            {
              kind: "eq",
              column: "target_schema",
              value: "ops",
            },
            {
              kind: "eq",
              column: "target_table",
              value: "feature_flags",
            },
            {
              kind: "eq",
              column: "target_id",
              value: LOCK_ID,
            },
            {
              kind: "gte",
              column: "created_at",
              value: "2026-05-30T00:00:00.000Z",
            },
            {
              kind: "lte",
              column: "created_at",
              value: "2026-05-30T23:59:59.999Z",
            },
            {
              kind: "or",
              column: "",
              value:
                "action.ilike.%create%,action.ilike.%update%,action.ilike.%retry%,action.ilike.%feature_flag%,action.ilike.%feature-flag%,action.ilike.%status%,action.ilike.%audit.export%",
            },
            {
              kind: "not",
              column: "action",
              operator: "ilike",
              value: "%payment.retry%",
            },
            {
              kind: "not",
              column: "action",
              operator: "ilike",
              value: "%mint.retry%",
            },
          ]),
          range: [0, 10],
        }),
        expect.objectContaining({
          schema: "ops",
          table: "admin_users",
          selectedColumns: ["id", "display_name", "telegram_user_id", "email"],
          filters: expect.arrayContaining([
            {
              kind: "in",
              column: "id",
              value: [ADMIN_CONTEXT.adminId],
            },
          ]),
        }),
      ]),
    );
  });

  it("rejects audit log exports without audit export permission before reading tables", async () => {
    requireAdminMock.mockRejectedValue(
      new ApiError(403, "FORBIDDEN", "Missing admin permission"),
    );

    const { default: auditExportHandler } =
      await import("../../api/admin/audit-logs/export");
    const result = await invokeApiHandler(auditExportHandler, {
      method: "POST",
      url: "/api/admin/audit-logs/export",
      body: {
        filters: {},
        reason: "export audit logs in admin test",
      },
    });

    expect(result.statusCode).toBe(403);
    expect(result.body).toMatchObject({
      error: {
        code: "FORBIDDEN",
      },
    });
    expect(getSupabaseAdminClientMock).not.toHaveBeenCalled();
    expect(runWriteRpcMock).not.toHaveBeenCalled();
    expect(requireAdminMock).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        permissions: "audit:export",
      }),
    );
  });

  it("exports filtered audit logs as redacted CSV and writes an export audit log", async () => {
    runWriteRpcMock.mockResolvedValue({
      audit_log_id: "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee",
      admin_user_id: ADMIN_CONTEXT.adminId,
      action: "audit.export",
      target_schema: "ops",
      target_table: "admin_audit_logs",
      created_at: "2026-05-30T10:01:00.000Z",
    });
    const db = createAdminReadDbMock({
      "ops.admin_audit_logs": [
        {
          id: AUDIT_LOG_ID,
          admin_user_id: ADMIN_CONTEXT.adminId,
          action: "feature_flag.update",
          target_schema: "ops",
          target_table: "feature_flags",
          target_id: LOCK_ID,
          before_state: {
            enabled: false,
            service_role_key: "secret-service-role",
          },
          after_state: {
            enabled: true,
            request_context: {
              request_id: "req-audit-export-1",
            },
          },
          ip_hash: "ip-hash",
          user_agent: "user-agent-hash",
          reason: "enable payment gate",
          created_at: "2026-05-30T10:00:00.000Z",
        },
      ],
      "ops.admin_users": [
        {
          id: ADMIN_CONTEXT.adminId,
          display_name: "Ops Admin",
          telegram_user_id: ADMIN_CONTEXT.telegramUserId,
          email: "ops@example.test",
        },
      ],
    });
    getSupabaseAdminClientMock.mockReturnValue(db.client);

    const { default: auditExportHandler } =
      await import("../../api/admin/audit-logs/export");
    const result = await invokeApiHandler<string>(auditExportHandler, {
      method: "POST",
      url: "/api/admin/audit-logs/export",
      headers: {
        "x-forwarded-for": "127.0.0.40",
        "user-agent": "vitest-admin-audit-export",
      },
      body: {
        filters: {
          action: "feature_flag",
          targetSchema: "ops",
          targetTable: "feature_flags",
          riskLevel: "medium",
        },
        reason: "export audit logs in admin test",
      },
    });

    expect(result.statusCode).toBe(200);
    expect(result.headers["content-type"]).toBe("text/csv; charset=utf-8");
    expect(result.headers["x-audit-log-id"]).toBe(
      "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee",
    );
    expect(String(result.body)).toContain("id,created_at,admin_user_id");
    expect(String(result.body)).toContain(AUDIT_LOG_ID);
    expect(String(result.body)).toContain("feature_flag.update");
    expect(String(result.body)).toContain("req-audit-export-1");
    expect(String(result.body)).toContain(
      "object(keys=[redacted_key]|enabled)",
    );
    expect(String(result.body)).not.toContain("secret-service-role");
    expect(String(result.body)).not.toContain("service_role_key");
    expect(requireAdminMock).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        permissions: "audit:export",
      }),
    );
    expect(runWriteRpcMock).toHaveBeenCalledWith(
      expect.objectContaining({
        schema: "api",
        functionName: "admin_write_audit_log",
        args: expect.objectContaining({
          p_admin_user_id: ADMIN_CONTEXT.adminId,
          p_action: "audit.export",
          p_target_schema: "ops",
          p_target_table: "admin_audit_logs",
          p_reason: "export audit logs in admin test",
          p_after_state: expect.objectContaining({
            request_id: expect.any(String),
            format: "csv",
            row_count: 1,
            max_rows: 1000,
            filters: expect.objectContaining({
              action: "feature_flag",
              targetSchema: "ops",
              targetTable: "feature_flags",
              riskLevel: "medium",
            }),
          }),
          p_ip_hash: expect.any(String),
          p_user_agent: expect.any(String),
        }),
      }),
    );
    expect(db.operations).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          schema: "ops",
          table: "admin_audit_logs",
          filters: expect.arrayContaining([
            {
              kind: "ilike",
              column: "action",
              value: "%feature_flag%",
            },
            {
              kind: "eq",
              column: "target_schema",
              value: "ops",
            },
            {
              kind: "eq",
              column: "target_table",
              value: "feature_flags",
            },
          ]),
          range: [0, 1000],
        }),
      ]),
    );
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

  it("returns payment detail with draw, ledger and webhook context", async () => {
    const db = createAdminReadDbMock({
      "payments.star_orders": [
        {
          id: STAR_ORDER_ID,
          user_id: ADMIN_CONTEXT.userId,
          business_type: "gacha_open",
          business_id: DRAW_ORDER_ID,
          status: "failed",
          xtr_amount: 10,
          telegram_invoice_payload: "invoice-admin-detail-test",
          title: "Admin detail payment",
          description: null,
          idempotency_key: "payment-detail-order-idem",
          expires_at: null,
          precheckout_at: null,
          paid_at: "2026-05-29T00:00:00.000Z",
          fulfilled_at: null,
          error_message: "fulfillment failed",
          metadata: {
            error: {
              code: "FULFILLMENT_FAILED",
              requestId: "req-payment-detail-1",
              stack: "stack only for debug admins",
            },
          },
          created_at: "2026-05-29T00:00:00.000Z",
          updated_at: "2026-05-29T00:00:00.000Z",
        },
      ],
      "core.users": [
        {
          id: ADMIN_CONTEXT.userId,
          telegram_user_id: ADMIN_CONTEXT.telegramUserId,
          username: "ops_user",
          first_name: "Ops",
          last_name: "User",
          status: "active",
          risk_score: 0,
          last_seen_at: null,
          last_auth_at: "2026-05-29T00:00:00.000Z",
          created_at: "2026-05-20T00:00:00.000Z",
        },
      ],
      "payments.star_payments": [
        {
          id: PAYMENT_ID,
          star_order_id: STAR_ORDER_ID,
          user_id: ADMIN_CONTEXT.userId,
          telegram_payment_charge_id: "telegram-charge-admin-detail",
          provider_payment_charge_id: null,
          xtr_amount: 10,
          currency: "XTR",
          invoice_payload: "invoice-admin-detail-test",
          paid_at: "2026-05-29T00:00:01.000Z",
          created_at: "2026-05-29T00:00:01.000Z",
          metadata: {},
        },
      ],
      "gacha.draw_orders": [
        {
          id: DRAW_ORDER_ID,
          user_id: ADMIN_CONTEXT.userId,
          box_id: BOX_ID,
          pool_version_id: null,
          payment_star_order_id: STAR_ORDER_ID,
          status: "failed",
          quantity: 1,
          draw_count: 1,
          unit_price_stars: 10,
          discount_bps: 0,
          total_price_stars: 10,
          open_reward_kcoin: 100,
          invoice_payload: "invoice-admin-detail-test",
          paid_at: "2026-05-29T00:00:01.000Z",
          opened_at: null,
          payment_provider: "telegram_stars",
          payment_status: "paid",
          star_amount: 10,
          telegram_invoice_payload: "invoice-admin-detail-test",
          telegram_payment_charge_id: "telegram-charge-admin-detail",
          error_message: "draw failed",
          metadata: {},
          created_at: "2026-05-29T00:00:00.000Z",
          updated_at: "2026-05-29T00:00:02.000Z",
        },
      ],
      "gacha.draw_results": [
        {
          id: DRAW_RESULT_ID,
          draw_order_id: DRAW_ORDER_ID,
          user_id: ADMIN_CONTEXT.userId,
          box_id: BOX_ID,
          pool_version_id: null,
          draw_index: 1,
          drop_pool_item_id: null,
          item_instance_id: ITEM_INSTANCE_ID,
          template_id: "15151515-1515-4151-8151-151515151515",
          form_id: null,
          rarity_code: "N",
          was_pity: false,
          random_roll: 1234,
          metadata: {},
          created_at: "2026-05-29T00:00:03.000Z",
        },
      ],
      "inventory.item_instances": [
        {
          id: ITEM_INSTANCE_ID,
          owner_user_id: ADMIN_CONTEXT.userId,
          template_id: "15151515-1515-4151-8151-151515151515",
          form_id: null,
          serial_no: 1,
          level: 1,
          power: 10,
          status: "owned",
          source_type: "gacha",
          source_id: DRAW_RESULT_ID,
          nft_mint_status: null,
          minted_nft_item_id: null,
          acquired_at: "2026-05-29T00:00:03.000Z",
          created_at: "2026-05-29T00:00:03.000Z",
        },
      ],
      "economy.currency_ledger": [
        {
          id: LEDGER_ID,
          user_id: ADMIN_CONTEXT.userId,
          currency_code: "KCOIN",
          entry_type: "credit",
          amount: 100,
          available_before: 0,
          available_after: 100,
          locked_before: 0,
          locked_after: 0,
          source_type: "gacha_open",
          source_id: DRAW_ORDER_ID,
          source_ref: "invoice-admin-detail-test",
          idempotency_key: "ledger-payment-detail",
          note: "open reward",
          created_at: "2026-05-29T00:00:04.000Z",
        },
      ],
      "economy.user_balances": [
        {
          user_id: ADMIN_CONTEXT.userId,
          currency_code: "KCOIN",
          available_amount: 100,
          locked_amount: 0,
          updated_at: "2026-05-29T00:00:04.000Z",
          created_at: "2026-05-29T00:00:04.000Z",
        },
      ],
      "payments.telegram_webhook_events": [
        {
          id: "16161616-1616-4161-8161-161616161616",
          update_id: 1001,
          event_type: "successful_payment",
          user_id: ADMIN_CONTEXT.userId,
          telegram_user_id: ADMIN_CONTEXT.telegramUserId,
          invoice_payload: "invoice-admin-detail-test",
          process_status: "failed",
          processed_at: null,
          error_message: "fulfillment failed",
          retry_count: 1,
          next_retry_at: null,
          webhook_secret_verified: true,
          status_context: {
            request_id: "req-payment-detail-webhook",
          },
          payload: {
            successful_payment: true,
          },
          processing_duration_ms: 250,
          request_headers_hash: "headers-hash",
          created_at: "2026-05-29T00:00:02.000Z",
        },
      ],
    });
    getSupabaseAdminClientMock.mockReturnValue(db.client);

    const { default: paymentDetailHandler } =
      await import("../../api/admin/payment-detail");
    const result = await invokeApiHandler<ApiSuccessResponse>(
      paymentDetailHandler,
      {
        method: "GET",
        url: `/api/admin/payment-detail?starOrderId=${STAR_ORDER_ID}`,
        query: {
          starOrderId: STAR_ORDER_ID,
        },
      },
    );

    expect(result.statusCode).toBe(200);
    expect(result.body).toMatchObject({
      ok: true,
      data: {
        order: {
          id: STAR_ORDER_ID,
          xtr_amount: 10,
        },
        user: {
          id: ADMIN_CONTEXT.userId,
        },
        payment: {
          id: PAYMENT_ID,
          telegram_payment_charge_id: "telegram-charge-admin-detail",
        },
        drawOrder: {
          id: DRAW_ORDER_ID,
          payment_star_order_id: STAR_ORDER_ID,
        },
        drawResults: [
          {
            id: DRAW_RESULT_ID,
            item_instance_id: ITEM_INSTANCE_ID,
          },
        ],
        itemInstances: [
          {
            id: ITEM_INSTANCE_ID,
          },
        ],
        ledgerEntries: [
          {
            id: LEDGER_ID,
            amount: 100,
          },
        ],
        webhookEvents: [
          {
            event_type: "successful_payment",
            retry_count: 1,
            processing_duration_ms: 250,
          },
        ],
        errorContext: {
          code: "FULFILLMENT_FAILED",
          message: "fulfillment failed",
          requestId: "req-payment-detail-1",
          stack: "stack only for debug admins",
        },
        diagnostics: [
          {
            code: "PAID_NOT_FULFILLED",
            severity: "critical",
            related_id: STAR_ORDER_ID,
          },
        ],
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
              column: "id",
              value: STAR_ORDER_ID,
            },
          ]),
        }),
        expect.objectContaining({
          schema: "economy",
          table: "currency_ledger",
          filters: expect.arrayContaining([
            {
              kind: "in",
              column: "source_id",
              value: expect.arrayContaining([STAR_ORDER_ID, DRAW_ORDER_ID]),
            },
          ]),
        }),
      ]),
    );
  });

  it("returns payment diagnostics for fulfillment integrity anomalies", async () => {
    const duplicateOrderId = "66666666-6666-4666-8666-666666666667";
    const duplicatePaymentId = "77777777-7777-4777-8777-777777777778";
    const db = createAdminReadDbMock({
      "payments.star_orders": [
        {
          id: STAR_ORDER_ID,
          user_id: ADMIN_CONTEXT.userId,
          business_type: "gacha_open",
          business_id: DRAW_ORDER_ID,
          status: "fulfilled",
          xtr_amount: 10,
          telegram_invoice_payload: "invoice-admin-diagnostics-test",
          title: "Admin diagnostics payment",
          description: null,
          idempotency_key: "payment-diagnostics-order-idem",
          expires_at: null,
          precheckout_at: null,
          paid_at: "2026-05-29T00:00:00.000Z",
          fulfilled_at: "2026-05-29T00:00:05.000Z",
          error_message: null,
          metadata: {},
          created_at: "2026-05-29T00:00:00.000Z",
          updated_at: "2026-05-29T00:00:05.000Z",
        },
      ],
      "payments.star_payments": [
        {
          id: PAYMENT_ID,
          star_order_id: STAR_ORDER_ID,
          user_id: ADMIN_CONTEXT.userId,
          telegram_payment_charge_id: "telegram-charge-duplicate",
          provider_payment_charge_id: null,
          xtr_amount: 10,
          currency: "XTR",
          invoice_payload: "invoice-admin-diagnostics-test",
          paid_at: "2026-05-29T00:00:01.000Z",
          created_at: "2026-05-29T00:00:01.000Z",
          metadata: {},
        },
        {
          id: duplicatePaymentId,
          star_order_id: duplicateOrderId,
          user_id: ADMIN_CONTEXT.userId,
          telegram_payment_charge_id: "telegram-charge-duplicate",
          provider_payment_charge_id: null,
          xtr_amount: 10,
          currency: "XTR",
          invoice_payload: "invoice-admin-diagnostics-duplicate",
          paid_at: "2026-05-29T00:00:02.000Z",
          created_at: "2026-05-29T00:00:02.000Z",
          metadata: {},
        },
      ],
      "gacha.draw_orders": [
        {
          id: DRAW_ORDER_ID,
          user_id: ADMIN_CONTEXT.userId,
          box_id: BOX_ID,
          pool_version_id: null,
          payment_star_order_id: STAR_ORDER_ID,
          status: "completed",
          quantity: 10,
          draw_count: 10,
          unit_price_stars: 10,
          discount_bps: 1000,
          total_price_stars: 90,
          open_reward_kcoin: 100,
          invoice_payload: "invoice-admin-diagnostics-test",
          paid_at: "2026-05-29T00:00:01.000Z",
          opened_at: "2026-05-29T00:00:05.000Z",
          payment_provider: "telegram_stars",
          payment_status: "paid",
          star_amount: 90,
          telegram_invoice_payload: "invoice-admin-diagnostics-test",
          telegram_payment_charge_id: "telegram-charge-duplicate",
          error_message: null,
          metadata: {},
          created_at: "2026-05-29T00:00:00.000Z",
          updated_at: "2026-05-29T00:00:05.000Z",
        },
      ],
      "gacha.draw_results": [
        {
          id: DRAW_RESULT_ID,
          draw_order_id: DRAW_ORDER_ID,
          user_id: ADMIN_CONTEXT.userId,
          box_id: BOX_ID,
          pool_version_id: null,
          draw_index: 1,
          drop_pool_item_id: null,
          item_instance_id: ITEM_INSTANCE_ID,
          template_id: "15151515-1515-4151-8151-151515151515",
          form_id: null,
          rarity_code: "N",
          was_pity: false,
          random_roll: 1234,
          metadata: {},
          created_at: "2026-05-29T00:00:03.000Z",
        },
      ],
      "inventory.item_instances": [],
      "economy.currency_ledger": [
        {
          id: LEDGER_ID,
          user_id: ADMIN_CONTEXT.userId,
          currency_code: "KCOIN",
          entry_type: "credit",
          amount: 100,
          available_before: 100,
          available_after: 200,
          locked_before: 0,
          locked_after: 0,
          source_type: "gacha_open",
          source_id: DRAW_ORDER_ID,
          source_ref: "invoice-admin-diagnostics-test",
          idempotency_key: "ledger-payment-diagnostics",
          note: "open reward",
          created_at: "2026-05-29T00:00:04.000Z",
        },
      ],
      "economy.user_balances": [
        {
          user_id: ADMIN_CONTEXT.userId,
          currency_code: "KCOIN",
          available_amount: 150,
          locked_amount: 0,
          updated_at: "2026-05-29T00:00:04.000Z",
          created_at: "2026-05-29T00:00:04.000Z",
        },
      ],
    });
    getSupabaseAdminClientMock.mockReturnValue(db.client);

    const { default: paymentDetailHandler } =
      await import("../../api/admin/payment-detail");
    const result = await invokeApiHandler<ApiSuccessResponse>(
      paymentDetailHandler,
      {
        method: "GET",
        url: `/api/admin/payment-detail?starOrderId=${STAR_ORDER_ID}`,
        query: {
          starOrderId: STAR_ORDER_ID,
        },
      },
    );

    expect(result.statusCode).toBe(200);
    expect(result.body).toMatchObject({
      ok: true,
      data: {
        diagnostics: expect.arrayContaining([
          expect.objectContaining({
            code: "DRAW_RESULTS_COUNT_MISMATCH",
            severity: "critical",
            related_id: DRAW_ORDER_ID,
          }),
          expect.objectContaining({
            code: "DUPLICATE_TELEGRAM_CHARGE_ID",
            severity: "critical",
            related_id: "telegram-charge-duplicate",
          }),
          expect.objectContaining({
            code: "DRAW_RESULT_ITEM_INSTANCE_MISSING",
            severity: "critical",
            related_id: DRAW_RESULT_ID,
          }),
          expect.objectContaining({
            code: "LEDGER_BALANCE_MISMATCH",
            severity: "critical",
            related_id: ADMIN_CONTEXT.userId,
          }),
        ]),
      },
    });
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
      "ops.system_settings": [
        {
          key: "PAYMENT_SUPPORT_CONFIG",
          value: {
            configured: false,
            support_url: null,
            support_email: null,
          },
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
        paymentSupport: {
          configured: false,
          source: "system_settings",
        },
        warnings: [
          expect.objectContaining({
            code: "PAYMENT_SUPPORT_CONFIG_MISSING",
            severity: "warning",
          }),
        ],
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
        expect.objectContaining({
          schema: "ops",
          table: "system_settings",
          filters: expect.arrayContaining([
            expect.objectContaining({
              kind: "eq",
              column: "key",
              value: "PAYMENT_SUPPORT_CONFIG",
            }),
          ]),
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

  it("exposes the required retry-payment-fulfillment path", async () => {
    runWriteRpcMock.mockResolvedValue({
      star_order_id: STAR_ORDER_ID,
      status: "fulfilled",
      previous_status: "failed",
      fulfilled: true,
      audit_log_id: "17171717-1717-4171-8171-171717171717",
    });

    const { default: retryPaymentFulfillmentHandler } =
      await import("../../api/admin/retry-payment-fulfillment");
    const result = await invokeApiHandler<ApiSuccessResponse>(
      retryPaymentFulfillmentHandler,
      {
        method: "POST",
        url: "/api/admin/retry-payment-fulfillment",
        headers: {
          "x-admin-confirm": "true",
          "x-idempotency-key": "admin-retry-payment-fulfillment-test-001",
        },
        body: {
          starOrderId: STAR_ORDER_ID,
          reason: "retry failed fulfillment through required path",
        },
      },
    );

    expect(result.statusCode).toBe(200);
    expect(runWriteRpcMock).toHaveBeenCalledWith(
      expect.objectContaining({
        schema: "api",
        functionName: "admin_retry_payment_fulfillment",
        args: expect.objectContaining({
          p_star_order_id: STAR_ORDER_ID,
          p_reason: "retry failed fulfillment through required path",
          p_idempotency_key: "admin-retry-payment-fulfillment-test-001",
        }),
      }),
    );
  });

  it("calls the admin create refund record RPC with confirmation and idempotency", async () => {
    runWriteRpcMock.mockResolvedValue({
      star_order_id: STAR_ORDER_ID,
      star_payment_id: PAYMENT_ID,
      star_refund_id: "18181818-1818-4181-8181-181818181818",
      status: "processing",
      xtr_amount: 5,
      external_refund_completed: false,
      audit_log_id: "19191919-1919-4191-8191-191919191919",
    });

    const { default: createRefundRecordHandler } =
      await import("../../api/admin/create-refund-record");
    const result = await invokeApiHandler<ApiSuccessResponse>(
      createRefundRecordHandler,
      {
        method: "POST",
        url: "/api/admin/create-refund-record",
        headers: {
          "x-admin-confirm": "true",
          "x-idempotency-key": "admin-create-refund-record-test-001",
          "x-forwarded-for": "127.0.0.22",
          "user-agent": "vitest-admin-refund-record",
        },
        body: {
          starPaymentId: PAYMENT_ID,
          starOrderId: STAR_ORDER_ID,
          reason: "record refund request in admin test",
          xtrAmount: 5,
          status: "processing",
        },
      },
    );

    expect(result.statusCode).toBe(200);
    expect(result.body).toMatchObject({
      ok: true,
      data: {
        star_order_id: STAR_ORDER_ID,
        star_payment_id: PAYMENT_ID,
        status: "processing",
        external_refund_completed: false,
      },
    });
    expect(requireAdminMock).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        permissions: "payments:write",
      }),
    );
    expect(runWriteRpcMock).toHaveBeenCalledWith(
      expect.objectContaining({
        schema: "api",
        functionName: "admin_create_refund_record",
        args: expect.objectContaining({
          p_admin_user_id: ADMIN_CONTEXT.adminId,
          p_star_payment_id: PAYMENT_ID,
          p_star_order_id: STAR_ORDER_ID,
          p_reason: "record refund request in admin test",
          p_xtr_amount: 5,
          p_status: "processing",
          p_idempotency_key: "admin-create-refund-record-test-001",
          p_request_context: expect.objectContaining({
            admin_user_id: ADMIN_CONTEXT.adminId,
            ip_hash: expect.any(String),
            user_agent_hash: expect.any(String),
          }),
          p_approval_context: {},
        }),
      }),
    );
  });

  it("requires confirmation for create-refund-record requests", async () => {
    const { default: createRefundRecordHandler } =
      await import("../../api/admin/create-refund-record");
    const result = await invokeApiHandler(createRefundRecordHandler, {
      method: "POST",
      url: "/api/admin/create-refund-record",
      headers: {
        "x-idempotency-key": "admin-create-refund-record-test-002",
      },
      body: {
        starPaymentId: PAYMENT_ID,
        starOrderId: STAR_ORDER_ID,
        reason: "record refund request in admin test",
        xtrAmount: 5,
        status: "processing",
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

  it("calls the admin resolve payment dispute RPC with confirmation and idempotency", async () => {
    runWriteRpcMock.mockResolvedValue({
      dispute_id: DISPUTE_ID,
      star_order_id: STAR_ORDER_ID,
      star_payment_id: PAYMENT_ID,
      status: "resolved",
      resolution: "refund record created and fulfillment reviewed",
      audit_log_id: "20202020-2020-4020-8020-202020202020",
    });

    const { default: resolveDisputeHandler } =
      await import("../../api/admin/resolve-payment-dispute");
    const result = await invokeApiHandler<ApiSuccessResponse>(
      resolveDisputeHandler,
      {
        method: "PATCH",
        url: "/api/admin/resolve-payment-dispute",
        headers: {
          "x-admin-confirm": "true",
          "x-idempotency-key": "admin-resolve-dispute-test-001",
          "x-forwarded-for": "127.0.0.24",
          "user-agent": "vitest-admin-resolve-dispute",
        },
        body: {
          disputeId: DISPUTE_ID,
          resolution: "refund record created and fulfillment reviewed",
          status: "resolved",
          reason: "resolve payment dispute in admin test",
        },
      },
    );

    expect(result.statusCode).toBe(200);
    expect(result.body).toMatchObject({
      ok: true,
      data: {
        dispute_id: DISPUTE_ID,
        status: "resolved",
      },
    });
    expect(runWriteRpcMock).toHaveBeenCalledWith(
      expect.objectContaining({
        schema: "api",
        functionName: "admin_resolve_payment_dispute",
        args: expect.objectContaining({
          p_admin_user_id: ADMIN_CONTEXT.adminId,
          p_dispute_id: DISPUTE_ID,
          p_resolution: "refund record created and fulfillment reviewed",
          p_status: "resolved",
          p_reason: "resolve payment dispute in admin test",
          p_idempotency_key: "admin-resolve-dispute-test-001",
          p_request_context: expect.objectContaining({
            admin_user_id: ADMIN_CONTEXT.adminId,
            ip_hash: expect.any(String),
            user_agent_hash: expect.any(String),
          }),
          p_approval_context: {},
        }),
      }),
    );
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
      target_schema: "ops",
      target_table: "feature_flags",
      target_id: LOCK_ID,
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
        target_schema: "ops",
        target_table: "feature_flags",
        target_id: LOCK_ID,
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

  it("rejects admin write RPC results that do not return an audit log id", async () => {
    runWriteRpcMock.mockResolvedValue({
      key: "FEATURE_TON_MINT_ENABLED",
      enabled: false,
      previous_enabled: true,
    });

    const { default: featureFlagsHandler } =
      await import("../../api/admin/feature-flags");
    const result = await invokeApiHandler(featureFlagsHandler, {
      method: "PATCH",
      url: "/api/admin/feature-flags",
      headers: {
        "x-admin-confirm": "true",
        "x-idempotency-key": "admin-feature-flag-test-missing-audit",
      },
      body: {
        key: "FEATURE_TON_MINT_ENABLED",
        enabled: false,
        reason: "verify audit id requirement in admin test",
      },
    });

    expect(result.statusCode).toBe(500);
    expect(result.body).toMatchObject({
      error: {
        code: "ADMIN_AUDIT_LOG_REQUIRED",
      },
    });
  });

  it("routes danger operations to dedicated admin RPCs with audit context", async () => {
    const { default: dangerOpsHandler } =
      await import("../../api/admin/danger-ops");
    const cases = [
      {
        idempotencyKey: "admin-danger-compensate-test-001",
        body: {
          action: "compensate_asset",
          userId: CORE_USER_ID,
          currencyCode: "KCOIN",
          amount: 25,
        },
        functionName: "admin_compensate_asset",
        permissions: ["risk:write"],
        args: {
          p_user_id: CORE_USER_ID,
          p_currency_code: "KCOIN",
          p_amount: 25,
        },
      },
      {
        idempotencyKey: "admin-danger-ban-test-001",
        body: {
          action: "ban_user",
          userId: CORE_USER_ID,
          status: "banned",
        },
        functionName: "admin_ban_user",
        permissions: ["users:ban", "risk:write"],
        args: {
          p_user_id: CORE_USER_ID,
          p_status: "banned",
        },
      },
      {
        idempotencyKey: "admin-danger-refund-test-001",
        body: {
          action: "request_refund",
          starOrderId: STAR_ORDER_ID,
        },
        functionName: "admin_request_star_refund",
        permissions: ["payments:write"],
        args: {
          p_star_order_id: STAR_ORDER_ID,
        },
      },
      {
        idempotencyKey: "admin-danger-release-lock-test-001",
        body: {
          action: "release_inventory_lock",
          lockId: LOCK_ID,
        },
        functionName: "admin_release_inventory_lock",
        permissions: ["inventory:write", "risk:write"],
        args: {
          p_lock_id: LOCK_ID,
        },
      },
      {
        idempotencyKey: "admin-danger-drop-pool-test-001",
        body: {
          action: "publish_drop_pool_version",
          boxId: BOX_ID,
          items: [
            {
              templateId: "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
              rarityCode: "N",
              weight: 10000,
              probabilityBps: 10000,
            },
          ],
        },
        functionName: "admin_publish_drop_pool_version",
        permissions: ["gacha:write"],
        args: {
          p_box_id: BOX_ID,
          p_items: expect.arrayContaining([
            expect.objectContaining({
              template_id: "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
              drop_weight: 10000,
              probability_bps: 10000,
            }),
          ]),
        },
      },
    ];

    for (const dangerCase of cases) {
      runWriteRpcMock.mockClear();
      assertAdminPermissionsMock.mockClear();
      runWriteRpcMock.mockResolvedValueOnce({
        accepted: true,
        operation: dangerCase.body.action,
        audit_log_id: AUDIT_LOG_ID,
      });

      const result = await invokeApiHandler<ApiSuccessResponse>(
        dangerOpsHandler,
        {
          method: "POST",
          url: "/api/admin/danger-ops",
          headers: {
            "x-admin-confirm": "true",
            "x-idempotency-key": dangerCase.idempotencyKey,
            "x-forwarded-for": "127.0.0.23",
            "user-agent": "vitest-admin-danger-ops",
          },
          body: {
            ...dangerCase.body,
            reason: "danger operation in admin test",
            approvalContext: {
              approvalStatus: "not_required",
              phase: "phase6_initial",
            },
          },
        },
      );

      expect(result.statusCode).toBe(200);
      expect(result.body).toMatchObject({
        ok: true,
        data: {
          action: dangerCase.body.action,
          accepted: true,
        },
      });
      expect(assertAdminPermissionsMock).toHaveBeenCalledWith(
        ADMIN_CONTEXT,
        expect.objectContaining({
          permissions: dangerCase.permissions,
          requireAll: false,
        }),
      );
      expect(runWriteRpcMock).toHaveBeenCalledWith(
        expect.objectContaining({
          schema: "api",
          functionName: dangerCase.functionName,
          args: expect.objectContaining({
            p_admin_user_id: ADMIN_CONTEXT.adminId,
            p_reason: "danger operation in admin test",
            p_idempotency_key: dangerCase.idempotencyKey,
            p_request_context: expect.objectContaining({
              admin_user_id: ADMIN_CONTEXT.adminId,
              ip_hash: expect.any(String),
              user_agent_hash: expect.any(String),
            }),
            p_approval_context: expect.objectContaining({
              approvalStatus: "not_required",
              phase: "phase6_initial",
            }),
            ...dangerCase.args,
          }),
        }),
      );
    }
  });

  it("requires explicit confirmation for danger operation requests", async () => {
    const { default: dangerOpsHandler } =
      await import("../../api/admin/danger-ops");
    const result = await invokeApiHandler(dangerOpsHandler, {
      method: "POST",
      url: "/api/admin/danger-ops",
      headers: {
        "x-idempotency-key": "admin-danger-confirm-test-001",
      },
      body: {
        action: "ban_user",
        userId: CORE_USER_ID,
        reason: "ban user in admin test",
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
    or: (value: string) => {
      operation.filters.push({ kind: "or", column: "", value });
      return builder;
    },
    not: (column: string, operator: string, value: unknown) => {
      operation.filters.push({ kind: "not", column, operator, value });
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

    if (filter.kind === "not" && filter.operator === "ilike") {
      const pattern = String(filter.value ?? "")
        .replace(/^%/, "")
        .replace(/%$/, "")
        .toLowerCase();

      rows = rows.filter(
        (row) =>
          !String(row[filter.column] ?? "")
            .toLowerCase()
            .includes(pattern),
      );
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
