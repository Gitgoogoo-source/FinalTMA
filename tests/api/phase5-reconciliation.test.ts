import { describe, expect, it, vi } from "vitest";

import reconcileHandler from "../../api/cron/reconcile-ledger";
import { runPhase5Reconciliation } from "../../packages/server/src/jobs/ledgerReconcileJob";
import type { SupabaseAdminClient } from "../../packages/server/src/db/supabaseAdmin";
import { invokeApiHandler } from "./_utils";

type TableRows = Record<string, Array<Record<string, unknown>>>;

type QueryOperation = {
  schema: string;
  table: string;
  operation: "select" | "insert" | "update";
  payload: unknown;
  filters: Array<{
    kind: "eq" | "in";
    column: string;
    value: unknown;
  }>;
  selected: string | null;
  limitValue: number | null;
};

describe("phase 5 reconciliation job", () => {
  it("records payment fulfillment findings and writes structured risk events", async () => {
    const db = createDbMock({
      "payments.star_orders": [
        {
          id: "11111111-1111-4111-8111-111111111111",
          user_id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
          business_id: "22222222-2222-4222-8222-222222222222",
          status: "paid",
          paid_at: "2026-05-29T00:00:00.000Z",
          fulfilled_at: null,
          error_message: null,
          created_at: "2026-05-29T00:00:00.000Z",
          updated_at: "2026-05-29T00:01:00.000Z",
        },
        {
          id: "33333333-3333-4333-8333-333333333333",
          user_id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
          business_id: "44444444-4444-4444-8444-444444444444",
          status: "fulfilled",
          paid_at: "2026-05-29T00:00:00.000Z",
          fulfilled_at: "2026-05-29T00:02:00.000Z",
          error_message: null,
          created_at: "2026-05-29T00:00:00.000Z",
          updated_at: "2026-05-29T00:02:00.000Z",
        },
      ],
      "payments.star_payments": [
        {
          id: "55555555-5555-4555-8555-555555555555",
          star_order_id: "11111111-1111-4111-8111-111111111111",
          telegram_payment_charge_id: "charge-paid-not-fulfilled",
          xtr_amount: 10,
          paid_at: "2026-05-29T00:00:00.000Z",
        },
      ],
      "gacha.draw_orders": [
        {
          id: "22222222-2222-4222-8222-222222222222",
          user_id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
          payment_star_order_id: "11111111-1111-4111-8111-111111111111",
          status: "paid",
          quantity: 1,
          draw_count: 1,
        },
        {
          id: "44444444-4444-4444-8444-444444444444",
          user_id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
          payment_star_order_id: "33333333-3333-4333-8333-333333333333",
          status: "completed",
          quantity: 1,
          draw_count: 1,
        },
      ],
      "gacha.draw_results": [],
      "inventory.item_instances": [],
      "ops.risk_events": [],
      "economy.reconciliation_runs": [],
    });

    const result = await runPhase5Reconciliation({
      db: db.client,
      requestId: "req-reconcile-payment",
      runTypes: ["payment_fulfillment"],
      limit: 20,
      createdBy: "vitest",
      now: new Date("2026-05-29T00:30:00.000Z"),
    });

    expect(result.runs).toHaveLength(1);
    expect(result.runs[0]).toMatchObject({
      runType: "payment_fulfillment",
      status: "success",
      riskEventCount: expect.any(Number),
    });
    expect(result.runs[0]?.findings.map((finding) => finding.code)).toEqual(
      expect.arrayContaining([
        "phase5_payment_paid_not_fulfilled",
        "phase5_fulfilled_without_draw_results",
      ]),
    );
    expect(db.rows["ops.risk_events"]).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          event_type: "phase5_payment_paid_not_fulfilled",
          source_type: "star_order",
          detail: expect.objectContaining({
            request_id: "req-reconcile-payment",
            star_order_id: "11111111-1111-4111-8111-111111111111",
            draw_order_id: "22222222-2222-4222-8222-222222222222",
            payment_charge_id: "charge-paid-not-fulfilled",
          }),
        }),
      ]),
    );
    expect(db.rows["economy.reconciliation_runs"]?.[0]).toMatchObject({
      run_type: "payment_fulfillment",
      status: "success",
      created_by: "vitest",
    });
  });

  it("records ledger balance mismatches without modifying ledger history", async () => {
    const db = createDbMock({
      "economy.user_balances": [
        {
          user_id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
          currency_code: "KCOIN",
          available_amount: "10",
          locked_amount: "0",
          updated_at: "2026-05-29T00:05:00.000Z",
        },
      ],
      "economy.currency_ledger": [
        {
          id: "99999999-9999-4999-8999-999999999999",
          user_id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
          currency_code: "KCOIN",
          available_after: "9",
          locked_after: "0",
          created_at: "2026-05-29T00:04:00.000Z",
        },
      ],
      "ops.risk_events": [],
      "economy.reconciliation_runs": [],
    });

    const result = await runPhase5Reconciliation({
      db: db.client,
      requestId: "req-reconcile-ledger",
      runTypes: ["ledger_balance"],
      limit: 20,
      createdBy: "vitest",
    });

    expect(result.runs[0]?.findings).toEqual([
      expect.objectContaining({
        code: "phase5_ledger_balance_mismatch",
        userId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      }),
    ]);
    expect(db.rows["economy.currency_ledger"]).toHaveLength(1);
    expect(db.rows["ops.risk_events"]).toEqual([
      expect.objectContaining({
        event_type: "phase5_ledger_balance_mismatch",
        source_type: "user_balance",
        source_id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      }),
    ]);
  });

  it("rejects invalid cron run types before reading reconciliation tables", async () => {
    const result = await invokeApiHandler(reconcileHandler, {
      method: "GET",
      url: "/api/cron/reconcile-ledger?runTypes=invalid",
      query: {
        runTypes: "invalid",
      },
    });

    expect(result.statusCode).toBe(400);
    expect(result.body).toMatchObject({
      error: {
        code: "RECONCILIATION_RUN_TYPE_INVALID",
      },
    });
  });
});

function createDbMock(rows: TableRows): {
  client: SupabaseAdminClient;
  rows: TableRows;
  operations: QueryOperation[];
} {
  const mutableRows = Object.fromEntries(
    Object.entries(rows).map(([key, value]) => [key, [...value]]),
  );
  const operations: QueryOperation[] = [];
  const client = {
    schema: (schema: string) => ({
      from: (table: string) =>
        createQueryBuilder(schema, table, mutableRows, operations),
    }),
  };

  return {
    client: client as unknown as SupabaseAdminClient,
    rows: mutableRows,
    operations,
  };
}

function createQueryBuilder(
  schema: string,
  table: string,
  rows: TableRows,
  operations: QueryOperation[],
) {
  const operation: QueryOperation = {
    schema,
    table,
    operation: "select",
    payload: null,
    filters: [],
    selected: null,
    limitValue: null,
  };
  operations.push(operation);

  const builder = {
    select: (columns?: string) => {
      operation.selected = columns ?? null;
      return builder;
    },
    insert: (payload: unknown) => {
      operation.operation = "insert";
      operation.payload = payload;
      return builder;
    },
    update: (payload: unknown) => {
      operation.operation = "update";
      operation.payload = payload;
      return builder;
    },
    eq: (column: string, value: unknown) => {
      operation.filters.push({ kind: "eq", column, value });
      return builder;
    },
    in: (column: string, value: unknown[]) => {
      operation.filters.push({ kind: "in", column, value });
      return builder;
    },
    order: () => builder,
    limit: (limit: number) => {
      operation.limitValue = limit;
      return builder;
    },
    maybeSingle: () => Promise.resolve(resolveOperation(operation, rows, true)),
    single: () => Promise.resolve(resolveOperation(operation, rows, true)),
    then: (
      resolve: (value: { data: unknown; error: null }) => unknown,
      reject?: (reason: unknown) => unknown,
    ) =>
      Promise.resolve(resolve(resolveOperation(operation, rows, false))).catch(
        reject,
      ),
  };

  return builder;
}

function resolveOperation(
  operation: QueryOperation,
  rows: TableRows,
  single: boolean,
): { data: unknown; error: null } {
  const key = `${operation.schema}.${operation.table}`;
  const tableRows = rows[key] ?? [];
  rows[key] = tableRows;

  if (operation.operation === "insert") {
    const payloads = Array.isArray(operation.payload)
      ? operation.payload
      : [operation.payload];
    const inserted = payloads.map((payload) => ({
      id: `mock-${operation.table}-${tableRows.length + 1}`,
      ...(payload as Record<string, unknown>),
    }));
    tableRows.push(...inserted);

    return {
      data: single ? pickSelected(inserted[0], operation.selected) : inserted,
      error: null,
    };
  }

  if (operation.operation === "update") {
    const matchedRows = filterRows(tableRows, operation.filters);

    for (const row of matchedRows) {
      Object.assign(row, operation.payload);
    }

    return {
      data: single ? (matchedRows[0] ?? null) : matchedRows,
      error: null,
    };
  }

  let matchedRows = filterRows(tableRows, operation.filters);

  if (operation.limitValue !== null) {
    matchedRows = matchedRows.slice(0, operation.limitValue);
  }

  return {
    data: single ? (matchedRows[0] ?? null) : matchedRows,
    error: null,
  };
}

function filterRows(
  rows: Array<Record<string, unknown>>,
  filters: QueryOperation["filters"],
): Array<Record<string, unknown>> {
  return rows.filter((row) =>
    filters.every((filter) => {
      if (filter.kind === "eq") {
        return row[filter.column] === filter.value;
      }

      if (filter.kind === "in" && Array.isArray(filter.value)) {
        return filter.value.includes(row[filter.column]);
      }

      return true;
    }),
  );
}

function pickSelected(
  row: Record<string, unknown> | undefined,
  selected: string | null,
): Record<string, unknown> | null {
  if (!row) {
    return null;
  }

  if (!selected || selected === "*") {
    return row;
  }

  const selectedColumns = selected.split(",").map((column) => column.trim());

  return Object.fromEntries(
    selectedColumns
      .filter((column) => column in row)
      .map((column) => [column, row[column]]),
  );
}
