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
  sessionId: "session-admin-market-health-rules-test",
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

const HEALTH_RULE_ID = "44444444-4444-4444-8444-444444444444";
const TEMPLATE_ID = "55555555-5555-4555-8555-555555555555";
const FORM_ID = "99999999-9999-4999-8999-999999999999";
const AUDIT_LOG_ID = "66666666-6666-4666-8666-666666666666";
const RISK_EVENT_ID = "77777777-7777-4777-8777-777777777777";

describe("admin market health-rules API", () => {
  beforeEach(() => {
    process.env.NODE_ENV = "test";
    vi.resetModules();
    requireAdminMock.mockReset();
    runReadRpcMock.mockReset();
    runWriteRpcMock.mockReset();
    requireAdminMock.mockResolvedValue(ADMIN_CONTEXT);
  });

  it("lists market price health rules through the api RPC facade", async () => {
    runReadRpcMock.mockResolvedValueOnce({
      rows: [
        {
          id: HEALTH_RULE_ID,
          rarity_code: "RARE",
          template_id: TEMPLATE_ID,
          form_id: FORM_ID,
          form_index: 1,
          form_name: "Gold",
          min_ratio_to_floor: "0.7000",
          max_ratio_to_floor: "1.3000",
          active: false,
          metadata: {
            note: "rare override",
            service_role_key: "must-not-leak",
          },
          created_at: "2026-06-01T07:00:00.000Z",
          updated_at: "2026-06-01T07:30:00.000Z",
        },
        {
          id: "88888888-8888-4888-8888-888888888888",
          rarity_code: "EPIC",
          template_id: null,
          min_ratio_to_floor: "0.6500",
          max_ratio_to_floor: "1.4000",
          active: true,
          metadata: {},
          created_at: "2026-06-01T08:00:00.000Z",
          updated_at: "2026-06-01T08:30:00.000Z",
        },
      ],
      server_time: "2026-06-01T12:00:00.000Z",
    });

    const { default: handler } =
      await import("../../api/admin/market/health-rules");
    const result = await invokeApiHandler<ApiSuccessResponse>(handler, {
      method: "GET",
      url: `/api/admin/market/health-rules?active=false&rarityCode=rare&templateId=${TEMPLATE_ID}&formId=${FORM_ID}&limit=1&cursor=7`,
      headers: {
        "x-request-id": "req-admin-market-health-rules-list",
        "x-forwarded-for": "203.0.113.23",
        "user-agent": "vitest-admin-market-health-rules",
      },
      query: {
        active: "false",
        rarityCode: "rare",
        templateId: TEMPLATE_ID,
        formId: FORM_ID,
        limit: "1",
        cursor: "7",
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
        functionName: "admin_list_market_health_rules",
        args: expect.objectContaining({
          p_admin_user_id: ADMIN_CONTEXT.adminId,
          p_active: false,
          p_rarity_code: "RARE",
          p_template_id: TEMPLATE_ID,
          p_form_id: FORM_ID,
          p_limit: 1,
          p_cursor: 7,
          p_request_context: expect.objectContaining({
            request_id: "req-admin-market-health-rules-list",
            admin_user_id: ADMIN_CONTEXT.adminId,
            session_id: ADMIN_CONTEXT.sessionId,
          }),
        }),
        traceId: "req-admin-market-health-rules-list",
        label: "admin_list_market_health_rules",
      }),
    );
    expect(result.body).toMatchObject({
      ok: true,
      data: {
        items: [
          {
            id: HEALTH_RULE_ID,
            rarityCode: "RARE",
            templateId: TEMPLATE_ID,
            formId: FORM_ID,
            formIndex: 1,
            formName: "Gold",
            minRatioToFloor: "0.7000",
            maxRatioToFloor: "1.3000",
            active: false,
            metadata: {
              note: "rare override",
              service_role_key: "[redacted]",
            },
            createdAt: "2026-06-01T07:00:00.000Z",
            updatedAt: "2026-06-01T07:30:00.000Z",
          },
        ],
        nextCursor: "8",
        serverTime: "2026-06-01T12:00:00.000Z",
      },
    });
    expect(JSON.stringify(result.body)).not.toContain("must-not-leak");
  });

  it("maps bps writes to the audited and risk-recording upsert RPC", async () => {
    runWriteRpcMock.mockResolvedValueOnce({
      health_rule_id: HEALTH_RULE_ID,
      audit_log_id: AUDIT_LOG_ID,
      risk_event_id: RISK_EVENT_ID,
      rule: {
        id: HEALTH_RULE_ID,
        rarity_code: "RARE",
        template_id: TEMPLATE_ID,
        form_id: FORM_ID,
        min_ratio_to_floor: "0.7000",
        max_ratio_to_floor: "1.3000",
        active: true,
        metadata: {
          source: "market ops",
        },
        created_at: "2026-06-01T07:00:00.000Z",
        updated_at: "2026-06-01T07:30:00.000Z",
      },
      server_time: "2026-06-01T12:00:00.000Z",
    });

    const { default: handler } =
      await import("../../api/admin/market/health-rules");
    const result = await invokeApiHandler<ApiSuccessResponse>(handler, {
      method: "POST",
      url: "/api/admin/market/health-rules",
      headers: {
        "x-admin-confirm": "true",
        "x-idempotency-key": "admin-market-health-rule-upsert-test-001",
        "x-forwarded-for": "203.0.113.24",
        "user-agent": "vitest-admin-market-health-rules",
      },
      body: {
        rarityCode: "rare",
        templateId: TEMPLATE_ID,
        formId: FORM_ID,
        lowBps: 7000,
        highBps: 13000,
        active: true,
        metadata: {
          source: "market ops",
        },
        reason: "configure RARE market health thresholds",
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
        functionName: "admin_upsert_market_health_rule",
        args: expect.objectContaining({
          p_admin_user_id: ADMIN_CONTEXT.adminId,
          p_health_rule_id: null,
          p_rarity_code: "RARE",
          p_template_id: TEMPLATE_ID,
          p_form_id: FORM_ID,
          p_min_ratio_to_floor: 0.7,
          p_max_ratio_to_floor: 1.3,
          p_active: true,
          p_metadata: {
            source: "market ops",
          },
          p_reason: "configure RARE market health thresholds",
          p_idempotency_key: "admin-market-health-rule-upsert-test-001",
          p_request_context: expect.objectContaining({
            admin_user_id: ADMIN_CONTEXT.adminId,
            ip_hash: expect.any(String),
            user_agent_hash: expect.any(String),
          }),
        }),
      }),
    );
    expect(result.body).toMatchObject({
      ok: true,
      data: {
        health_rule_id: HEALTH_RULE_ID,
        audit_log_id: AUDIT_LOG_ID,
        risk_event_id: RISK_EVENT_ID,
        rule: {
          id: HEALTH_RULE_ID,
          rarityCode: "RARE",
          templateId: TEMPLATE_ID,
          formId: FORM_ID,
          minRatioToFloor: "0.7000",
          maxRatioToFloor: "1.3000",
        },
        serverTime: "2026-06-01T12:00:00.000Z",
      },
    });
  });

  it("maps PATCH ratio writes and requires a health rule id", async () => {
    runWriteRpcMock.mockResolvedValueOnce({
      health_rule_id: HEALTH_RULE_ID,
      audit_log_id: AUDIT_LOG_ID,
      risk_event_id: RISK_EVENT_ID,
      rule: {
        id: HEALTH_RULE_ID,
        rarityCode: "LEGENDARY",
        minRatioToFloor: 0.6,
        maxRatioToFloor: 1.5,
        active: false,
        metadata: {},
      },
    });

    const { default: handler } =
      await import("../../api/admin/market/health-rules");

    const missingIdResult = await invokeApiHandler<ApiErrorResponse>(handler, {
      method: "PATCH",
      url: "/api/admin/market/health-rules",
      headers: {
        "x-admin-confirm": "true",
        "x-idempotency-key": "admin-market-health-rule-upsert-test-002",
      },
      body: {
        rarityCode: "legendary",
        minRatioToFloor: 0.6,
        maxRatioToFloor: 1.5,
        active: false,
        reason: "missing health rule id",
      },
    });

    expect(missingIdResult.statusCode).toBe(400);
    expect(runWriteRpcMock).not.toHaveBeenCalled();

    const result = await invokeApiHandler<ApiSuccessResponse>(handler, {
      method: "PATCH",
      url: "/api/admin/market/health-rules",
      headers: {
        "x-admin-confirm": "true",
        "x-idempotency-key": "admin-market-health-rule-upsert-test-003",
      },
      body: {
        healthRuleId: HEALTH_RULE_ID,
        rarityCode: "legendary",
        minRatioToFloor: 0.6,
        maxRatioToFloor: 1.5,
        active: false,
        reason: "tighten LEGENDARY market health thresholds",
      },
    });

    expect(result.statusCode).toBe(200);
    expect(runWriteRpcMock).toHaveBeenCalledTimes(1);
    expect(runWriteRpcMock).toHaveBeenCalledWith(
      expect.objectContaining({
        functionName: "admin_upsert_market_health_rule",
        args: expect.objectContaining({
          p_health_rule_id: HEALTH_RULE_ID,
          p_rarity_code: "LEGENDARY",
          p_min_ratio_to_floor: 0.6,
          p_max_ratio_to_floor: 1.5,
          p_active: false,
          p_idempotency_key: "admin-market-health-rule-upsert-test-003",
        }),
      }),
    );
  });

  it("requires confirmation and idempotency headers for writes", async () => {
    const { default: handler } =
      await import("../../api/admin/market/health-rules");

    const bodyOnlyConfirmResult = await invokeApiHandler<ApiErrorResponse>(
      handler,
      {
        method: "POST",
        url: "/api/admin/market/health-rules",
        headers: {
          "x-idempotency-key": "admin-market-health-rule-upsert-test-004",
        },
        body: {
          rarityCode: "rare",
          lowBps: 7000,
          highBps: 13000,
          active: true,
          reason: "body confirm is not enough",
          confirm: true,
        },
      },
    );

    expect(bodyOnlyConfirmResult.statusCode).toBe(400);
    expect(bodyOnlyConfirmResult.body).toMatchObject({
      error: {
        code: "ADMIN_CONFIRMATION_REQUIRED",
      },
    });

    const bodyOnlyIdempotencyResult = await invokeApiHandler<ApiErrorResponse>(
      handler,
      {
        method: "POST",
        url: "/api/admin/market/health-rules",
        headers: {
          "x-admin-confirm": "true",
        },
        body: {
          rarityCode: "rare",
          lowBps: 7000,
          highBps: 13000,
          active: true,
          reason: "body idempotency is not enough",
          idempotencyKey: "body-only-idempotency-key",
        },
      },
    );

    expect(bodyOnlyIdempotencyResult.statusCode).toBe(400);
    expect(bodyOnlyIdempotencyResult.body).toMatchObject({
      error: {
        code: "IDEMPOTENCY_KEY_REQUIRED",
      },
    });
    expect(runWriteRpcMock).not.toHaveBeenCalled();
  });

  it("rejects invalid health thresholds before calling RPC", async () => {
    const { default: handler } =
      await import("../../api/admin/market/health-rules");
    const result = await invokeApiHandler<ApiErrorResponse>(handler, {
      method: "POST",
      url: "/api/admin/market/health-rules",
      headers: {
        "x-admin-confirm": "true",
        "x-idempotency-key": "admin-market-health-rule-upsert-test-005",
      },
      body: {
        rarityCode: "rare",
        lowBps: 10000,
        highBps: 13000,
        active: true,
        reason: "low bps cannot equal floor",
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

  it("fails closed when the write RPC does not return audit or risk ids", async () => {
    runWriteRpcMock.mockResolvedValueOnce({
      risk_event_id: RISK_EVENT_ID,
    });

    const { default: handler } =
      await import("../../api/admin/market/health-rules");
    const missingAuditResult = await invokeApiHandler<ApiErrorResponse>(
      handler,
      {
        method: "POST",
        url: "/api/admin/market/health-rules",
        headers: {
          "x-admin-confirm": "true",
          "x-idempotency-key": "admin-market-health-rule-upsert-test-006",
        },
        body: {
          rarityCode: "rare",
          lowBps: 7000,
          highBps: 13000,
          active: true,
          reason: "audit id is required",
        },
      },
    );

    expect(missingAuditResult.statusCode).toBe(500);
    expect(missingAuditResult.body).toMatchObject({
      error: {
        code: "ADMIN_AUDIT_LOG_REQUIRED",
      },
    });

    runWriteRpcMock.mockResolvedValueOnce({
      audit_log_id: AUDIT_LOG_ID,
    });

    const missingRiskResult = await invokeApiHandler<ApiErrorResponse>(
      handler,
      {
        method: "POST",
        url: "/api/admin/market/health-rules",
        headers: {
          "x-admin-confirm": "true",
          "x-idempotency-key": "admin-market-health-rule-upsert-test-007",
        },
        body: {
          rarityCode: "rare",
          lowBps: 7000,
          highBps: 13000,
          active: true,
          reason: "risk id is required",
        },
      },
    );

    expect(missingRiskResult.statusCode).toBe(500);
    expect(missingRiskResult.body).toMatchObject({
      error: {
        code: "ADMIN_RISK_EVENT_REQUIRED",
      },
    });
  });
});
