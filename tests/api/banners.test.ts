import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { type ApiSuccessResponse } from "../../api/_shared/handler";
import { invokeApiHandler } from "./_utils";

const { getSupabaseAdminClientMock } = vi.hoisted(() => ({
  getSupabaseAdminClientMock: vi.fn(),
}));

vi.mock("../../packages/server/src/db/supabaseAdmin.js", () => ({
  getSupabaseAdminClient: getSupabaseAdminClientMock,
}));

type BannerQueryOperation = {
  schema: string;
  table: string;
  selectedColumns: string[] | null;
  filters: Array<{
    column: string;
    value: unknown;
  }>;
  limit: number | null;
};

type BannerRows = Record<string, Array<Record<string, unknown>>>;

describe("user banner API", () => {
  beforeEach(() => {
    process.env.NODE_ENV = "test";
    vi.resetModules();
    getSupabaseAdminClientMock.mockReset();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("lists only active banners for a valid placement and filters time windows", async () => {
    const now = Date.now();
    const db = createBannerDbMock({
      "catalog.banner_campaigns": [
        {
          id: "11111111-1111-4111-8111-111111111111",
          code: "market-live",
          title: "Market Live",
          description: "visible",
          image_url: "https://cdn.example.test/market-live.png",
          placement: "market_top",
          target_type: "external_url",
          target_ref: "https://example.test/live",
          status: "active",
          sort_order: 1,
          starts_at: new Date(now - 60_000).toISOString(),
          ends_at: new Date(now + 60_000).toISOString(),
          metadata: {},
          created_at: new Date(now).toISOString(),
          updated_at: new Date(now).toISOString(),
        },
        {
          id: "22222222-2222-4222-8222-222222222222",
          code: "market-future",
          title: "Market Future",
          description: null,
          image_url: "https://cdn.example.test/market-future.png",
          placement: "market_top",
          target_type: "none",
          target_ref: null,
          status: "active",
          sort_order: 2,
          starts_at: new Date(now + 60_000).toISOString(),
          ends_at: null,
          metadata: {},
          created_at: new Date(now).toISOString(),
          updated_at: new Date(now).toISOString(),
        },
      ],
    });
    getSupabaseAdminClientMock.mockReturnValue(db.client);

    const { default: bannersHandler } = await import("../../api/banners/list");
    const result = await invokeApiHandler<ApiSuccessResponse>(bannersHandler, {
      method: "GET",
      url: "/api/banners/list?placement=market_top",
      query: {
        placement: "market_top",
      },
    });

    expect(result.statusCode).toBe(200);
    expect(result.body).toMatchObject({
      ok: true,
      data: {
        placement: "market_top",
        items: [
          {
            code: "market-live",
            targetHref: "https://example.test/live",
          },
        ],
      },
    });
    expect(db.operations[0]?.filters).toEqual(
      expect.arrayContaining([
        { column: "placement", value: "market_top" },
        { column: "status", value: "active" },
      ]),
    );
  });

  it("rejects unknown placements before querying Supabase", async () => {
    const db = createBannerDbMock({
      "catalog.banner_campaigns": [],
    });
    getSupabaseAdminClientMock.mockReturnValue(db.client);

    const { default: bannersHandler } = await import("../../api/banners/list");
    const result = await invokeApiHandler(bannersHandler, {
      method: "GET",
      url: "/api/banners/list?placement=home",
      query: {
        placement: "home",
      },
    });

    expect(result.statusCode).toBe(400);
    expect(result.body).toMatchObject({
      error: {
        code: "VALIDATION_FAILED",
      },
    });
    expect(db.operations).toHaveLength(0);
  });
});

function createBannerDbMock(rowsByTable: BannerRows): {
  client: unknown;
  operations: BannerQueryOperation[];
} {
  const operations: BannerQueryOperation[] = [];

  return {
    client: {
      schema: (schema: string) => ({
        from: (table: string) =>
          createBannerQueryBuilder(schema, table, rowsByTable, operations),
      }),
    },
    operations,
  };
}

function createBannerQueryBuilder(
  schema: string,
  table: string,
  rowsByTable: BannerRows,
  operations: BannerQueryOperation[],
) {
  const operation: BannerQueryOperation = {
    schema,
    table,
    selectedColumns: null,
    filters: [],
    limit: null,
  };
  operations.push(operation);

  const builder = {
    select: (columns?: string) => {
      operation.selectedColumns = parseSelectedColumns(columns);
      return builder;
    },
    eq: (column: string, value: unknown) => {
      operation.filters.push({ column, value });
      return builder;
    },
    order: () => builder,
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
      Promise.resolve(
        resolve(resolveBannerQuery(operation, rowsByTable)),
      ).catch(reject),
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

function resolveBannerQuery(
  operation: BannerQueryOperation,
  rowsByTable: BannerRows,
): { data: Array<Record<string, unknown>>; error: null } {
  let rows = [...(rowsByTable[`${operation.schema}.${operation.table}`] ?? [])];

  for (const filter of operation.filters) {
    rows = rows.filter((row) => row[filter.column] === filter.value);
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
