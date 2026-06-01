import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { type ApiSuccessResponse } from "../../api/_shared/handler";
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
  sessionId: "session-admin-market-price-rules-test",
  userId: "11111111-1111-4111-8111-111111111111",
  telegramUserId: 7001,
  userStatus: "active",
  expiresAt: "2026-06-01T00:00:00.000Z",
  sessionTokenHash: "session-hash",
  adminId: "22222222-2222-4222-8222-222222222222",
  roleId: "33333333-3333-4333-8333-333333333333",
  roleCode: "SUPER_ADMIN",
  isSuperAdmin: true,
  permissions: ["*"],
};

const PRICE_RULE_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const TEMPLATE_ID = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const AUDIT_LOG_ID = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const RISK_EVENT_ID = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";

describe("admin market price rules API", () => {
  beforeEach(() => {
    process.env.NODE_ENV = "test";
    vi.resetModules();
    requireAdminMock.mockReset();
    runReadRpcMock.mockReset();
    runWriteRpcMock.mockReset();
    requireAdminMock.mockResolvedValue(ADMIN_CONTEXT);
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("lists market price rules through the read RPC with market read permission", async () => {
    runReadRpcMock.mockResolvedValueOnce({
      rows: [
        {
          id: PRICE_RULE_ID,
          template_id: TEMPLATE_ID,
          rarity_code: "RARE",
          form_index: 2,
          min_price_kcoin: "100",
          max_price_kcoin: "500",
          suggested_price_kcoin: "250",
          active: true,
          metadata: {
            public_note: "visible",
            private_token: "must-not-leak",
          },
          created_at: "2026-06-01T00:00:00.000Z",
          updated_at: "2026-06-01T00:00:00.000Z",
        },
      ],
      summary: {
        active: 1,
      },
      next_cursor: null,
      server_time: "2026-06-01T12:00:00.000Z",
    });

    const { default: priceRulesHandler } =
      await import("../../api/admin/market/price-rules");
    const result = await invokeApiHandler<ApiSuccessResponse>(
      priceRulesHandler,
      {
        method: "GET",
        url: "/api/admin/market/price-rules?active=true&limit=50&cursor=25",
        query: {
          active: "true",
          limit: "50",
          cursor: "25",
        },
        headers: {
          "x-forwarded-for": "127.0.0.41",
          "user-agent": "vitest-admin-market-price-rules",
        },
      },
    );

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
          p_limit: 50,
          p_cursor: 25,
          p_request_context: expect.objectContaining({
            admin_user_id: ADMIN_CONTEXT.adminId,
            session_id: ADMIN_CONTEXT.sessionId,
          }),
        }),
      }),
    );
    expect(result.body).toMatchObject({
      ok: true,
      data: {
        items: [
          {
            id: PRICE_RULE_ID,
            templateId: TEMPLATE_ID,
            rarityCode: "RARE",
            formIndex: 2,
            minPriceKcoin: 100,
            maxPriceKcoin: 500,
            suggestedPriceKcoin: 250,
            active: true,
            metadata: {
              public_note: "visible",
              private_token: "[redacted]",
            },
          },
        ],
        summary: {
          active: 1,
        },
        nextCursor: null,
        serverTime: "2026-06-01T12:00:00.000Z",
      },
    });
  });

  it("maps market price rule creates to the audited write RPC", async () => {
    runWriteRpcMock.mockResolvedValueOnce({
      audit_log_id: AUDIT_LOG_ID,
      risk_event_id: RISK_EVENT_ID,
      price_rule_id: PRICE_RULE_ID,
      idempotent: false,
      server_time: "2026-06-01T12:05:00.000Z",
    });

    const { default: priceRulesHandler } =
      await import("../../api/admin/market/price-rules");
    const result = await invokeApiHandler<ApiSuccessResponse>(
      priceRulesHandler,
      {
        method: "POST",
        url: "/api/admin/market/price-rules",
        headers: {
          "x-admin-confirm": "true",
          "x-idempotency-key": "admin-market-price-rule-create-001",
          "x-forwarded-for": "127.0.0.42",
          "user-agent": "vitest-admin-market-price-rules",
        },
        body: {
          template_id: TEMPLATE_ID,
          rarity_code: "rare",
          form_index: 2,
          min_price_kcoin: 100,
          max_price_kcoin: 500,
          suggested_price_kcoin: 250,
          active: true,
          metadata: { source: "ops" },
          reason: "configure rare form price range",
          confirm: true,
        },
      },
    );

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
        functionName: "admin_upsert_market_price_rule",
        args: expect.objectContaining({
          p_admin_user_id: ADMIN_CONTEXT.adminId,
          p_price_rule_id: null,
          p_template_id: TEMPLATE_ID,
          p_rarity_code: "RARE",
          p_form_index: 2,
          p_min_price_kcoin: 100,
          p_max_price_kcoin: 500,
          p_suggested_price_kcoin: 250,
          p_active: true,
          p_metadata: { source: "ops" },
          p_reason: "configure rare form price range",
          p_idempotency_key: "admin-market-price-rule-create-001",
          p_request_context: expect.objectContaining({
            admin_user_id: ADMIN_CONTEXT.adminId,
            session_id: ADMIN_CONTEXT.sessionId,
          }),
        }),
      }),
    );
    expect(result.body).toMatchObject({
      data: {
        audit_log_id: AUDIT_LOG_ID,
        risk_event_id: RISK_EVENT_ID,
        price_rule_id: PRICE_RULE_ID,
        serverTime: "2026-06-01T12:05:00.000Z",
      },
    });
  });

  it("maps market price rule patches with id to the same write RPC", async () => {
    runWriteRpcMock.mockResolvedValueOnce({
      audit_log_id: AUDIT_LOG_ID,
      risk_event_id: RISK_EVENT_ID,
      price_rule_id: PRICE_RULE_ID,
      idempotent: false,
    });

    const { default: priceRulesHandler } =
      await import("../../api/admin/market/price-rules");
    const result = await invokeApiHandler<ApiSuccessResponse>(
      priceRulesHandler,
      {
        method: "PATCH",
        url: "/api/admin/market/price-rules",
        headers: {
          "x-admin-confirm": "true",
          "x-idempotency-key": "admin-market-price-rule-patch-001",
        },
        body: {
          id: PRICE_RULE_ID,
          templateId: TEMPLATE_ID,
          rarityCode: "RARE",
          formIndex: 2,
          minPriceKcoin: 120,
          maxPriceKcoin: 520,
          suggestedPriceKcoin: 260,
          active: false,
          metadata: {},
          reason: "pause rare price range",
          confirm: true,
        },
      },
    );

    expect(result.statusCode).toBe(200);
    expect(runWriteRpcMock).toHaveBeenCalledWith(
      expect.objectContaining({
        functionName: "admin_upsert_market_price_rule",
        args: expect.objectContaining({
          p_price_rule_id: PRICE_RULE_ID,
          p_min_price_kcoin: 120,
          p_active: false,
          p_reason: "pause rare price range",
          p_idempotency_key: "admin-market-price-rule-patch-001",
        }),
      }),
    );
  });

  it("rejects market price rule writes without confirmation before calling RPC", async () => {
    const { default: priceRulesHandler } =
      await import("../../api/admin/market/price-rules");
    const result = await invokeApiHandler(priceRulesHandler, {
      method: "POST",
      url: "/api/admin/market/price-rules",
      headers: {
        "x-idempotency-key": "admin-market-price-rule-missing-confirm-001",
      },
      body: {
        min_price_kcoin: 100,
        active: true,
        reason: "missing confirmation",
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

  it("rejects invalid price ranges before calling RPC", async () => {
    const { default: priceRulesHandler } =
      await import("../../api/admin/market/price-rules");
    const result = await invokeApiHandler(priceRulesHandler, {
      method: "POST",
      url: "/api/admin/market/price-rules",
      headers: {
        "x-admin-confirm": "true",
        "x-idempotency-key": "admin-market-price-rule-invalid-range-001",
      },
      body: {
        min_price_kcoin: 500,
        max_price_kcoin: 100,
        suggested_price_kcoin: 250,
        active: true,
        reason: "invalid range",
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

  it("rejects market price rule writes without reason before calling RPC", async () => {
    const { default: priceRulesHandler } =
      await import("../../api/admin/market/price-rules");
    const result = await invokeApiHandler(priceRulesHandler, {
      method: "POST",
      url: "/api/admin/market/price-rules",
      headers: {
        "x-admin-confirm": "true",
        "x-idempotency-key": "admin-market-price-rule-missing-reason-001",
      },
      body: {
        min_price_kcoin: 100,
        max_price_kcoin: 500,
        suggested_price_kcoin: 250,
        active: true,
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

  it("rejects market price rule writes without idempotency before calling RPC", async () => {
    const { default: priceRulesHandler } =
      await import("../../api/admin/market/price-rules");
    const result = await invokeApiHandler(priceRulesHandler, {
      method: "POST",
      url: "/api/admin/market/price-rules",
      headers: {
        "x-admin-confirm": "true",
      },
      body: {
        min_price_kcoin: 100,
        max_price_kcoin: 500,
        suggested_price_kcoin: 250,
        active: true,
        reason: "missing idempotency",
        confirm: true,
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

  it("requires id for PATCH before calling RPC", async () => {
    const { default: priceRulesHandler } =
      await import("../../api/admin/market/price-rules");
    const result = await invokeApiHandler(priceRulesHandler, {
      method: "PATCH",
      url: "/api/admin/market/price-rules",
      headers: {
        "x-admin-confirm": "true",
        "x-idempotency-key": "admin-market-price-rule-missing-id-001",
      },
      body: {
        min_price_kcoin: 100,
        max_price_kcoin: 500,
        suggested_price_kcoin: 250,
        active: true,
        reason: "missing id",
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

  it("requires audited write RPC results", async () => {
    runWriteRpcMock.mockResolvedValueOnce({
      price_rule_id: PRICE_RULE_ID,
    });

    const { default: priceRulesHandler } =
      await import("../../api/admin/market/price-rules");
    const result = await invokeApiHandler(priceRulesHandler, {
      method: "POST",
      url: "/api/admin/market/price-rules",
      headers: {
        "x-admin-confirm": "true",
        "x-idempotency-key": "admin-market-price-rule-no-audit-001",
      },
      body: {
        min_price_kcoin: 100,
        max_price_kcoin: 500,
        suggested_price_kcoin: 250,
        active: true,
        reason: "audit missing from rpc",
        confirm: true,
      },
    });

    expect(result.statusCode).toBe(500);
    expect(result.body).toMatchObject({
      error: {
        code: "ADMIN_AUDIT_LOG_REQUIRED",
      },
    });
  });

  it("requires risk event write RPC results", async () => {
    runWriteRpcMock.mockResolvedValueOnce({
      audit_log_id: AUDIT_LOG_ID,
      price_rule_id: PRICE_RULE_ID,
    });

    const { default: priceRulesHandler } =
      await import("../../api/admin/market/price-rules");
    const result = await invokeApiHandler(priceRulesHandler, {
      method: "POST",
      url: "/api/admin/market/price-rules",
      headers: {
        "x-admin-confirm": "true",
        "x-idempotency-key": "admin-market-price-rule-no-risk-001",
      },
      body: {
        min_price_kcoin: 100,
        max_price_kcoin: 500,
        suggested_price_kcoin: 250,
        active: true,
        reason: "risk event missing from rpc",
        confirm: true,
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
