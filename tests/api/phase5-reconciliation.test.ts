import { describe, expect, it, vi } from "vitest";

import reconcileHandler from "../../api/cron/reconcile-ledger";
import reconciliationCronHandler from "../../api/cron/reconciliation";
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
  rangeFrom: number | null;
  rangeTo: number | null;
};

type QueryError = {
  message?: string;
  code?: string;
};

type QueryResult = {
  data: unknown;
  error: QueryError | null;
};

type QueryFailure = {
  schema: string;
  table: string;
  operation?: QueryOperation["operation"];
  message: string;
  code?: string;
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
          event_type: "payment_paid_not_fulfilled",
          source_type: "star_order",
          detail: expect.objectContaining({
            request_id: "req-reconcile-payment",
            reconciliation_finding_code:
              "phase5_payment_paid_not_fulfilled",
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
        event_type: "ledger_balance_mismatch",
        source_type: "user_balance",
        source_id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
        detail: expect.objectContaining({
          reconciliation_finding_code: "phase5_ledger_balance_mismatch",
        }),
      }),
    ]);
  });

  it("records dry-run result fields without writing risk events", async () => {
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
      requestId: "req-reconcile-dry-run",
      runTypes: ["ledger_balance"],
      limit: 20,
      createdBy: "vitest",
      writeRiskEvents: false,
    });

    expect(result.runs[0]).toMatchObject({
      findingCount: 1,
      riskEventCount: 0,
      riskEventInsertedCount: 0,
      riskEventExistingCount: 0,
      riskEventSkippedCount: 0,
    });
    expect(db.rows["ops.risk_events"]).toHaveLength(0);
    expect(db.rows["economy.reconciliation_runs"]?.[0]?.result).toMatchObject({
      dry_run: true,
      write_risk_events: false,
      risk_event_count: 0,
      risk_event_inserted_count: 0,
      risk_event_existing_count: 0,
      risk_event_skipped_count: 0,
    });
  });

  it("counts existing risk events without mislabeling the run as dry-run", async () => {
    const userId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
    const db = createDbMock({
      "economy.user_balances": [
        {
          user_id: userId,
          currency_code: "KCOIN",
          available_amount: "10",
          locked_amount: "0",
          updated_at: "2026-05-29T00:05:00.000Z",
        },
      ],
      "economy.currency_ledger": [
        {
          id: "99999999-9999-4999-8999-999999999999",
          user_id: userId,
          currency_code: "KCOIN",
          available_after: "9",
          locked_after: "0",
          created_at: "2026-05-29T00:04:00.000Z",
        },
      ],
      "ops.risk_events": [
        {
          id: "risk-existing-ledger-mismatch",
          event_type: "ledger_balance_mismatch",
          source_type: "user_balance",
          source_id: userId,
          status: "open",
        },
      ],
      "economy.reconciliation_runs": [],
    });

    const result = await runPhase5Reconciliation({
      db: db.client,
      requestId: "req-reconcile-existing-risk",
      runTypes: ["ledger_balance"],
      limit: 20,
      createdBy: "vitest",
    });

    expect(result.runs[0]).toMatchObject({
      findingCount: 1,
      riskEventCount: 0,
      riskEventInsertedCount: 0,
      riskEventExistingCount: 1,
      riskEventSkippedCount: 0,
    });
    expect(db.rows["ops.risk_events"]).toHaveLength(1);
    expect(db.rows["economy.reconciliation_runs"]?.[0]?.result).toMatchObject({
      dry_run: false,
      write_risk_events: true,
      risk_event_count: 0,
      risk_event_inserted_count: 0,
      risk_event_existing_count: 1,
    });
  });

  it("marks reconciliation runs as failed when collection queries fail", async () => {
    const db = createDbMock(
      {
        "market.orders": [],
        "economy.reconciliation_runs": [],
      },
      {
        failures: [
          {
            schema: "market",
            table: "orders",
            operation: "select",
            message: "orders unavailable",
          },
        ],
      },
    );

    await expect(
      runPhase5Reconciliation({
        db: db.client,
        requestId: "req-reconcile-market-failed",
        runTypes: ["market_settlement"],
        limit: 20,
        createdBy: "vitest",
      }),
    ).rejects.toThrow(
      "RECONCILIATION_MARKET_ORDER_LOOKUP_FAILED: orders unavailable",
    );

    expect(db.rows["economy.reconciliation_runs"]?.[0]).toMatchObject({
      run_type: "market_settlement",
      status: "failed",
      created_by: "vitest",
      error_message:
        "RECONCILIATION_MARKET_ORDER_LOOKUP_FAILED: orders unavailable",
      result: expect.objectContaining({
        request_id: "req-reconcile-market-failed",
        run_type: "market_settlement",
      }),
    });
  });

  it("records market settlement findings without touching ledger history", async () => {
    const db = createDbMock({
      "market.orders": [
        {
          id: "aaaa1111-1111-4111-8111-111111111111",
          buyer_user_id: "bbbb1111-1111-4111-8111-111111111111",
          seller_user_id: "cccc1111-1111-4111-8111-111111111111",
          listing_id: "dddd1111-1111-4111-8111-111111111111",
          status: "completed",
          item_count: 1,
          total_price_kcoin: "100",
          fee_bps: 500,
          fee_amount_kcoin: "5",
          seller_net_amount_kcoin: "95",
          buyer_ledger_id: null,
          seller_ledger_id: null,
          completed_at: "2026-05-30T00:05:00.000Z",
          created_at: "2026-05-30T00:00:00.000Z",
        },
      ],
      "economy.currency_ledger": [
        {
          id: "eeee1111-1111-4111-8111-111111111111",
          user_id: "bbbb1111-1111-4111-8111-111111111111",
          currency_code: "KCOIN",
          available_after: "900",
          locked_after: "0",
          created_at: "2026-05-30T00:06:00.000Z",
        },
      ],
      "market.fee_settlements": [],
      "market.listing_items": [],
      "market.listings": [
        {
          id: "dddd1111-1111-4111-8111-111111111111",
          seller_user_id: "cccc1111-1111-4111-8111-111111111111",
          status: "sold",
          item_count: 1,
          remaining_count: 0,
        },
      ],
      "ops.risk_events": [],
      "economy.reconciliation_runs": [],
    });

    const result = await runPhase5Reconciliation({
      db: db.client,
      requestId: "req-reconcile-market",
      runTypes: ["market_settlement"],
      limit: 20,
      createdBy: "vitest",
    });

    expect(result.runs[0]?.findings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: "phase6_market_order_ledger_missing",
          severity: "critical",
          sourceId: "aaaa1111-1111-4111-8111-111111111111",
        }),
      ]),
    );
    expect(db.rows["economy.currency_ledger"]).toHaveLength(1);
    expect(db.rows["ops.risk_events"]).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          event_type: "market_price_manipulation",
          source_type: "market_order",
          detail: expect.objectContaining({
            reconciliation_finding_code:
              "phase6_market_order_item_count_mismatch",
            reconciliation_run_type: "market_settlement",
            suggested_action: expect.any(String),
          }),
        }),
      ]),
    );
  });

  it("detects market item owner mismatches even when source metadata is valid market metadata", async () => {
    const orderId = "aaaa3333-1111-4111-8111-111111111111";
    const buyerUserId = "bbbb3333-1111-4111-8111-111111111111";
    const sellerUserId = "cccc3333-1111-4111-8111-111111111111";
    const listingId = "dddd3333-1111-4111-8111-111111111111";
    const listingItemId = "eeee3333-1111-4111-8111-111111111111";
    const itemInstanceId = "ffff3333-1111-4111-8111-111111111111";
    const db = createDbMock({
      "market.orders": [
        {
          id: orderId,
          buyer_user_id: buyerUserId,
          seller_user_id: sellerUserId,
          listing_id: listingId,
          status: "completed",
          item_count: 1,
          total_price_kcoin: "100",
          fee_bps: 500,
          fee_amount_kcoin: "5",
          seller_net_amount_kcoin: "95",
          buyer_ledger_id: "11113333-2222-4222-8222-222222222222",
          seller_ledger_id: "22223333-3333-4333-8333-333333333333",
          completed_at: "2026-05-30T00:05:00.000Z",
          created_at: "2026-05-30T00:00:00.000Z",
        },
      ],
      "economy.currency_ledger": [
        {
          id: "11113333-2222-4222-8222-222222222222",
          user_id: buyerUserId,
          currency_code: "KCOIN",
          entry_type: "debit",
          amount: "100",
          source_type: "market_buy",
          source_id: orderId,
        },
        {
          id: "22223333-3333-4333-8333-333333333333",
          user_id: sellerUserId,
          currency_code: "KCOIN",
          entry_type: "credit",
          amount: "95",
          source_type: "market_sell",
          source_id: orderId,
        },
      ],
      "market.fee_settlements": [
        {
          id: "33334444-3333-4333-8333-333333333333",
          market_order_id: orderId,
          currency_code: "KCOIN",
          fee_amount: "5",
          fee_bps: 500,
          status: "settled",
        },
      ],
      "market.order_items": [
        {
          order_id: orderId,
          listing_item_id: listingItemId,
          item_instance_id: itemInstanceId,
        },
      ],
      "market.listing_items": [
        {
          id: listingItemId,
          listing_id: listingId,
          item_instance_id: itemInstanceId,
          status: "sold",
          buyer_user_id: buyerUserId,
          sold_order_id: orderId,
        },
      ],
      "market.listings": [
        {
          id: listingId,
          seller_user_id: sellerUserId,
          status: "sold",
          item_count: 1,
          remaining_count: 0,
        },
      ],
      "inventory.item_instances": [
        {
          id: itemInstanceId,
          owner_user_id: sellerUserId,
          source_type: "market",
          source_id: orderId,
          nft_mint_status: "none",
          minted_nft_item_id: null,
        },
      ],
      "ops.risk_events": [],
      "economy.reconciliation_runs": [],
    });

    const result = await runPhase5Reconciliation({
      db: db.client,
      requestId: "req-reconcile-market-owner",
      runTypes: ["market_settlement"],
      limit: 20,
      createdBy: "vitest",
    });

    expect(result.runs[0]?.findings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: "phase6_market_item_owner_mismatch",
          severity: "critical",
          sourceId: orderId,
          userId: buyerUserId,
          detail: expect.objectContaining({
            item_instance_id: itemInstanceId,
            item_owner_user_id: sellerUserId,
            expected_owner_user_id: buyerUserId,
            item_source_type: "market",
            item_source_id: orderId,
          }),
        }),
      ]),
    );
  });

  it("detects market ledger source, fee formula, and order item link mismatches", async () => {
    const orderId = "aaaa2222-1111-4111-8111-111111111111";
    const listingId = "dddd2222-1111-4111-8111-111111111111";
    const listingItemId = "eeee2222-1111-4111-8111-111111111111";
    const db = createDbMock({
      "market.orders": [
        {
          id: orderId,
          buyer_user_id: "bbbb2222-1111-4111-8111-111111111111",
          seller_user_id: "cccc2222-1111-4111-8111-111111111111",
          listing_id: listingId,
          status: "completed",
          item_count: 1,
          total_price_kcoin: "100",
          fee_bps: 500,
          fee_amount_kcoin: "4",
          seller_net_amount_kcoin: "96",
          buyer_ledger_id: "11112222-2222-4222-8222-222222222222",
          seller_ledger_id: "22223333-2222-4222-8222-222222222222",
          completed_at: "2026-05-30T00:05:00.000Z",
          created_at: "2026-05-30T00:00:00.000Z",
        },
      ],
      "economy.currency_ledger": [
        {
          id: "11112222-2222-4222-8222-222222222222",
          user_id: "bbbb2222-1111-4111-8111-111111111111",
          currency_code: "KCOIN",
          entry_type: "debit",
          amount: "100",
          source_type: "market_purchase",
          source_id: orderId,
        },
        {
          id: "22223333-2222-4222-8222-222222222222",
          user_id: "cccc2222-1111-4111-8111-111111111111",
          currency_code: "KCOIN",
          entry_type: "credit",
          amount: "96",
          source_type: "market_sell",
          source_id: "99992222-2222-4222-8222-222222222222",
        },
      ],
      "market.fee_settlements": [
        {
          id: "33334444-2222-4222-8222-222222222222",
          market_order_id: orderId,
          currency_code: "KCOIN",
          fee_amount: "5",
          fee_bps: 400,
          status: "settled",
        },
      ],
      "market.order_items": [
        {
          order_id: orderId,
          listing_item_id: listingItemId,
          item_instance_id: "ffff2222-1111-4111-8111-111111111111",
        },
      ],
      "market.listing_items": [
        {
          id: listingItemId,
          listing_id: listingId,
          item_instance_id: "ffff2222-2222-4111-8111-111111111111",
          status: "sold",
          buyer_user_id: "bbbb2222-1111-4111-8111-111111111111",
          sold_order_id: orderId,
        },
      ],
      "market.listings": [
        {
          id: listingId,
          seller_user_id: "cccc2222-1111-4111-8111-111111111111",
          status: "sold",
          item_count: 1,
          remaining_count: 0,
        },
      ],
      "inventory.item_instances": [],
      "ops.risk_events": [],
      "economy.reconciliation_runs": [],
    });

    const result = await runPhase5Reconciliation({
      db: db.client,
      requestId: "req-reconcile-market-deep",
      runTypes: ["market_settlement"],
      limit: 20,
      createdBy: "vitest",
    });
    const findingCodes = result.runs[0]?.findings.map((finding) => finding.code);

    expect(findingCodes).toEqual(
      expect.arrayContaining([
        "phase6_market_order_amount_formula_mismatch",
        "phase6_market_buyer_ledger_mismatch",
        "phase6_market_seller_ledger_mismatch",
        "phase6_market_fee_settlement_mismatch",
        "phase6_market_order_item_link_mismatch",
      ]),
    );
  });

  it("records inventory, gacha and referral reconciliation findings", async () => {
    const db = createDbMock({
      "inventory.inventory_locks": [
        {
          id: "11112222-1111-4111-8111-111111111111",
          item_instance_id: "22223333-1111-4111-8111-111111111111",
          user_id: "33334444-1111-4111-8111-111111111111",
          lock_type: "mint",
          source_type: "mint_queue",
          source_id: "44445555-1111-4111-8111-111111111111",
          status: "active",
          locked_at: "2026-05-30T00:00:00.000Z",
          expires_at: null,
        },
        {
          id: "11112222-2222-4111-8111-111111111111",
          item_instance_id: "22223333-2222-4111-8111-111111111111",
          user_id: "33334444-2222-4111-8111-111111111111",
          lock_type: "mint",
          source_type: "mint_queue",
          source_id: "44445555-2222-4111-8111-111111111111",
          status: "active",
          locked_at: "2026-05-30T00:00:00.000Z",
          expires_at: null,
        },
      ],
      "inventory.item_instances": [
        {
          id: "22223333-2222-4111-8111-111111111111",
          owner_user_id: "33334444-2222-4111-8111-111111111111",
          source_type: "gacha",
          source_id: "8888aaaa-2222-4111-8111-111111111111",
          nft_mint_status: "pending",
          minted_nft_item_id: null,
        },
      ],
      "onchain.mint_queue": [
        {
          id: "44445555-2222-4111-8111-111111111111",
          user_id: "33334444-2222-4111-8111-111111111111",
          item_instance_id: "22223333-2222-4111-8111-111111111111",
          status: "minted",
          nft_item_id: null,
          tx_hash: "minted-lock-tx",
          error_message: null,
          updated_at: "2026-05-30T00:30:00.000Z",
        },
      ],
      "gacha.blind_boxes": [
        {
          id: "55556666-1111-4111-8111-111111111111",
          total_stock: 10,
          remaining_stock: 9,
        },
        {
          id: "55556666-2222-4111-8111-111111111111",
          total_stock: 10,
          remaining_stock: 7,
        },
      ],
      "gacha.drop_pool_items": [
        {
          id: "66667777-1111-4111-8111-111111111111",
          pool_version_id: "77778888-1111-4111-8111-111111111111",
          stock_total: 5,
          stock_remaining: 4,
        },
        {
          id: "66667777-2222-4111-8111-111111111111",
          pool_version_id: "77778888-2222-4111-8111-111111111111",
          stock_total: 5,
          stock_remaining: 2,
        },
      ],
      "gacha.draw_results": [
        {
          id: "77779999-1111-4111-8111-111111111111",
          draw_order_id: "8888aaaa-1111-4111-8111-111111111111",
          user_id: "9999bbbb-1111-4111-8111-111111111111",
          box_id: "55556666-1111-4111-8111-111111111111",
          pool_version_id: "77778888-1111-4111-8111-111111111111",
          draw_index: 1,
          drop_pool_item_id: "66667777-1111-4111-8111-111111111111",
          item_instance_id: null,
        },
        {
          id: "aaaabbbb-1111-4111-8111-111111111111",
          draw_order_id: "8888aaaa-1111-4111-8111-111111111111",
          user_id: "9999bbbb-1111-4111-8111-111111111111",
          box_id: "55556666-1111-4111-8111-111111111111",
          pool_version_id: "77778888-1111-4111-8111-111111111111",
          draw_index: 2,
          drop_pool_item_id: "66667777-1111-4111-8111-111111111111",
          item_instance_id: null,
        },
        {
          id: "aaaabbbb-2222-4111-8111-111111111111",
          draw_order_id: "8888aaaa-2222-4111-8111-111111111111",
          user_id: "9999bbbb-2222-4111-8111-111111111111",
          box_id: "55556666-2222-4111-8111-111111111111",
          pool_version_id: "77778888-2222-4111-8111-111111111111",
          draw_index: 1,
          drop_pool_item_id: "66667777-2222-4111-8111-111111111111",
          item_instance_id: null,
        },
        {
          id: "aaaabbbb-3333-4111-8111-111111111111",
          draw_order_id: "8888aaaa-2222-4111-8111-111111111111",
          user_id: "9999bbbb-2222-4111-8111-111111111111",
          box_id: "55556666-2222-4111-8111-111111111111",
          pool_version_id: "77778888-2222-4111-8111-111111111111",
          draw_index: 2,
          drop_pool_item_id: "66667777-2222-4111-8111-111111111111",
          item_instance_id: null,
        },
        {
          id: "aaaabbbb-4444-4111-8111-111111111111",
          draw_order_id: "8888aaaa-3333-4111-8111-111111111111",
          user_id: "9999bbbb-3333-4111-8111-111111111111",
          box_id: "55556666-1111-4111-8111-111111111111",
          pool_version_id: "77778888-1111-4111-8111-111111111111",
          draw_index: 3,
          drop_pool_item_id: null,
          item_instance_id: null,
        },
      ],
      "tasks.referrals": [
        {
          id: "bbbbcccc-1111-4111-8111-111111111111",
          inviter_user_id: "ccccdddd-1111-4111-8111-111111111111",
          invitee_user_id: "ddddeeee-1111-4111-8111-111111111111",
          first_open_order_id: "eeeeffff-1111-4111-8111-111111111111",
          status: "rewarded",
          qualified_at: "2026-05-30T00:00:00.000Z",
          rewarded_at: "2026-05-30T00:01:00.000Z",
        },
      ],
      "tasks.referral_rewards": [],
      "tasks.referral_commissions": [
        {
          id: "ffff0000-1111-4111-8111-111111111111",
          referral_id: "bbbbcccc-1111-4111-8111-111111111111",
          inviter_user_id: "ccccdddd-1111-4111-8111-111111111111",
          invitee_user_id: "ddddeeee-1111-4111-8111-111111111111",
          source_type: "draw_order",
          source_id: "eeeeffff-1111-4111-8111-111111111111",
          ledger_id: null,
          status: "granted",
        },
        {
          id: "ffff0000-2222-4111-8111-111111111111",
          referral_id: "bbbbcccc-1111-4111-8111-111111111111",
          inviter_user_id: "ccccdddd-1111-4111-8111-111111111111",
          invitee_user_id: "ddddeeee-1111-4111-8111-111111111111",
          source_type: "draw_order",
          source_id: "eeeeffff-1111-4111-8111-111111111111",
          ledger_id: null,
          status: "granted",
        },
      ],
      "ops.risk_events": [],
      "economy.reconciliation_runs": [],
    });

    const result = await runPhase5Reconciliation({
      db: db.client,
      requestId: "req-reconcile-phase6-extra-types",
      runTypes: ["inventory_lock", "gacha_stock", "referral_commission"],
      limit: 20,
      createdBy: "vitest",
      now: new Date("2026-05-30T01:00:00.000Z"),
    });
    const findingCodes = result.runs.flatMap((run) =>
      run.findings.map((finding) => finding.code),
    );

    expect(findingCodes).toEqual(
      expect.arrayContaining([
        "phase6_inventory_lock_item_missing",
        "phase6_inventory_mint_lock_terminal_queue",
        "phase6_gacha_box_stock_mismatch",
        "phase6_gacha_pool_item_stock_mismatch",
        "phase6_gacha_draw_result_pool_item_missing",
        "phase6_referral_first_open_reward_mismatch",
        "phase6_referral_commission_duplicate",
        "phase6_referral_commission_ledger_missing",
      ]),
    );
    expect(result.riskEventCount).toBeGreaterThanOrEqual(6);
  });

  it("paginates gacha draw results before comparing stock counters", async () => {
    const drawCount = 5_005;
    const boxId = "box-paged-gacha";
    const poolItemId = "pool-item-paged-gacha";
    const drawResults = Array.from({ length: drawCount }, (_, index) => ({
      id: `draw-result-paged-${index}`,
      draw_order_id: `draw-order-paged-${Math.floor(index / 10)}`,
      user_id: "user-paged-gacha",
      box_id: boxId,
      pool_version_id: "pool-version-paged-gacha",
      draw_index: index + 1,
      drop_pool_item_id: poolItemId,
      item_instance_id: null,
    }));
    const db = createDbMock({
      "gacha.blind_boxes": [
        {
          id: boxId,
          total_stock: drawCount,
          remaining_stock: 0,
        },
      ],
      "gacha.drop_pool_items": [
        {
          id: poolItemId,
          pool_version_id: "pool-version-paged-gacha",
          stock_total: drawCount,
          stock_remaining: 0,
        },
      ],
      "gacha.draw_results": drawResults,
      "ops.risk_events": [],
      "economy.reconciliation_runs": [],
    });

    const result = await runPhase5Reconciliation({
      db: db.client,
      requestId: "req-reconcile-gacha-paged",
      runTypes: ["gacha_stock"],
      limit: 20,
      createdBy: "vitest",
    });
    const findingCodes = result.runs[0]?.findings.map((finding) => finding.code);

    expect(findingCodes).not.toContain("phase6_gacha_box_stock_mismatch");
    expect(findingCodes).not.toContain(
      "phase6_gacha_pool_item_stock_mismatch",
    );
    expect(result.runs[0]?.checkedCount).toBe(drawCount + 2);
  });

  it("detects missing referral commissions while allowing pending and batch-claimed commissions", async () => {
    const referralId = "bbbbcccc-2222-4111-8111-111111111111";
    const inviterUserId = "ccccdddd-2222-4111-8111-111111111111";
    const inviteeUserId = "ddddeeee-2222-4111-8111-111111111111";
    const firstOpenOrderId = "eeeeffff-2222-4111-8111-111111111111";
    const missingOrderId = "eeeeffff-3333-4111-8111-111111111111";
    const pendingOrderId = "eeeeffff-4444-4111-8111-111111111111";
    const grantedOrderId = "eeeeffff-5555-4111-8111-111111111111";
    const grantedCommissionId = "ffff0000-5555-4111-8111-111111111111";
    const db = createDbMock({
      "tasks.referrals": [
        {
          id: referralId,
          inviter_user_id: inviterUserId,
          invitee_user_id: inviteeUserId,
          first_open_order_id: firstOpenOrderId,
          status: "rewarded",
          qualified_at: "2026-05-30T00:00:00.000Z",
          rewarded_at: "2026-05-30T00:01:00.000Z",
        },
      ],
      "tasks.referral_rewards": [
        {
          id: "reward-inviter",
          referral_id: referralId,
          user_id: inviterUserId,
          reward_role: "inviter",
          currency_code: "KCOIN",
          amount: "500",
          ledger_id: "ledger-reward-inviter",
          status: "granted",
        },
        {
          id: "reward-invitee",
          referral_id: referralId,
          user_id: inviteeUserId,
          reward_role: "invitee",
          currency_code: "KCOIN",
          amount: "500",
          ledger_id: "ledger-reward-invitee",
          status: "granted",
        },
      ],
      "tasks.referral_commissions": [
        {
          id: "ffff0000-4444-4111-8111-111111111111",
          referral_id: referralId,
          inviter_user_id: inviterUserId,
          invitee_user_id: inviteeUserId,
          source_type: "gacha_open",
          source_id: pendingOrderId,
          base_amount_kcoin: "100",
          commission_bps: 1000,
          commission_amount_kcoin: "10",
          ledger_id: null,
          status: "pending",
        },
        {
          id: grantedCommissionId,
          referral_id: referralId,
          inviter_user_id: inviterUserId,
          invitee_user_id: inviteeUserId,
          source_type: "gacha_open",
          source_id: grantedOrderId,
          base_amount_kcoin: "100",
          commission_bps: 1000,
          commission_amount_kcoin: "10",
          ledger_id: null,
          status: "granted",
        },
      ],
      "gacha.draw_orders": [
        {
          id: firstOpenOrderId,
          user_id: inviteeUserId,
          payment_star_order_id: null,
          status: "completed",
          quantity: 1,
          draw_count: 1,
          open_reward_kcoin: 100,
        },
        {
          id: missingOrderId,
          user_id: inviteeUserId,
          payment_star_order_id: null,
          status: "completed",
          quantity: 1,
          draw_count: 1,
          open_reward_kcoin: 100,
        },
        {
          id: pendingOrderId,
          user_id: inviteeUserId,
          payment_star_order_id: null,
          status: "completed",
          quantity: 1,
          draw_count: 1,
          open_reward_kcoin: 100,
        },
        {
          id: grantedOrderId,
          user_id: inviteeUserId,
          payment_star_order_id: null,
          status: "completed",
          quantity: 1,
          draw_count: 1,
          open_reward_kcoin: 100,
        },
      ],
      "gacha.draw_results": [
        {
          id: "draw-result-first",
          draw_order_id: firstOpenOrderId,
          user_id: inviteeUserId,
          box_id: "box-referral",
          pool_version_id: "pool-version-referral",
          draw_index: 1,
          drop_pool_item_id: "pool-item-referral",
          item_instance_id: null,
        },
        {
          id: "draw-result-missing",
          draw_order_id: missingOrderId,
          user_id: inviteeUserId,
          box_id: "box-referral",
          pool_version_id: "pool-version-referral",
          draw_index: 1,
          drop_pool_item_id: "pool-item-referral",
          item_instance_id: null,
        },
        {
          id: "draw-result-pending",
          draw_order_id: pendingOrderId,
          user_id: inviteeUserId,
          box_id: "box-referral",
          pool_version_id: "pool-version-referral",
          draw_index: 1,
          drop_pool_item_id: "pool-item-referral",
          item_instance_id: null,
        },
        {
          id: "draw-result-granted",
          draw_order_id: grantedOrderId,
          user_id: inviteeUserId,
          box_id: "box-referral",
          pool_version_id: "pool-version-referral",
          draw_index: 1,
          drop_pool_item_id: "pool-item-referral",
          item_instance_id: null,
        },
      ],
      "economy.currency_ledger": [
        {
          id: "ledger-reward-inviter",
          user_id: inviterUserId,
          currency_code: "KCOIN",
          entry_type: "credit",
          amount: "500",
          available_after: "500",
          locked_after: "0",
          source_type: "referral_first_open",
          source_id: referralId,
          metadata: {},
          created_at: "2026-05-30T00:01:00.000Z",
        },
        {
          id: "ledger-reward-invitee",
          user_id: inviteeUserId,
          currency_code: "KCOIN",
          entry_type: "credit",
          amount: "500",
          available_after: "500",
          locked_after: "0",
          source_type: "referral_first_open",
          source_id: referralId,
          metadata: {},
          created_at: "2026-05-30T00:01:00.000Z",
        },
        {
          id: "ledger-commission-batch",
          user_id: inviterUserId,
          currency_code: "KCOIN",
          entry_type: "credit",
          amount: "20",
          available_after: "520",
          locked_after: "0",
          source_type: "referral_commission_claim",
          source_id: null,
          metadata: {
            commission_ids: [
              grantedCommissionId,
              "ffff0000-6666-4111-8111-111111111111",
            ],
          },
          created_at: "2026-05-30T00:02:00.000Z",
        },
      ],
      "ops.risk_events": [],
      "economy.reconciliation_runs": [],
    });

    const result = await runPhase5Reconciliation({
      db: db.client,
      requestId: "req-reconcile-referral-missing",
      runTypes: ["referral_commission"],
      limit: 20,
      createdBy: "vitest",
    });
    const findingCodes = result.runs[0]?.findings.map((finding) => finding.code);

    expect(findingCodes).toContain("phase6_referral_commission_missing");
    expect(findingCodes).not.toContain(
      "phase6_referral_commission_ledger_missing",
    );
    expect(findingCodes).not.toContain(
      "phase6_referral_commission_ledger_mismatch",
    );
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

  it("rejects invalid run types on the phase 6 reconciliation cron endpoint", async () => {
    const result = await invokeApiHandler(reconciliationCronHandler, {
      method: "GET",
      url: "/api/cron/reconciliation?runTypes=invalid",
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

function createDbMock(
  rows: TableRows,
  options?: { failures?: QueryFailure[] },
): {
  client: SupabaseAdminClient;
  rows: TableRows;
  operations: QueryOperation[];
} {
  const mutableRows = Object.fromEntries(
    Object.entries(rows).map(([key, value]) => [key, [...value]]),
  );
  const failures = [...(options?.failures ?? [])];
  const operations: QueryOperation[] = [];
  const client = {
    rpc: (rpcName: string, args: Record<string, unknown>) =>
      createRpcQuery(rpcName, args, mutableRows),
    schema: (schema: string) => ({
      from: (table: string) =>
        createQueryBuilder(schema, table, mutableRows, operations, failures),
      rpc: (rpcName: string, args: Record<string, unknown>) =>
        createRpcQuery(rpcName, args, mutableRows),
    }),
  };

  return {
    client: client as unknown as SupabaseAdminClient,
    rows: mutableRows,
    operations,
  };
}

function createRpcQuery(
  rpcName: string,
  args: Record<string, unknown>,
  rows: TableRows,
) {
  let response:
    | (QueryResult & {
        count: number | null;
        status: number;
        statusText: string;
      })
    | null = null;
  const getResponse = () => {
    response ??= resolveRpcOperation(rpcName, args, rows);
    return response;
  };

  const query = {
    abortSignal: () => query,
    then: (
      resolve: (value: QueryResult & {
        count: number | null;
        status: number;
        statusText: string;
      }) => unknown,
      reject?: (reason: unknown) => unknown,
    ) => Promise.resolve(resolve(getResponse())).catch(reject),
  };

  return query;
}

function resolveRpcOperation(
  rpcName: string,
  args: Record<string, unknown>,
  rows: TableRows,
): QueryResult & {
  count: number | null;
  status: number;
  statusText: string;
} {
  if (rpcName !== "risk_record_event") {
    return {
      data: null,
      error: {
        message: `unsupported rpc in test mock: ${rpcName}`,
      },
      count: null,
      status: 400,
      statusText: "Bad Request",
    };
  }

  const riskEvents = rows["ops.risk_events"] ?? [];
  rows["ops.risk_events"] = riskEvents;
  const inserted = {
    id: `mock-risk_events-${riskEvents.length + 1}`,
    user_id: args.p_user_id ?? null,
    event_type: args.p_event_type,
    severity: args.p_severity ?? "medium",
    status: "open",
    source_type: args.p_source_type ?? null,
    source_id: args.p_source_id ?? null,
    score_delta: args.p_score_delta ?? 0,
    detail:
      args.p_detail !== null &&
      typeof args.p_detail === "object" &&
      !Array.isArray(args.p_detail)
        ? args.p_detail
        : {},
    resolved_by_admin_id: null,
    resolved_at: null,
    created_at: "2026-05-29T00:00:00.000Z",
  };

  riskEvents.push(inserted);

  return {
    data: {
      risk_event_id: inserted.id,
      severity: inserted.severity,
      score_delta: inserted.score_delta,
      status: inserted.status,
      idempotent: false,
    },
    error: null,
    count: null,
    status: 200,
    statusText: "OK",
  };
}

function createQueryBuilder(
  schema: string,
  table: string,
  rows: TableRows,
  operations: QueryOperation[],
  failures: QueryFailure[],
) {
  const operation: QueryOperation = {
    schema,
    table,
    operation: "select",
    payload: null,
    filters: [],
    selected: null,
    limitValue: null,
    rangeFrom: null,
    rangeTo: null,
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
    range: (from: number, to: number) => {
      operation.rangeFrom = from;
      operation.rangeTo = to;
      return builder;
    },
    maybeSingle: () =>
      Promise.resolve(resolveOperation(operation, rows, failures, true)),
    single: () =>
      Promise.resolve(resolveOperation(operation, rows, failures, true)),
    then: (
      resolve: (value: QueryResult) => unknown,
      reject?: (reason: unknown) => unknown,
    ) =>
      Promise.resolve(
        resolve(resolveOperation(operation, rows, failures, false)),
      ).catch(reject),
  };

  return builder;
}

function resolveOperation(
  operation: QueryOperation,
  rows: TableRows,
  failures: QueryFailure[],
  single: boolean,
): QueryResult {
  const failure = failures.find(
    (candidate) =>
      candidate.schema === operation.schema &&
      candidate.table === operation.table &&
      (!candidate.operation || candidate.operation === operation.operation),
  );

  if (failure) {
    const error: QueryError = { message: failure.message };

    if (failure.code) {
      error.code = failure.code;
    }

    return {
      data: single ? null : [],
      error,
    };
  }

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

  if (operation.rangeFrom !== null && operation.rangeTo !== null) {
    matchedRows = matchedRows.slice(operation.rangeFrom, operation.rangeTo + 1);
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
