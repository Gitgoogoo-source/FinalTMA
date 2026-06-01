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
  sessionId: "session-admin-config-test",
  userId: "11111111-1111-4111-8111-111111111111",
  telegramUserId: 7001,
  userStatus: "active",
  expiresAt: "2026-05-31T00:00:00.000Z",
  sessionTokenHash: "session-hash",
  adminId: "22222222-2222-4222-8222-222222222222",
  roleId: "33333333-3333-4333-8333-333333333333",
  roleCode: "SUPER_ADMIN",
  isSuperAdmin: true,
  permissions: ["*"],
};

const CAMPAIGN_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const BOX_ID = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const PRICE_RULE_ID = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const ACTIVE_VERSION_ID = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
const AUDIT_LOG_ID = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee";
const TEMPLATE_ID = "99999999-9999-4999-8999-999999999999";
const FORM_ID = "99999999-9999-4999-8999-999999999998";
const BOOK_ID = "77777777-7777-4777-8777-777777777777";
const MILESTONE_ID = "66666666-6666-4666-8666-666666666666";

type AdminQueryOperation = {
  schema: string;
  table: string;
  selectedColumns: string[] | null;
  filters: Array<{
    kind: "eq" | "in" | "or";
    column: string;
    value: unknown;
  }>;
  range: [number, number] | null;
};

type AdminTableRows = Record<string, Array<Record<string, unknown>>>;

describe("admin campaign and blind box config APIs", () => {
  beforeEach(() => {
    process.env.NODE_ENV = "test";
    vi.stubEnv("PAYMENT_SUPPORT_URL", "");
    vi.stubEnv("PAYMENT_SUPPORT_EMAIL", "");
    vi.resetModules();
    getSupabaseAdminClientMock.mockReset();
    requireAdminMock.mockReset();
    runReadRpcMock.mockReset();
    runWriteRpcMock.mockReset();
    requireAdminMock.mockResolvedValue(ADMIN_CONTEXT);
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it("lists banner campaigns with campaign read permission and redacted metadata", async () => {
    const db = createAdminReadDbMock({
      "catalog.banner_campaigns": [
        {
          id: CAMPAIGN_ID,
          code: "home_launch",
          title: "Home Launch",
          description: null,
          image_url: "/storage/v1/object/public/banners/banner.png",
          placement: "home_top",
          target_type: "none",
          target_ref: null,
          target_payload: {},
          status: "active",
          starts_at: "2026-05-31T00:00:00.000Z",
          ends_at: "2026-06-30T00:00:00.000Z",
          sort_order: 10,
          metadata: {
            public_note: "visible",
            private_token: "must-not-leak",
          },
          created_at: "2026-05-31T00:00:00.000Z",
          updated_at: "2026-05-31T00:00:00.000Z",
        },
      ],
    });
    getSupabaseAdminClientMock.mockReturnValue(db.client);

    const { default: campaignsHandler } =
      await import("../../api/admin/campaigns");
    const result = await invokeApiHandler<ApiSuccessResponse>(
      campaignsHandler,
      {
        method: "GET",
        url: "/api/admin/campaigns?placement=home_top",
        query: {
          placement: "home_top",
        },
      },
    );

    expect(result.statusCode).toBe(200);
    expect(requireAdminMock).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        permissions: ["campaigns:read", "catalog:read", "admin:read"],
        requireAll: false,
      }),
    );
    expect(result.body).toMatchObject({
      ok: true,
      data: {
        items: [
          {
            id: CAMPAIGN_ID,
            metadata: {
              public_note: "visible",
              private_token: "[redacted]",
            },
            target_payload: {},
          },
        ],
        summary: {
          active: 1,
        },
      },
    });
  });

  it("maps campaign writes to the planned admin banner campaign RPC", async () => {
    runWriteRpcMock.mockResolvedValueOnce({
      audit_log_id: AUDIT_LOG_ID,
      campaign_id: CAMPAIGN_ID,
    });

    const { default: campaignsHandler } =
      await import("../../api/admin/campaigns");
    const result = await invokeApiHandler<ApiSuccessResponse>(
      campaignsHandler,
      {
        method: "POST",
        url: "/api/admin/campaigns",
        headers: {
          "x-admin-confirm": "true",
          "x-idempotency-key": "admin-upsert-campaign-test-001",
        },
        body: {
          code: "home_launch",
          title: "Home Launch",
          image_url: "/storage/v1/object/public/banners/banner.png",
          placement: "home_top",
          target_type: "none",
          target_payload: {},
          status: "draft",
          starts_at: "2026-06-01T00:00:00.000Z",
          ends_at: "2026-06-30T00:00:00.000Z",
          sort_order: 10,
          metadata: { channel: "home_top" },
          reason: "configure home banner",
          confirm: true,
        },
      },
    );

    expect(result.statusCode).toBe(200);
    expect(runWriteRpcMock).toHaveBeenCalledWith(
      expect.objectContaining({
        schema: "api",
        functionName: "admin_upsert_banner_campaign",
        args: expect.objectContaining({
          p_admin_user_id: ADMIN_CONTEXT.adminId,
          p_banner_campaign_id: null,
          p_code: "home_launch",
          p_image_url: "/storage/v1/object/public/banners/banner.png",
          p_placement: "home_top",
          p_target_type: "none",
          p_target_payload: {},
          p_status: "draft",
          p_reason: "configure home banner",
          p_idempotency_key: "admin-upsert-campaign-test-001",
        }),
      }),
    );
  });

  it("lists collectible templates with catalog read permission", async () => {
    const db = createAdminReadDbMock({
      "catalog.collectible_templates": [
        {
          id: TEMPLATE_ID,
          slug: "forest_sproutling",
          display_name: "Forest Sproutling",
          subtitle: null,
          description: null,
          rarity_code: "COMMON",
          type_code: "CHARACTER",
          series_id: null,
          faction_id: null,
          base_power: 10,
          max_level: 10,
          supply_limit: null,
          release_status: "active",
          tradeable: true,
          upgradeable: true,
          evolvable: true,
          decomposable: true,
          nft_mintable: true,
          sort_order: 10,
          metadata: {
            public_note: "visible",
            secret_seed: "must-not-leak",
          },
          created_at: "2026-05-31T00:00:00.000Z",
          updated_at: "2026-05-31T00:00:00.000Z",
        },
      ],
      "catalog.collectible_forms": [
        {
          id: FORM_ID,
          template_id: TEMPLATE_ID,
          form_index: 1,
          form_slug: "base",
          display_name: "Base",
          image_url: null,
          thumbnail_url: null,
          avatar_url: null,
          is_default: true,
          next_form_id: null,
          updated_at: "2026-05-31T00:00:00.000Z",
        },
      ],
      "catalog.collectible_media": [
        {
          template_id: TEMPLATE_ID,
          media_type: "card",
        },
      ],
    });
    getSupabaseAdminClientMock.mockReturnValue(db.client);

    const { default: collectiblesHandler } =
      await import("../../api/admin/collectibles");
    const result = await invokeApiHandler<ApiSuccessResponse>(
      collectiblesHandler,
      {
        method: "GET",
        url: "/api/admin/collectibles?status=active",
        query: {
          status: "active",
        },
      },
    );

    expect(result.statusCode).toBe(200);
    expect(requireAdminMock).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        permissions: ["catalog:read", "gacha:read", "admin:read"],
        requireAll: false,
      }),
    );
    expect(result.body).toMatchObject({
      ok: true,
      data: {
        items: [
          {
            id: TEMPLATE_ID,
            forms: [{ id: FORM_ID }],
            media_counts: { card: 1 },
            metadata: {
              public_note: "visible",
              secret_seed: "[redacted]",
            },
          },
        ],
        summary: {
          active: 1,
        },
      },
    });
  });

  it("maps collectible ops writes to the audited admin RPC", async () => {
    runWriteRpcMock.mockResolvedValueOnce({
      audit_log_id: AUDIT_LOG_ID,
      template_id: TEMPLATE_ID,
    });

    const { default: collectiblesHandler } =
      await import("../../api/admin/collectibles");
    const result = await invokeApiHandler<ApiSuccessResponse>(
      collectiblesHandler,
      {
        method: "PATCH",
        url: "/api/admin/collectibles",
        headers: {
          "x-admin-confirm": "true",
          "x-idempotency-key": "admin-update-collectible-test-001",
        },
        body: {
          id: TEMPLATE_ID,
          release_status: "hidden",
          tradeable: false,
          upgradeable: true,
          evolvable: true,
          decomposable: true,
          nft_mintable: false,
          sort_order: 20,
          metadata: { ops: "catalog" },
          reason: "catalog ops update",
          confirm: true,
        },
      },
    );

    expect(result.statusCode).toBe(200);
    expect(runWriteRpcMock).toHaveBeenCalledWith(
      expect.objectContaining({
        schema: "api",
        functionName: "admin_update_collectible_template_ops",
        args: expect.objectContaining({
          p_admin_user_id: ADMIN_CONTEXT.adminId,
          p_template_id: TEMPLATE_ID,
          p_release_status: "hidden",
          p_tradeable: false,
          p_nft_mintable: false,
          p_reason: "catalog ops update",
          p_idempotency_key: "admin-update-collectible-test-001",
        }),
      }),
    );
  });

  it("lists album books with milestones for catalog admins", async () => {
    const db = createAdminReadDbMock({
      "album.books": [
        {
          id: BOOK_ID,
          code: "all_collectibles",
          display_name: "All Collectibles",
          description: null,
          book_type: "all",
          series_id: null,
          faction_id: null,
          rarity_code: null,
          cover_url: null,
          active: true,
          starts_at: null,
          ends_at: null,
          sort_order: 10,
          metadata: {},
          created_at: "2026-05-31T00:00:00.000Z",
          updated_at: "2026-05-31T00:00:00.000Z",
        },
      ],
      "album.milestones": [
        {
          id: MILESTONE_ID,
          book_id: BOOK_ID,
          required_count: 1,
          title: "First Discovery",
          reward: [{ currency: "KCOIN", amount: 100 }],
          active: true,
          sort_order: 10,
          metadata: {},
          created_at: "2026-05-31T00:00:00.000Z",
          updated_at: "2026-05-31T00:00:00.000Z",
        },
      ],
      "album.book_items": [
        {
          book_id: BOOK_ID,
        },
      ],
    });
    getSupabaseAdminClientMock.mockReturnValue(db.client);

    const { default: albumHandler } = await import("../../api/admin/album");
    const result = await invokeApiHandler<ApiSuccessResponse>(albumHandler, {
      method: "GET",
      url: "/api/admin/album?book_type=all",
      query: {
        book_type: "all",
      },
    });

    expect(result.statusCode).toBe(200);
    expect(result.body).toMatchObject({
      ok: true,
      data: {
        items: [
          {
            id: BOOK_ID,
            item_count: 1,
            milestones: [{ id: MILESTONE_ID }],
          },
        ],
        summary: {
          active: 1,
          all: 1,
        },
      },
    });
  });

  it("maps album milestone writes to the audited admin RPC", async () => {
    runWriteRpcMock.mockResolvedValueOnce({
      audit_log_id: AUDIT_LOG_ID,
      milestone_id: MILESTONE_ID,
    });

    const { default: albumHandler } = await import("../../api/admin/album");
    const result = await invokeApiHandler<ApiSuccessResponse>(albumHandler, {
      method: "PATCH",
      url: "/api/admin/album",
      headers: {
        "x-admin-confirm": "true",
        "x-idempotency-key": "admin-update-album-test-001",
      },
      body: {
        id: MILESTONE_ID,
        title: "First Discovery",
        required_count: 1,
        reward: [{ currency: "FGEMS", amount: 50 }],
        active: true,
        sort_order: 10,
        metadata: { ops: "album" },
        reason: "album reward update",
        confirm: true,
      },
    });

    expect(result.statusCode).toBe(200);
    expect(runWriteRpcMock).toHaveBeenCalledWith(
      expect.objectContaining({
        schema: "api",
        functionName: "admin_update_album_milestone",
        args: expect.objectContaining({
          p_admin_user_id: ADMIN_CONTEXT.adminId,
          p_milestone_id: MILESTONE_ID,
          p_title: "First Discovery",
          p_reward: [{ currency: "FGEMS", amount: 50 }],
          p_reason: "album reward update",
          p_idempotency_key: "admin-update-album-test-001",
        }),
      }),
    );
  });

  it("reads configured payment support contacts for admins", async () => {
    runReadRpcMock.mockResolvedValueOnce({
      configured: true,
      support_url: "https://t.me/tma_support",
      support_email: "pay@example.test",
      updated_at: "2026-05-31T09:00:00.000Z",
      source: "system_settings",
    });

    const { default: paymentSupportHandler } =
      await import("../../api/admin/payment-support-config");
    const result = await invokeApiHandler<ApiSuccessResponse>(
      paymentSupportHandler,
      {
        method: "GET",
        url: "/api/admin/payment-support-config",
      },
    );

    expect(result.statusCode).toBe(200);
    expect(requireAdminMock).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        permissions: ["payments:read", "admin:read"],
        requireAll: false,
      }),
    );
    expect(result.body).toMatchObject({
      ok: true,
      data: {
        configured: true,
        source: "system_settings",
        supportEmail: "pay@example.test",
        supportUrl: "https://t.me/tma_support",
        updatedAt: "2026-05-31T09:00:00.000Z",
      },
    });
    expect(runReadRpcMock).toHaveBeenCalledWith(
      expect.objectContaining({
        schema: "api",
        functionName: "get_payment_support_config",
      }),
    );
  });

  it("maps payment support config writes to the audited admin RPC", async () => {
    runWriteRpcMock.mockResolvedValueOnce({
      audit_log_id: AUDIT_LOG_ID,
      configured: true,
      support_url: "https://t.me/tma_support",
      support_email: "pay@example.test",
      updated_at: "2026-05-31T09:00:00.000Z",
    });

    const { default: paymentSupportHandler } =
      await import("../../api/admin/payment-support-config");
    const result = await invokeApiHandler<ApiSuccessResponse>(
      paymentSupportHandler,
      {
        method: "PATCH",
        url: "/api/admin/payment-support-config",
        headers: {
          "x-admin-confirm": "true",
          "x-idempotency-key": "admin-payment-support-test-001",
        },
        body: {
          supportUrl: "https://t.me/tma_support",
          supportEmail: "Pay@Example.Test",
          reason: "configure payment support",
          confirm: true,
        },
      },
    );

    expect(result.statusCode).toBe(200);
    expect(requireAdminMock).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        permissions: ["payments:write", "admin:write"],
        requireAll: false,
      }),
    );
    expect(runWriteRpcMock).toHaveBeenCalledWith(
      expect.objectContaining({
        schema: "api",
        functionName: "admin_update_payment_support_config",
        args: expect.objectContaining({
          p_admin_user_id: ADMIN_CONTEXT.adminId,
          p_support_url: "https://t.me/tma_support",
          p_support_email: "pay@example.test",
          p_reason: "configure payment support",
          p_idempotency_key: "admin-payment-support-test-001",
        }),
      }),
    );
    expect(result.body).toMatchObject({
      data: {
        audit_log_id: AUDIT_LOG_ID,
        configured: true,
        supportEmail: "pay@example.test",
        supportUrl: "https://t.me/tma_support",
        source: "system_settings",
      },
    });
  });

  it("rejects non-HTTPS payment support URLs before calling RPC", async () => {
    const { default: paymentSupportHandler } =
      await import("../../api/admin/payment-support-config");
    const result = await invokeApiHandler(paymentSupportHandler, {
      method: "PATCH",
      url: "/api/admin/payment-support-config",
      headers: {
        "x-admin-confirm": "true",
        "x-idempotency-key": "admin-payment-support-test-002",
      },
      body: {
        supportUrl: "http://example.test/support",
        supportEmail: null,
        reason: "reject bad support url",
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

  it("exposes only configured payment support contacts to the web app", async () => {
    runReadRpcMock.mockResolvedValueOnce({
      configured: true,
      support_url: "https://t.me/tma_support",
      support_email: "pay@example.test",
      updated_at: "2026-05-31T09:00:00.000Z",
      source: "system_settings",
    });

    const { default: paymentSupportHandler } =
      await import("../../api/telegram/payment-support");
    const result = await invokeApiHandler<ApiSuccessResponse>(
      paymentSupportHandler,
      {
        method: "GET",
        url: "/api/telegram/payment-support",
      },
    );

    expect(result.statusCode).toBe(200);
    expect(result.body).toMatchObject({
      data: {
        configured: true,
        supportEmail: "pay@example.test",
        supportUrl: "https://t.me/tma_support",
      },
    });
  });

  it("rejects legacy campaign target types before calling RPC", async () => {
    const { default: campaignsHandler } =
      await import("../../api/admin/campaigns");
    const result = await invokeApiHandler(campaignsHandler, {
      method: "POST",
      url: "/api/admin/campaigns",
      headers: {
        "x-admin-confirm": "true",
        "x-idempotency-key": "admin-invalid-campaign-target-test-001",
      },
      body: {
        code: "legacy_target",
        title: "Legacy Target",
        image_url: "/storage/v1/object/public/banners/banner.png",
        placement: "home_top",
        target_type: "external_url",
        target_ref: "https://example.test/live",
        status: "draft",
        sort_order: 10,
        reason: "reject legacy target",
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

  it("rejects campaign image URLs outside public Storage before calling RPC", async () => {
    const { default: campaignsHandler } =
      await import("../../api/admin/campaigns");
    const result = await invokeApiHandler(campaignsHandler, {
      method: "POST",
      url: "/api/admin/campaigns",
      headers: {
        "x-admin-confirm": "true",
        "x-idempotency-key": "admin-invalid-campaign-image-test-001",
      },
      body: {
        code: "bad_image",
        title: "Bad Image",
        image_url: "https://cdn.example.test/banner.png",
        placement: "home_top",
        target_type: "none",
        target_payload: {},
        status: "draft",
        sort_order: 10,
        reason: "reject non storage image",
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

  it("lists blind boxes from the new API with price rules attached", async () => {
    const db = createAdminReadDbMock({
      "gacha.blind_boxes": [
        {
          id: BOX_ID,
          slug: "starter_egg",
          display_name: "Starter Egg",
          description: null,
          tier: "normal",
          status: "active",
          price_stars: 10,
          total_stock: 100,
          remaining_stock: 99,
          open_reward_kcoin: "100",
          cover_image_url: null,
          hero_image_url: null,
          starts_at: null,
          ends_at: null,
          sort_order: 10,
          metadata: {},
          created_at: "2026-05-31T00:00:00.000Z",
          updated_at: "2026-05-31T00:00:00.000Z",
        },
      ],
      "gacha.drop_pool_versions": [
        {
          id: ACTIVE_VERSION_ID,
          box_id: BOX_ID,
          version_no: 1,
          status: "active",
          total_weight: "10000",
          published_at: "2026-05-31T00:00:00.000Z",
          effective_from: "2026-05-31T00:00:00.000Z",
          effective_to: null,
          config_snapshot: {},
          created_by_admin_id: ADMIN_CONTEXT.adminId,
          created_at: "2026-05-31T00:00:00.000Z",
          updated_at: "2026-05-31T00:00:00.000Z",
        },
      ],
      "gacha.drop_pool_items": [
        {
          id: "10000000-0000-4000-8000-000000000001",
          pool_version_id: ACTIVE_VERSION_ID,
        },
      ],
      "gacha.box_price_rules": [
        {
          id: PRICE_RULE_ID,
          box_id: BOX_ID,
          quantity: 10,
          discount_bps: 1000,
          price_stars_override: null,
          active: true,
          starts_at: null,
          ends_at: null,
          metadata: {
            safe: true,
            service_role_key: "must-not-leak",
          },
          created_at: "2026-05-31T00:00:00.000Z",
          updated_at: "2026-05-31T00:00:00.000Z",
        },
      ],
    });
    getSupabaseAdminClientMock.mockReturnValue(db.client);

    const { default: blindBoxesHandler } =
      await import("../../api/admin/blind-boxes");
    const result = await invokeApiHandler<ApiSuccessResponse>(
      blindBoxesHandler,
      {
        method: "GET",
        url: "/api/admin/blind-boxes",
      },
    );

    expect(result.statusCode).toBe(200);
    expect(result.body).toMatchObject({
      data: {
        items: [
          {
            id: BOX_ID,
            active_item_count: 1,
            price_rules: [
              {
                id: PRICE_RULE_ID,
                quantity: 10,
                discount_bps: 1000,
                metadata: {
                  safe: true,
                  service_role_key: "[redacted]",
                },
              },
            ],
          },
        ],
      },
    });
  });

  it("maps blind box status changes to the planned admin status RPC", async () => {
    const db = createAdminReadDbMock({
      "gacha.blind_boxes": [
        {
          id: BOX_ID,
          status: "active",
        },
      ],
    });
    getSupabaseAdminClientMock.mockReturnValue(db.client);
    runWriteRpcMock.mockResolvedValueOnce({
      audit_log_id: AUDIT_LOG_ID,
      box_id: BOX_ID,
    });

    const { default: blindBoxesHandler } =
      await import("../../api/admin/blind-boxes");
    const result = await invokeApiHandler<ApiSuccessResponse>(
      blindBoxesHandler,
      {
        method: "PATCH",
        url: "/api/admin/blind-boxes",
        headers: {
          "x-admin-confirm": "true",
          "x-idempotency-key": "admin-update-box-status-test-001",
        },
        body: {
          action: "update_status",
          boxId: BOX_ID,
          status: "paused",
          reason: "pause campaign",
          confirm: true,
        },
      },
    );

    expect(result.statusCode).toBe(200);
    expect(runWriteRpcMock).toHaveBeenCalledWith(
      expect.objectContaining({
        schema: "api",
        functionName: "admin_update_box_status",
        args: expect.objectContaining({
          p_admin_user_id: ADMIN_CONTEXT.adminId,
          p_box_id: BOX_ID,
          p_status: "paused",
          p_reason: "pause campaign",
          p_idempotency_key: "admin-update-box-status-test-001",
        }),
      }),
    );
  });

  it("maps price rule writes to the planned admin price rule RPC", async () => {
    runWriteRpcMock.mockResolvedValueOnce({
      audit_log_id: AUDIT_LOG_ID,
      price_rule_id: PRICE_RULE_ID,
    });

    const { default: priceRulesHandler } =
      await import("../../api/admin/box-price-rules");
    const result = await invokeApiHandler<ApiSuccessResponse>(
      priceRulesHandler,
      {
        method: "POST",
        url: "/api/admin/box-price-rules",
        headers: {
          "x-admin-confirm": "true",
          "x-idempotency-key": "admin-upsert-price-rule-test-001",
        },
        body: {
          box_id: BOX_ID,
          draw_count: 10,
          price_xtr: 90,
          discount_bps: 1000,
          active: true,
          starts_at: "2026-06-01T00:00:00.000Z",
          ends_at: "2026-06-30T00:00:00.000Z",
          metadata: { campaign: "june" },
          reason: "configure ten draw discount",
          confirm: true,
        },
      },
    );

    expect(result.statusCode).toBe(200);
    expect(runWriteRpcMock).toHaveBeenCalledWith(
      expect.objectContaining({
        schema: "api",
        functionName: "admin_upsert_box_price_rule",
        args: expect.objectContaining({
          p_admin_user_id: ADMIN_CONTEXT.adminId,
          p_price_rule_id: null,
          p_box_id: BOX_ID,
          p_quantity: 10,
          p_discount_bps: 1000,
          p_price_stars_override: 90,
          p_active: true,
          p_reason: "configure ten draw discount",
          p_idempotency_key: "admin-upsert-price-rule-test-001",
        }),
      }),
    );
  });

  it("rejects invalid price rule draw counts before calling RPC", async () => {
    const { default: priceRulesHandler } =
      await import("../../api/admin/box-price-rules");
    const result = await invokeApiHandler(priceRulesHandler, {
      method: "POST",
      url: "/api/admin/box-price-rules",
      headers: {
        "x-admin-confirm": "true",
        "x-idempotency-key": "admin-invalid-price-rule-test-001",
      },
      body: {
        box_id: BOX_ID,
        quantity: 5,
        discount_bps: 1000,
        active: true,
        reason: "invalid draw count",
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
    in: (column: string, value: unknown) => {
      operation.filters.push({ kind: "in", column, value });
      return builder;
    },
    or: (value: string) => {
      operation.filters.push({ kind: "or", column: "", value });
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
      rows = rows.filter((row) => row[filter.column] === filter.value);
    }

    const values = filter.value;

    if (filter.kind === "in" && Array.isArray(values)) {
      rows = rows.filter((row) => values.includes(row[filter.column]));
    }
  }

  if (operation.range) {
    rows = rows.slice(operation.range[0], operation.range[1] + 1);
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
