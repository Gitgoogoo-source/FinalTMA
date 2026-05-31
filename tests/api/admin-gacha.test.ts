import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ApiError, type ApiSuccessResponse } from "../../api/_shared/handler";
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
  sessionId: "session-admin-gacha-test",
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

const BOX_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const ACTIVE_VERSION_ID = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const DRAFT_VERSION_ID = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const TEMPLATE_ID = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
const FORM_ID = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee";
const AUDIT_LOG_ID = "ffffffff-ffff-4fff-8fff-ffffffffffff";

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

describe("admin gacha APIs", () => {
  beforeEach(() => {
    process.env.NODE_ENV = "test";
    vi.resetModules();
    getSupabaseAdminClientMock.mockReset();
    requireAdminMock.mockReset();
    runWriteRpcMock.mockReset();
    requireAdminMock.mockResolvedValue(ADMIN_CONTEXT);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("rejects non-admin gacha box reads before touching Supabase", async () => {
    requireAdminMock.mockRejectedValue(
      new ApiError(403, "FORBIDDEN", "Admin permission required"),
    );

    const { default: boxesHandler } =
      await import("../../api/admin/gacha/boxes");
    const result = await invokeApiHandler(boxesHandler, {
      method: "GET",
      url: "/api/admin/gacha/boxes",
    });

    expect(result.statusCode).toBe(403);
    expect(getSupabaseAdminClientMock).not.toHaveBeenCalled();
    expect(requireAdminMock).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        permissions: ["gacha:read", "admin:read"],
        requireAll: false,
      }),
    );
  });

  it("lists gacha boxes with active pool summaries and redacted metadata", async () => {
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
          total_stock: null,
          remaining_stock: null,
          open_reward_kcoin: "100",
          cover_image_url: null,
          hero_image_url: null,
          starts_at: null,
          ends_at: null,
          sort_order: 10,
          metadata: {
            public_note: "visible",
            random_seed_secret: "must-not-leak",
          },
          created_at: "2026-05-30T00:00:00.000Z",
          updated_at: "2026-05-30T00:00:00.000Z",
        },
      ],
      "gacha.drop_pool_versions": [
        {
          id: ACTIVE_VERSION_ID,
          box_id: BOX_ID,
          version_no: 1,
          status: "active",
          total_weight: "10000",
          published_at: "2026-05-30T00:00:00.000Z",
          effective_from: "2026-05-30T00:00:00.000Z",
          effective_to: null,
          config_snapshot: {
            random_seed_hash: "must-not-leak",
            item_count: 2,
          },
          created_by_admin_id: ADMIN_CONTEXT.adminId,
          created_at: "2026-05-30T00:00:00.000Z",
          updated_at: "2026-05-30T00:00:00.000Z",
        },
        {
          id: DRAFT_VERSION_ID,
          box_id: BOX_ID,
          version_no: 2,
          status: "draft",
          total_weight: "10000",
          published_at: null,
          effective_from: null,
          effective_to: null,
          config_snapshot: {},
          created_by_admin_id: ADMIN_CONTEXT.adminId,
          created_at: "2026-05-30T00:00:00.000Z",
          updated_at: "2026-05-30T00:00:00.000Z",
        },
      ],
      "gacha.drop_pool_items": [
        {
          id: "10000000-0000-4000-8000-000000000001",
          pool_version_id: ACTIVE_VERSION_ID,
        },
        {
          id: "10000000-0000-4000-8000-000000000002",
          pool_version_id: ACTIVE_VERSION_ID,
        },
      ],
    });
    getSupabaseAdminClientMock.mockReturnValue(db.client);

    const { default: boxesHandler } =
      await import("../../api/admin/gacha/boxes");
    const result = await invokeApiHandler<ApiSuccessResponse>(boxesHandler, {
      method: "GET",
      url: "/api/admin/gacha/boxes?limit=10",
      query: {
        limit: "10",
      },
    });

    expect(result.statusCode).toBe(200);
    expect(result.body).toMatchObject({
      ok: true,
      data: {
        items: [
          {
            id: BOX_ID,
            active_item_count: 2,
            version_count: 2,
            metadata: {
              public_note: "visible",
              random_seed_secret: "[redacted]",
            },
            active_version: {
              id: ACTIVE_VERSION_ID,
              item_count: 2,
              config_snapshot: {
                random_seed_hash: "[redacted]",
              },
            },
          },
        ],
        nextCursor: null,
      },
    });
  });

  it("lists drop pool items with template and form summaries", async () => {
    const db = createAdminReadDbMock({
      "gacha.drop_pool_items": [
        {
          id: "10000000-0000-4000-8000-000000000001",
          pool_version_id: ACTIVE_VERSION_ID,
          template_id: TEMPLATE_ID,
          form_id: FORM_ID,
          rarity_code: "RARE",
          drop_weight: "10000",
          probability_bps: 10000,
          stock_total: null,
          stock_remaining: null,
          is_pity_eligible: true,
          is_featured: false,
          sort_order: 10,
          metadata: {},
          created_at: "2026-05-30T00:00:00.000Z",
          updated_at: "2026-05-30T00:00:00.000Z",
        },
      ],
      "catalog.collectible_templates": [
        {
          id: TEMPLATE_ID,
          slug: "rare-card",
          display_name: "Rare Card",
        },
      ],
      "catalog.collectible_forms": [
        {
          id: FORM_ID,
          display_name: "Base Form",
        },
      ],
    });
    getSupabaseAdminClientMock.mockReturnValue(db.client);

    const { default: itemsHandler } =
      await import("../../api/admin/gacha/drop-pool-items");
    const result = await invokeApiHandler<ApiSuccessResponse>(itemsHandler, {
      method: "GET",
      url: `/api/admin/gacha/drop-pool-items?poolVersionId=${ACTIVE_VERSION_ID}`,
      query: {
        poolVersionId: ACTIVE_VERSION_ID,
      },
    });

    expect(result.statusCode).toBe(200);
    expect(result.body).toMatchObject({
      data: {
        items: [
          {
            id: "10000000-0000-4000-8000-000000000001",
            template_slug: "rare-card",
            template_display_name: "Rare Card",
            form_display_name: "Base Form",
          },
        ],
        summary: {
          RARE: 1,
        },
      },
    });
  });

  it("requires admin confirmation and idempotency before saving drop pool drafts", async () => {
    const { default: versionsHandler } =
      await import("../../api/admin/gacha/drop-pool-versions");
    const result = await invokeApiHandler(versionsHandler, {
      method: "POST",
      url: "/api/admin/gacha/drop-pool-versions",
      body: {
        boxId: BOX_ID,
        reason: "save draft",
        items: [],
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

  it("maps draft save requests to the planned admin draft RPC", async () => {
    runWriteRpcMock.mockResolvedValueOnce({
      audit_log_id: AUDIT_LOG_ID,
      drop_pool_version_id: DRAFT_VERSION_ID,
    });

    const { default: versionsHandler } =
      await import("../../api/admin/gacha/drop-pool-versions");
    const result = await invokeApiHandler<ApiSuccessResponse>(versionsHandler, {
      method: "POST",
      url: "/api/admin/gacha/drop-pool-versions",
      headers: {
        "x-admin-confirm": "true",
        "x-idempotency-key": "admin-save-draft-test-001",
      },
      body: {
        boxId: BOX_ID,
        versionName: "Draft v2",
        reason: "save draft",
        items: [
          {
            template_id: TEMPLATE_ID,
            form_id: FORM_ID,
            rarity_code: "RARE",
            drop_weight: 10000,
            probability_bps: 10000,
          },
        ],
      },
    });

    expect(result.statusCode).toBe(200);
    expect(runWriteRpcMock).toHaveBeenCalledWith(
      expect.objectContaining({
        schema: "api",
        functionName: "admin_create_drop_pool_draft",
        args: expect.objectContaining({
          p_admin_user_id: ADMIN_CONTEXT.adminId,
          p_box_id: BOX_ID,
          p_version_name: "Draft v2",
          p_reason: "save draft",
          p_idempotency_key: "admin-save-draft-test-001",
          p_items: [
            expect.objectContaining({
              template_id: TEMPLATE_ID,
              form_id: FORM_ID,
              rarity_code: "RARE",
              drop_weight: 10000,
              probability_bps: 10000,
            }),
          ],
        }),
      }),
    );
  });

  it("maps clone requests to create a new draft from the source version", async () => {
    runWriteRpcMock.mockResolvedValueOnce({
      audit_log_id: AUDIT_LOG_ID,
      drop_pool_version_id: DRAFT_VERSION_ID,
    });

    const { default: versionsHandler } =
      await import("../../api/admin/gacha/drop-pool-versions");
    const result = await invokeApiHandler<ApiSuccessResponse>(versionsHandler, {
      method: "POST",
      url: "/api/admin/gacha/drop-pool-versions",
      headers: {
        "x-admin-confirm": "true",
        "x-idempotency-key": "admin-clone-drop-pool-test-001",
      },
      body: {
        boxId: BOX_ID,
        sourceVersionId: ACTIVE_VERSION_ID,
        versionName: "clone-v1",
        reason: "clone active version",
        confirm: true,
      },
    });

    expect(result.statusCode).toBe(200);
    expect(runWriteRpcMock).toHaveBeenCalledWith(
      expect.objectContaining({
        schema: "api",
        functionName: "admin_create_drop_pool_draft",
        args: expect.objectContaining({
          p_admin_user_id: ADMIN_CONTEXT.adminId,
          p_box_id: BOX_ID,
          p_source_version_id: ACTIVE_VERSION_ID,
          p_version_name: "clone-v1",
          p_items: null,
          p_pity_rules: null,
          p_reason: "clone active version",
          p_idempotency_key: "admin-clone-drop-pool-test-001",
        }),
      }),
    );
  });

  it("rejects editing active or archived drop pool versions before the update RPC", async () => {
    const { default: versionsHandler } =
      await import("../../api/admin/gacha/drop-pool-versions");

    for (const status of ["active", "archived"] as const) {
      const db = createAdminReadDbMock({
        "gacha.drop_pool_versions": [
          {
            id: ACTIVE_VERSION_ID,
            status,
          },
        ],
      });
      getSupabaseAdminClientMock.mockReturnValue(db.client);

      const result = await invokeApiHandler(versionsHandler, {
        method: "POST",
        url: "/api/admin/gacha/drop-pool-versions",
        headers: {
          "x-admin-confirm": "true",
          "x-idempotency-key": `admin-edit-${status}-drop-pool-test-001`,
        },
        body: {
          boxId: BOX_ID,
          dropPoolVersionId: ACTIVE_VERSION_ID,
          reason: `attempt edit ${status} version`,
          confirm: true,
          items: [
            {
              template_id: TEMPLATE_ID,
              form_id: FORM_ID,
              rarity_code: "RARE",
              drop_weight: 10000,
              probability_bps: 10000,
            },
          ],
        },
      });

      expect(result.statusCode).toBe(409);
      expect(result.body).toMatchObject({
        error: {
          code: "ADMIN_DROP_POOL_VERSION_NOT_EDITABLE",
        },
      });
    }

    expect(runWriteRpcMock).not.toHaveBeenCalled();
  });

  it("publishes a drop pool version only through the admin publish RPC", async () => {
    runWriteRpcMock.mockResolvedValueOnce({
      audit_log_id: AUDIT_LOG_ID,
      drop_pool_version_id: ACTIVE_VERSION_ID,
    });

    const { default: publishHandler } =
      await import("../../api/admin/gacha/publish-drop-pool");
    const result = await invokeApiHandler<ApiSuccessResponse>(publishHandler, {
      method: "POST",
      url: "/api/admin/gacha/publish-drop-pool",
      headers: {
        "x-admin-confirm": "true",
        "x-idempotency-key": "admin-publish-drop-pool-test-001",
      },
      body: {
        dropPoolVersionId: DRAFT_VERSION_ID,
        reason: "publish draft",
        confirm: true,
      },
    });

    expect(result.statusCode).toBe(200);
    expect(runWriteRpcMock).toHaveBeenCalledWith(
      expect.objectContaining({
        schema: "api",
        functionName: "admin_publish_drop_pool_version",
        args: expect.objectContaining({
          p_admin_user_id: ADMIN_CONTEXT.adminId,
          p_drop_pool_version_id: DRAFT_VERSION_ID,
          p_reason: "publish draft",
          p_idempotency_key: "admin-publish-drop-pool-test-001",
          p_approval_context: {},
        }),
      }),
    );
  });

  it("rejects risk-only admins before probability publish writes", async () => {
    requireAdminMock.mockRejectedValueOnce(
      new ApiError(403, "FORBIDDEN", "Admin permission required"),
    );

    const { default: publishHandler } =
      await import("../../api/admin/gacha/publish-drop-pool");
    const result = await invokeApiHandler(publishHandler, {
      method: "POST",
      url: "/api/admin/gacha/publish-drop-pool",
      headers: {
        "x-admin-confirm": "true",
        "x-idempotency-key": "admin-publish-risk-only-test-001",
      },
      body: {
        dropPoolVersionId: DRAFT_VERSION_ID,
        reason: "risk-only cannot change probability",
      },
    });

    expect(result.statusCode).toBe(403);
    expect(runWriteRpcMock).not.toHaveBeenCalled();
    expect(requireAdminMock).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        permissions: ["gacha:write", "admin:write"],
        requireAll: false,
      }),
    );
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
