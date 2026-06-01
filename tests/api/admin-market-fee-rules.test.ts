import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  type ApiErrorResponse,
  type ApiSuccessResponse,
} from "../../api/_shared/handler";
import { invokeApiHandler } from "./_utils";

const { requireAdminMock, runReadRpcMock, runWriteRpcMock } = vi.hoisted(
  () => ({
    requireAdminMock: vi.fn(),
    runReadRpcMock: vi.fn(),
    runWriteRpcMock: vi.fn(),
  }),
);

vi.mock("../../api/_shared/requireAdmin.js", () => ({
  requireAdmin: requireAdminMock,
}));

vi.mock("../../packages/server/src/db/transactions.js", () => ({
  runReadRpc: runReadRpcMock,
  runWriteRpc: runWriteRpcMock,
}));

const ADMIN_CONTEXT = {
  sessionId: "session-admin-market-fee-rules-test",
  userId: "11111111-1111-4111-8111-111111111111",
  telegramUserId: 7001,
  userStatus: "active",
  expiresAt: "2026-06-01T00:00:00.000Z",
  sessionTokenHash: "session-hash",
  adminId: "22222222-2222-4222-8222-222222222222",
  roleId: "33333333-3333-4333-8333-333333333333",
  roleCode: "OPS",
  isSuperAdmin: false,
  permissions: ["market:read", "market:write"],
};

const FEE_RULE_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const AUDIT_LOG_ID = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const RISK_EVENT_ID = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";

describe("admin market fee-rules API", () => {
  beforeEach(() => {
    process.env.NODE_ENV = "test";
    vi.resetModules();
    requireAdminMock.mockReset();
    runReadRpcMock.mockReset();
    runWriteRpcMock.mockReset();
    requireAdminMock.mockResolvedValue(ADMIN_CONTEXT);
  });

  it("lists market sell fee rules from the price-rules facade", async () => {
    runReadRpcMock.mockResolvedValueOnce({
      feeRules: [
        {
          id: FEE_RULE_ID,
          code: "MARKET_SELL_FEE",
          fee_type: "market_sell",
          currency_code: "KCOIN",
          fee_bps: 500,
          min_fee: "0",
          max_fee: null,
          active: true,
          starts_at: null,
          ends_at: null,
          metadata: {
            note: "visible",
            service_role_key: "must-not-leak",
          },
          created_at: "2026-06-01T00:00:00.000Z",
          updated_at: "2026-06-01T00:00:00.000Z",
        },
      ],
      next_cursor: null,
      server_time: "2026-06-01T12:00:00.000Z",
    });

    const { default: handler } =
      await import("../../api/admin/market/fee-rules");
    const result = await invokeApiHandler<ApiSuccessResponse>(handler, {
      method: "GET",
      url: "/api/admin/market/fee-rules?active=true&limit=20",
      query: {
        active: "true",
        limit: "20",
      },
    });

    expect(result.statusCode).toBe(200);
    expect(requireAdminMock).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        permissions: ["market:read", "admin:read"],
        requireAll: false,
      }),
    );
    expect(runReadRpcMock).toHaveBeenCalledWith(
      expect.objectContaining({
        schema: "api",
        functionName: "admin_list_market_price_rules",
        args: expect.objectContaining({
          p_admin_user_id: ADMIN_CONTEXT.adminId,
          p_active: true,
          p_limit: 20,
          p_cursor: 0,
        }),
      }),
    );
    expect(result.body).toMatchObject({
      ok: true,
      data: {
        items: [
          {
            id: FEE_RULE_ID,
            code: "MARKET_SELL_FEE",
            feeType: "market_sell",
            currencyCode: "KCOIN",
            feeBps: 500,
            metadata: {
              note: "visible",
              service_role_key: "[redacted]",
            },
          },
        ],
        nextCursor: null,
      },
    });
    expect(JSON.stringify(result.body)).not.toContain("must-not-leak");
  });

  it("maps fee rule writes to the audited admin RPC", async () => {
    runWriteRpcMock.mockResolvedValueOnce({
      fee_rule_id: FEE_RULE_ID,
      audit_log_id: AUDIT_LOG_ID,
      risk_event_id: RISK_EVENT_ID,
      idempotent: false,
      server_time: "2026-06-01T12:10:00.000Z",
    });

    const { default: handler } =
      await import("../../api/admin/market/fee-rules");
    const result = await invokeApiHandler<ApiSuccessResponse>(handler, {
      method: "POST",
      url: "/api/admin/market/fee-rules",
      headers: {
        "x-admin-confirm": "true",
        "x-idempotency-key": "admin-market-fee-rule-upsert-001",
      },
      body: {
        code: "MARKET_SELL_FEE",
        feeBps: 750,
        minFee: 0,
        maxFee: 1000,
        active: true,
        startsAt: "2026-06-01T12:00:00.000Z",
        metadata: {
          source: "market ops",
        },
        reason: "adjust market sell fee",
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
        functionName: "admin_upsert_market_fee_rule",
        args: expect.objectContaining({
          p_admin_user_id: ADMIN_CONTEXT.adminId,
          p_fee_rule_id: null,
          p_code: "MARKET_SELL_FEE",
          p_fee_type: "market_sell",
          p_currency_code: "KCOIN",
          p_fee_bps: 750,
          p_min_fee: 0,
          p_max_fee: 1000,
          p_active: true,
          p_starts_at: "2026-06-01T12:00:00.000Z",
          p_ends_at: null,
          p_metadata: { source: "market ops" },
          p_reason: "adjust market sell fee",
          p_idempotency_key: "admin-market-fee-rule-upsert-001",
        }),
      }),
    );
    expect(result.body).toMatchObject({
      data: {
        fee_rule_id: FEE_RULE_ID,
        audit_log_id: AUDIT_LOG_ID,
        risk_event_id: RISK_EVENT_ID,
        serverTime: "2026-06-01T12:10:00.000Z",
      },
    });
  });

  it("rejects unsafe fee rule writes before calling RPC", async () => {
    const { default: handler } =
      await import("../../api/admin/market/fee-rules");

    const bodyOnlyConfirmResult = await invokeApiHandler<ApiErrorResponse>(
      handler,
      {
        method: "POST",
        url: "/api/admin/market/fee-rules",
        headers: {
          "x-idempotency-key": "admin-market-fee-rule-upsert-002",
        },
        body: {
          feeBps: 750,
          active: true,
          reason: "body confirm is not enough",
          confirm: true,
        },
      },
    );

    expect(bodyOnlyConfirmResult.statusCode).toBe(400);
    expect(bodyOnlyConfirmResult.body.error.code).toBe(
      "ADMIN_CONFIRMATION_REQUIRED",
    );

    const invalidBpsResult = await invokeApiHandler<ApiErrorResponse>(handler, {
      method: "POST",
      url: "/api/admin/market/fee-rules",
      headers: {
        "x-admin-confirm": "true",
        "x-idempotency-key": "admin-market-fee-rule-upsert-003",
      },
      body: {
        feeBps: 3001,
        active: true,
        reason: "invalid bps",
      },
    });

    expect(invalidBpsResult.statusCode).toBe(400);
    expect(invalidBpsResult.body.error.code).toBe("VALIDATION_FAILED");
    expect(runWriteRpcMock).not.toHaveBeenCalled();
  });
});
