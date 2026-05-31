import type { Json } from "../db/database.js";
import {
  getSupabaseAdminClient,
  type SupabaseAdminClient,
} from "../db/supabaseAdmin.js";

export type Phase5ReconciliationRunType =
  | "payment_fulfillment"
  | "mint_queue"
  | "wallet_sync"
  | "ledger_balance"
  | "market_settlement"
  | "inventory_lock"
  | "gacha_stock"
  | "referral_commission";

export type ReconciliationRunType = Phase5ReconciliationRunType;

export type ReconciliationSeverity = "low" | "medium" | "high" | "critical";

export type Phase5ReconciliationFinding = {
  code: string;
  message: string;
  severity: ReconciliationSeverity;
  suggestedAction: string;
  sourceType: string;
  sourceId: string | null;
  userId: string | null;
  starOrderId?: string | null | undefined;
  drawOrderId?: string | null | undefined;
  paymentChargeId?: string | null | undefined;
  mintQueueId?: string | null | undefined;
  txHash?: string | null | undefined;
  detail: Record<string, unknown>;
};

export type Phase5ReconciliationRunResult = {
  runType: Phase5ReconciliationRunType;
  runId: string;
  status: "success";
  checkedCount: number;
  findingCount: number;
  criticalCount: number;
  riskEventCount: number;
  riskEventInsertedCount: number;
  riskEventExistingCount: number;
  riskEventSkippedCount: number;
  elapsedMs: number;
  severityCounts: Record<ReconciliationSeverity, number>;
  findings: Phase5ReconciliationFinding[];
};

export type Phase5ReconciliationResult = {
  requestId: string;
  startedAt: string;
  finishedAt: string;
  limit: number;
  checkedCount: number;
  findingCount: number;
  criticalCount: number;
  riskEventCount: number;
  riskEventInsertedCount: number;
  riskEventExistingCount: number;
  riskEventSkippedCount: number;
  elapsedMs: number;
  runs: Phase5ReconciliationRunResult[];
  serverTime: string;
};

export type RunPhase5ReconciliationInput = {
  db?: SupabaseAdminClient | undefined;
  requestId: string;
  runTypes?: Phase5ReconciliationRunType[] | undefined;
  limit?: number | undefined;
  createdBy?: string | undefined;
  writeRiskEvents?: boolean | undefined;
  now?: Date | undefined;
};

type StarOrderRow = {
  id: string;
  user_id: string;
  business_id: string | null;
  status: string;
  paid_at: string | null;
  fulfilled_at: string | null;
  error_message: string | null;
  created_at: string;
  updated_at: string;
};

type StarPaymentRow = {
  id: string;
  star_order_id: string;
  telegram_payment_charge_id: string;
  xtr_amount: number | string;
  paid_at: string;
};

type DrawOrderRow = {
  id: string;
  user_id: string;
  box_id?: string | null | undefined;
  pool_version_id?: string | null | undefined;
  payment_star_order_id: string | null;
  status: string;
  quantity: number | string;
  draw_count: number | string;
  open_reward_kcoin?: number | string | null | undefined;
};

type DrawResultRow = {
  id: string;
  draw_order_id: string;
  user_id: string;
  box_id?: string | null | undefined;
  pool_version_id?: string | null | undefined;
  draw_index: number | string;
  drop_pool_item_id?: string | null | undefined;
  item_instance_id: string | null;
};

type ItemInstanceRow = {
  id: string;
  owner_user_id: string | null;
  source_type: string;
  source_id: string | null;
  nft_mint_status: string;
  minted_nft_item_id: string | null;
};

type UserBalanceRow = {
  user_id: string;
  currency_code: string;
  available_amount: number | string;
  locked_amount: number | string;
  updated_at: string;
};

type CurrencyLedgerRow = {
  id: string;
  user_id: string | null;
  currency_code: string;
  entry_type?: string | undefined;
  amount?: number | string | null | undefined;
  available_after: number | string | null;
  locked_after: number | string | null;
  source_type?: string | undefined;
  source_id?: string | null | undefined;
  metadata?: Json | undefined;
  created_at: string;
};

type MintQueueRow = {
  id: string;
  user_id: string;
  item_instance_id: string;
  status: string;
  nft_item_id: string | null;
  tx_hash: string | null;
  error_message: string | null;
  updated_at: string;
};

type NftItemRow = {
  id: string;
  item_instance_id: string | null;
  minted_tx_hash: string | null;
  status: string;
};

type OnchainTransactionRow = {
  id: string;
  user_id: string | null;
  related_type: string | null;
  related_id: string | null;
  status: string;
  tx_hash: string | null;
  confirmed_at: string | null;
};

type WalletSyncJobRow = {
  id: string;
  user_id: string;
  wallet_id: string;
  status: string;
  sync_type: string;
  error_message: string | null;
  updated_at: string;
};

type MarketOrderRow = {
  id: string;
  buyer_user_id: string;
  seller_user_id: string;
  listing_id: string;
  status: string;
  item_count: number | string;
  total_price_kcoin: number | string;
  fee_bps: number | string;
  fee_amount_kcoin: number | string;
  seller_net_amount_kcoin: number | string;
  buyer_ledger_id: string | null;
  seller_ledger_id: string | null;
  completed_at: string | null;
  created_at: string;
};

type MarketListingRow = {
  id: string;
  seller_user_id: string;
  status: string;
  item_count: number | string;
  remaining_count: number | string;
};

type MarketListingItemRow = {
  id: string;
  listing_id: string;
  item_instance_id: string;
  status: string;
  buyer_user_id: string | null;
  sold_order_id: string | null;
};

type MarketOrderItemRow = {
  order_id: string;
  listing_item_id: string;
  item_instance_id: string;
};

type MarketFeeSettlementRow = {
  id: string;
  market_order_id: string;
  currency_code: string;
  fee_amount: number | string;
  fee_bps: number | string;
  status: string;
};

type MarketLedgerRow = {
  id: string;
  user_id: string | null;
  currency_code: string;
  entry_type: string;
  amount: number | string;
  source_type: string;
  source_id: string | null;
};

type InventoryLockRow = {
  id: string;
  item_instance_id: string;
  user_id: string;
  lock_type: string;
  source_type: string;
  source_id: string | null;
  status: string;
  locked_at: string;
  expires_at: string | null;
};

type BlindBoxRow = {
  id: string;
  total_stock: number | string | null;
  remaining_stock: number | string | null;
};

type DropPoolItemRow = {
  id: string;
  pool_version_id: string;
  stock_total: number | string | null;
  stock_remaining: number | string | null;
};

type ReferralRow = {
  id: string;
  inviter_user_id: string;
  invitee_user_id: string;
  first_open_order_id: string | null;
  status: string;
  qualified_at: string | null;
  rewarded_at: string | null;
};

type ReferralRewardRow = {
  id: string;
  referral_id: string;
  user_id: string;
  reward_role: string;
  currency_code?: string | undefined;
  amount?: number | string | undefined;
  ledger_id: string | null;
  status: string;
};

type ReferralCommissionRow = {
  id: string;
  referral_id: string;
  inviter_user_id: string;
  invitee_user_id: string;
  source_type: string;
  source_id: string | null;
  base_amount_kcoin?: number | string | undefined;
  commission_bps?: number | string | undefined;
  commission_amount_kcoin?: number | string | undefined;
  ledger_id: string | null;
  status: string;
};

type RiskEventWriteCounts = {
  inserted: number;
  existing: number;
  skipped: number;
};

type ReconciliationCollectionResult = {
  checkedCount: number;
  findings: Phase5ReconciliationFinding[];
};

const DEFAULT_RUN_TYPES: Phase5ReconciliationRunType[] = [
  "payment_fulfillment",
  "mint_queue",
  "wallet_sync",
  "ledger_balance",
  "market_settlement",
  "inventory_lock",
  "gacha_stock",
  "referral_commission",
];
const PAID_LIFECYCLE_STAR_ORDER_STATUSES = [
  "paid",
  "fulfilling",
  "fulfilled",
  "failed",
  "refunded",
  "disputed",
] as const;
const FULFILLMENT_RETRY_STAR_ORDER_STATUSES = new Set<string>([
  "paid",
  "fulfilling",
  "failed",
]);
const DEFAULT_LIMIT = 500;
const MAX_LIMIT = 2_000;
const MAX_RELATED_ROW_LIMIT = 5_000;
const RELATED_ROW_PAGE_SIZE = 1_000;
const MAX_IN_FILTER_VALUES = 200;
const WALLET_SYNC_STUCK_MS = 30 * 60 * 1000;

export async function runPhase5Reconciliation(
  input: RunPhase5ReconciliationInput,
): Promise<Phase5ReconciliationResult> {
  const db = input.db ?? getSupabaseAdminClient();
  const startedAtDate = input.now ?? new Date();
  const startedAt = startedAtDate.toISOString();
  const startedAtMs = Date.now();
  const limit = normalizeLimit(input.limit);
  const runTypes = input.runTypes?.length ? input.runTypes : DEFAULT_RUN_TYPES;
  const results: Phase5ReconciliationRunResult[] = [];

  for (const runType of runTypes) {
    results.push(
      await runSingleReconciliation({
        db,
        runType,
        requestId: input.requestId,
        limit,
        createdBy: input.createdBy ?? "phase5-reconciliation",
        writeRiskEvents: input.writeRiskEvents !== false,
        now: input.now ?? new Date(),
      }),
    );
  }

  const finishedAt = new Date().toISOString();
  const summary = summarizeRuns(results);

  return {
    requestId: input.requestId,
    startedAt,
    finishedAt,
    limit,
    checkedCount: summary.checkedCount,
    findingCount: summary.findingCount,
    criticalCount: summary.criticalCount,
    riskEventCount: summary.riskEventCount,
    riskEventInsertedCount: summary.riskEventInsertedCount,
    riskEventExistingCount: summary.riskEventExistingCount,
    riskEventSkippedCount: summary.riskEventSkippedCount,
    elapsedMs: Date.now() - startedAtMs,
    runs: results,
    serverTime: finishedAt,
  };
}

async function runSingleReconciliation(input: {
  db: SupabaseAdminClient;
  runType: Phase5ReconciliationRunType;
  requestId: string;
  limit: number;
  createdBy: string;
  writeRiskEvents: boolean;
  now: Date;
}): Promise<Phase5ReconciliationRunResult> {
  const startedAtMs = Date.now();
  const runId = await createReconciliationRun(input);
  const dryRun = !input.writeRiskEvents;

  try {
    const collection = await collectFindings(input);
    const findings = sortFindings(collection.findings).slice(0, input.limit);
    const severityCounts = countFindingsBySeverity(findings);
    const riskEventCounts = input.writeRiskEvents
      ? await writeRiskEvents(input.db, {
          requestId: input.requestId,
          runId,
          runType: input.runType,
          findings,
        })
      : emptyRiskEventWriteCounts();
    const riskEventCount = riskEventCounts.inserted;

    await finishReconciliationRun(input.db, runId, "success", {
      request_id: input.requestId,
      run_type: input.runType,
      dry_run: dryRun,
      write_risk_events: input.writeRiskEvents,
      checked_count: collection.checkedCount,
      finding_count: findings.length,
      critical_count: severityCounts.critical,
      severity_counts: severityCounts,
      risk_event_count: riskEventCount,
      risk_event_inserted_count: riskEventCounts.inserted,
      risk_event_existing_count: riskEventCounts.existing,
      risk_event_skipped_count: riskEventCounts.skipped,
      elapsed_ms: Date.now() - startedAtMs,
      suggested_action: summarizeSuggestedAction(findings),
      findings: findings.map(serializeFinding),
    });

    console.info("[phase5-reconciliation:success]", {
      requestId: input.requestId,
      runType: input.runType,
      runId,
      findingCount: findings.length,
      riskEventCount,
      riskEventInsertedCount: riskEventCounts.inserted,
      riskEventExistingCount: riskEventCounts.existing,
      riskEventSkippedCount: riskEventCounts.skipped,
    });

    return {
      runType: input.runType,
      runId,
      status: "success",
      checkedCount: collection.checkedCount,
      findingCount: findings.length,
      criticalCount: severityCounts.critical,
      riskEventCount,
      riskEventInsertedCount: riskEventCounts.inserted,
      riskEventExistingCount: riskEventCounts.existing,
      riskEventSkippedCount: riskEventCounts.skipped,
      elapsedMs: Date.now() - startedAtMs,
      severityCounts,
      findings,
    };
  } catch (error) {
    await finishReconciliationRun(
      input.db,
      runId,
      "failed",
      {
        request_id: input.requestId,
        run_type: input.runType,
      },
      getErrorMessage(error),
    );

    throw error;
  }
}

async function collectFindings(input: {
  db: SupabaseAdminClient;
  runType: Phase5ReconciliationRunType;
  requestId: string;
  limit: number;
  now: Date;
}): Promise<ReconciliationCollectionResult> {
  switch (input.runType) {
    case "payment_fulfillment":
      return collectPaymentFulfillmentFindings(input);
    case "mint_queue":
      return collectMintQueueFindings(input);
    case "wallet_sync":
      return collectWalletSyncFindings(input);
    case "ledger_balance":
      return collectLedgerBalanceFindings(input);
    case "market_settlement":
      return collectMarketSettlementFindings(input);
    case "inventory_lock":
      return collectInventoryLockFindings(input);
    case "gacha_stock":
      return collectGachaStockFindings(input);
    case "referral_commission":
      return collectReferralCommissionFindings(input);
  }
}

async function collectPaymentFulfillmentFindings(input: {
  db: SupabaseAdminClient;
  requestId: string;
  limit: number;
}): Promise<ReconciliationCollectionResult> {
  const orders = await selectMany<StarOrderRow>(
    input.db
      .schema("payments")
      .from("star_orders")
      .select(
        "id,user_id,business_id,status,paid_at,fulfilled_at,error_message,created_at,updated_at",
      )
      .in("status", [...PAID_LIFECYCLE_STAR_ORDER_STATUSES])
      .order("updated_at", { ascending: false })
      .limit(input.limit),
    "RECONCILIATION_PAYMENT_ORDER_LOOKUP_FAILED",
  );
  const orderIds = uniqueStrings(orders.map((row) => row.id));
  const drawOrderIds = uniqueStrings(orders.map((row) => row.business_id));
  const [payments, drawOrdersByBusinessId, drawOrdersByStarOrderId] =
    await Promise.all([
      orderIds.length
        ? selectMany<StarPaymentRow>(
            input.db
              .schema("payments")
              .from("star_payments")
              .select(
                "id,star_order_id,telegram_payment_charge_id,xtr_amount,paid_at",
              )
              .in("star_order_id", orderIds)
              .limit(input.limit),
            "RECONCILIATION_STAR_PAYMENT_LOOKUP_FAILED",
          )
        : Promise.resolve([]),
      drawOrderIds.length
        ? selectMany<DrawOrderRow>(
            input.db
              .schema("gacha")
              .from("draw_orders")
              .select(
                "id,user_id,payment_star_order_id,status,quantity,draw_count",
              )
              .in("id", drawOrderIds)
              .limit(input.limit),
            "RECONCILIATION_DRAW_ORDER_LOOKUP_FAILED",
          )
        : Promise.resolve([]),
      orderIds.length
        ? selectMany<DrawOrderRow>(
            input.db
              .schema("gacha")
              .from("draw_orders")
              .select(
                "id,user_id,payment_star_order_id,status,quantity,draw_count",
              )
              .in("payment_star_order_id", orderIds)
              .limit(input.limit),
            "RECONCILIATION_DRAW_ORDER_PAYMENT_LOOKUP_FAILED",
          )
        : Promise.resolve([]),
    ]);
  const paymentsByOrder = groupBy(payments, (row) => row.star_order_id);
  const drawOrders = uniqueById([
    ...drawOrdersByBusinessId,
    ...drawOrdersByStarOrderId,
  ]);
  const drawOrdersById = mapById(drawOrders);
  const drawOrdersByPayment = new Map(
    drawOrders
      .filter((row) => row.payment_star_order_id)
      .map((row) => [row.payment_star_order_id as string, row]),
  );
  const allDrawOrderIds = uniqueStrings(drawOrders.map((row) => row.id));
  const relatedLimit = Math.min(input.limit * 10, MAX_RELATED_ROW_LIMIT);
  const results = allDrawOrderIds.length
    ? await selectMany<DrawResultRow>(
        input.db
          .schema("gacha")
          .from("draw_results")
          .select("id,draw_order_id,user_id,draw_index,item_instance_id")
          .in("draw_order_id", allDrawOrderIds)
          .limit(relatedLimit),
        "RECONCILIATION_DRAW_RESULT_LOOKUP_FAILED",
      )
    : [];
  const resultsByOrder = groupBy(results, (row) => row.draw_order_id);
  const itemIds = uniqueStrings(results.map((row) => row.item_instance_id));
  const items = itemIds.length
    ? await selectMany<ItemInstanceRow>(
        input.db
          .schema("inventory")
          .from("item_instances")
          .select(
            "id,owner_user_id,source_type,source_id,nft_mint_status,minted_nft_item_id",
          )
          .in("id", itemIds)
          .limit(relatedLimit),
        "RECONCILIATION_ITEM_INSTANCE_LOOKUP_FAILED",
      )
    : [];
  const itemsById = mapById(items);
  const findings: Phase5ReconciliationFinding[] = [];

  for (const order of orders) {
    const payment = paymentsByOrder.get(order.id)?.[0] ?? null;
    const drawOrder =
      (order.business_id ? drawOrdersById.get(order.business_id) : null) ??
      drawOrdersByPayment.get(order.id) ??
      null;
    const relatedResults = drawOrder
      ? (resultsByOrder.get(drawOrder.id) ?? [])
      : [];

    if (
      FULFILLMENT_RETRY_STAR_ORDER_STATUSES.has(order.status) &&
      order.paid_at &&
      !order.fulfilled_at
    ) {
      findings.push(
        buildFinding({
          code: "phase5_payment_paid_not_fulfilled",
          message: "Stars order is paid but not fulfilled.",
          severity: "high",
          sourceType: "star_order",
          sourceId: order.id,
          userId: order.user_id,
          starOrderId: order.id,
          drawOrderId: drawOrder?.id ?? order.business_id,
          paymentChargeId: payment?.telegram_payment_charge_id ?? null,
          detail: {
            payment_order_status: order.status,
            paid_at: order.paid_at,
            fulfilled_at: order.fulfilled_at,
            error_message: order.error_message,
          },
        }),
      );
    }

    if (order.status === "fulfilled" && relatedResults.length === 0) {
      findings.push(
        buildFinding({
          code: "phase5_fulfilled_without_draw_results",
          message: "Stars order is fulfilled but has no draw results.",
          severity: "critical",
          sourceType: "star_order",
          sourceId: order.id,
          userId: order.user_id,
          starOrderId: order.id,
          drawOrderId: drawOrder?.id ?? order.business_id,
          paymentChargeId: payment?.telegram_payment_charge_id ?? null,
          detail: {
            payment_order_status: order.status,
            draw_order_found: Boolean(drawOrder),
          },
        }),
      );
    }

    if (!drawOrder) {
      continue;
    }

    const expectedCount =
      readPositiveInteger(drawOrder.draw_count) ??
      readPositiveInteger(drawOrder.quantity);

    if (expectedCount !== null && relatedResults.length !== expectedCount) {
      findings.push(
        buildFinding({
          code: "phase5_draw_result_count_mismatch",
          message: "Draw result count does not match the draw order count.",
          severity: "critical",
          sourceType: "draw_order",
          sourceId: drawOrder.id,
          userId: drawOrder.user_id,
          starOrderId: order.id,
          drawOrderId: drawOrder.id,
          paymentChargeId: payment?.telegram_payment_charge_id ?? null,
          detail: {
            expected_count: expectedCount,
            actual_count: relatedResults.length,
            draw_order_status: drawOrder.status,
          },
        }),
      );
    }

    for (const result of relatedResults) {
      const item = result.item_instance_id
        ? itemsById.get(result.item_instance_id)
        : null;

      if (!result.item_instance_id || !item) {
        findings.push(
          buildFinding({
            code: "phase5_draw_result_item_missing",
            message: "Draw result points to a missing item instance.",
            severity: "critical",
            sourceType: "draw_result",
            sourceId: result.id,
            userId: result.user_id,
            starOrderId: order.id,
            drawOrderId: drawOrder.id,
            paymentChargeId: payment?.telegram_payment_charge_id ?? null,
            detail: {
              draw_index: result.draw_index,
              item_instance_id: result.item_instance_id,
            },
          }),
        );
        continue;
      }

      if (
        item.owner_user_id !== result.user_id ||
        item.source_type !== "gacha" ||
        item.source_id !== drawOrder.id
      ) {
        findings.push(
          buildFinding({
            code: "phase5_draw_result_item_mismatch",
            message:
              "Draw result item instance ownership or source is inconsistent.",
            severity: "high",
            sourceType: "draw_result",
            sourceId: result.id,
            userId: result.user_id,
            starOrderId: order.id,
            drawOrderId: drawOrder.id,
            paymentChargeId: payment?.telegram_payment_charge_id ?? null,
            detail: {
              draw_index: result.draw_index,
              item_instance_id: result.item_instance_id,
              item_owner_user_id: item.owner_user_id,
              item_source_type: item.source_type,
              item_source_id: item.source_id,
            },
          }),
        );
      }
    }
  }

  return {
    checkedCount: orders.length + drawOrders.length + results.length,
    findings,
  };
}

async function collectLedgerBalanceFindings(input: {
  db: SupabaseAdminClient;
  limit: number;
}): Promise<ReconciliationCollectionResult> {
  const [balances, ledgerRows] = await Promise.all([
    selectMany<UserBalanceRow>(
      input.db
        .schema("economy")
        .from("user_balances")
        .select(
          "user_id,currency_code,available_amount,locked_amount,updated_at",
        )
        .limit(input.limit),
      "RECONCILIATION_BALANCE_LOOKUP_FAILED",
    ),
    selectMany<CurrencyLedgerRow>(
      input.db
        .schema("economy")
        .from("currency_ledger")
        .select(
          "id,user_id,currency_code,available_after,locked_after,created_at",
        )
        .order("created_at", { ascending: false })
        .limit(Math.min(input.limit * 10, MAX_RELATED_ROW_LIMIT)),
      "RECONCILIATION_LEDGER_LOOKUP_FAILED",
    ),
  ]);
  const latestLedger = new Map<string, CurrencyLedgerRow>();

  for (const row of ledgerRows) {
    if (
      !row.user_id ||
      row.available_after === null ||
      row.locked_after === null
    ) {
      continue;
    }

    const key = balanceKey(row.user_id, row.currency_code);
    if (!latestLedger.has(key)) {
      latestLedger.set(key, row);
    }
  }

  const findings: Phase5ReconciliationFinding[] = [];

  for (const balance of balances) {
    const ledger = latestLedger.get(
      balanceKey(balance.user_id, balance.currency_code),
    );
    if (!ledger) {
      continue;
    }

    const balanceAvailable = toNumber(balance.available_amount);
    const balanceLocked = toNumber(balance.locked_amount);
    const ledgerAvailable = toNumber(ledger.available_after);
    const ledgerLocked = toNumber(ledger.locked_after);

    if (
      balanceAvailable !== ledgerAvailable ||
      balanceLocked !== ledgerLocked
    ) {
      findings.push(
        buildFinding({
          code: "phase5_ledger_balance_mismatch",
          message:
            "User balance snapshot does not match the latest ledger row.",
          severity: "critical",
          sourceType: "user_balance",
          sourceId: balance.user_id,
          userId: balance.user_id,
          detail: {
            currency_code: balance.currency_code,
            balance_available: balanceAvailable,
            balance_locked: balanceLocked,
            ledger_available_after: ledgerAvailable,
            ledger_locked_after: ledgerLocked,
            ledger_id: ledger.id,
            ledger_created_at: ledger.created_at,
            balance_updated_at: balance.updated_at,
          },
        }),
      );
    }
  }

  return {
    checkedCount: balances.length,
    findings,
  };
}

async function collectMintQueueFindings(input: {
  db: SupabaseAdminClient;
  limit: number;
}): Promise<ReconciliationCollectionResult> {
  const [mintedQueues, confirmedTransactions] = await Promise.all([
    selectMany<MintQueueRow>(
      input.db
        .schema("onchain")
        .from("mint_queue")
        .select(
          "id,user_id,item_instance_id,status,nft_item_id,tx_hash,error_message,updated_at",
        )
        .eq("status", "minted")
        .order("updated_at", { ascending: false })
        .limit(input.limit),
      "RECONCILIATION_MINTED_QUEUE_LOOKUP_FAILED",
    ),
    selectMany<OnchainTransactionRow>(
      input.db
        .schema("onchain")
        .from("transactions")
        .select(
          "id,user_id,related_type,related_id,status,tx_hash,confirmed_at",
        )
        .eq("related_type", "mint_queue")
        .eq("status", "confirmed")
        .order("confirmed_at", { ascending: false, nullsFirst: false })
        .limit(input.limit),
      "RECONCILIATION_CONFIRMED_TX_LOOKUP_FAILED",
    ),
  ]);
  const nftItemIds = uniqueStrings(mintedQueues.map((row) => row.nft_item_id));
  const queueIdsFromTransactions = uniqueStrings(
    confirmedTransactions.map((row) => row.related_id),
  );
  const [nftItems, queuesByTx] = await Promise.all([
    nftItemIds.length
      ? selectMany<NftItemRow>(
          input.db
            .schema("onchain")
            .from("nft_items")
            .select("id,item_instance_id,minted_tx_hash,status")
            .in("id", nftItemIds)
            .limit(input.limit),
          "RECONCILIATION_NFT_ITEM_LOOKUP_FAILED",
        )
      : Promise.resolve([]),
    queueIdsFromTransactions.length
      ? selectMany<MintQueueRow>(
          input.db
            .schema("onchain")
            .from("mint_queue")
            .select(
              "id,user_id,item_instance_id,status,nft_item_id,tx_hash,error_message,updated_at",
            )
            .in("id", queueIdsFromTransactions)
            .limit(input.limit),
          "RECONCILIATION_TX_QUEUE_LOOKUP_FAILED",
        )
      : Promise.resolve([]),
  ]);
  const nftItemsById = mapById(nftItems);
  const queuesById = mapById(queuesByTx);
  const findings: Phase5ReconciliationFinding[] = [];

  for (const queue of mintedQueues) {
    const nftItem = queue.nft_item_id
      ? nftItemsById.get(queue.nft_item_id)
      : null;

    if (!queue.nft_item_id || !nftItem) {
      findings.push(
        buildFinding({
          code: "phase5_minted_queue_nft_item_missing",
          message: "Mint queue is minted but the linked NFT item is missing.",
          severity: "critical",
          sourceType: "mint_queue",
          sourceId: queue.id,
          userId: queue.user_id,
          mintQueueId: queue.id,
          txHash: queue.tx_hash,
          detail: {
            nft_item_id: queue.nft_item_id,
            item_instance_id: queue.item_instance_id,
            queue_status: queue.status,
          },
        }),
      );
      continue;
    }

    if (nftItem.item_instance_id !== queue.item_instance_id) {
      findings.push(
        buildFinding({
          code: "phase5_minted_queue_nft_item_mismatch",
          message:
            "Minted NFT item does not match the mint queue item instance.",
          severity: "high",
          sourceType: "mint_queue",
          sourceId: queue.id,
          userId: queue.user_id,
          mintQueueId: queue.id,
          txHash: queue.tx_hash ?? nftItem.minted_tx_hash,
          detail: {
            nft_item_id: nftItem.id,
            nft_item_instance_id: nftItem.item_instance_id,
            queue_item_instance_id: queue.item_instance_id,
            nft_status: nftItem.status,
          },
        }),
      );
    }
  }

  for (const transaction of confirmedTransactions) {
    if (!transaction.related_id) {
      continue;
    }

    const queue = queuesById.get(transaction.related_id);

    if (!queue || queue.status !== "minted") {
      findings.push(
        buildFinding({
          code: "phase5_confirmed_tx_queue_not_minted",
          message:
            "Onchain transaction is confirmed but the mint queue is not minted.",
          severity: "critical",
          sourceType: "onchain_transaction",
          sourceId: transaction.id,
          userId: transaction.user_id ?? queue?.user_id ?? null,
          mintQueueId: transaction.related_id,
          txHash: transaction.tx_hash,
          detail: {
            transaction_status: transaction.status,
            confirmed_at: transaction.confirmed_at,
            queue_found: Boolean(queue),
            queue_status: queue?.status ?? null,
          },
        }),
      );
    }
  }

  return {
    checkedCount: mintedQueues.length + confirmedTransactions.length,
    findings,
  };
}

async function collectWalletSyncFindings(input: {
  db: SupabaseAdminClient;
  limit: number;
  now: Date;
}): Promise<ReconciliationCollectionResult> {
  const rows = await selectMany<WalletSyncJobRow>(
    input.db
      .schema("onchain")
      .from("wallet_sync_jobs")
      .select("id,user_id,wallet_id,status,sync_type,error_message,updated_at")
      .in("status", ["processing", "failed"])
      .order("updated_at", { ascending: true })
      .limit(input.limit),
    "RECONCILIATION_WALLET_SYNC_LOOKUP_FAILED",
  );
  const stuckBefore = input.now.getTime() - WALLET_SYNC_STUCK_MS;
  const findings: Phase5ReconciliationFinding[] = [];

  for (const row of rows) {
    const isFailed = row.status === "failed";
    const isStuck =
      row.status === "processing" &&
      new Date(row.updated_at).getTime() < stuckBefore;

    if (!isFailed && !isStuck) {
      continue;
    }

    findings.push(
      buildFinding({
        code: isFailed
          ? "phase5_wallet_sync_failed"
          : "phase5_wallet_sync_stuck",
        message: isFailed
          ? "Wallet sync job failed."
          : "Wallet sync job is stuck in processing.",
        severity: isFailed ? "medium" : "high",
        sourceType: "wallet_sync_job",
        sourceId: row.id,
        userId: row.user_id,
        detail: {
          wallet_id: row.wallet_id,
          sync_type: row.sync_type,
          status: row.status,
          error_message: row.error_message,
          updated_at: row.updated_at,
        },
      }),
    );
  }

  return {
    checkedCount: rows.length,
    findings,
  };
}

async function collectMarketSettlementFindings(input: {
  db: SupabaseAdminClient;
  limit: number;
}): Promise<ReconciliationCollectionResult> {
  const orders = await selectMany<MarketOrderRow>(
    input.db
      .schema("market")
      .from("orders")
      .select(
        "id,buyer_user_id,seller_user_id,listing_id,status,item_count,total_price_kcoin,fee_bps,fee_amount_kcoin,seller_net_amount_kcoin,buyer_ledger_id,seller_ledger_id,completed_at,created_at",
      )
      .eq("status", "completed")
      .order("created_at", { ascending: false })
      .limit(input.limit),
    "RECONCILIATION_MARKET_ORDER_LOOKUP_FAILED",
  );
  const orderIds = uniqueStrings(orders.map((row) => row.id));
  const listingIds = uniqueStrings(orders.map((row) => row.listing_id));
  const ledgerIds = uniqueStrings(
    orders.flatMap((row) => [row.buyer_ledger_id, row.seller_ledger_id]),
  );
  const [ledgers, feeSettlements, listingItems, orderItems, listings] =
    await Promise.all([
      ledgerIds.length
        ? selectInChunks<MarketLedgerRow>(
            ledgerIds,
            (ids, from, to) =>
              input.db
                .schema("economy")
                .from("currency_ledger")
                .select(
                  "id,user_id,currency_code,entry_type,amount,source_type,source_id",
                )
                .in("id", ids)
                .range(from, to),
            "RECONCILIATION_MARKET_LEDGER_LOOKUP_FAILED",
          )
        : Promise.resolve([]),
      orderIds.length
        ? selectInChunks<MarketFeeSettlementRow>(
            orderIds,
            (ids, from, to) =>
              input.db
                .schema("market")
                .from("fee_settlements")
                .select(
                  "id,market_order_id,currency_code,fee_amount,fee_bps,status",
                )
                .in("market_order_id", ids)
                .range(from, to),
            "RECONCILIATION_MARKET_FEE_LOOKUP_FAILED",
          )
        : Promise.resolve([]),
      listingIds.length
        ? selectInChunks<MarketListingItemRow>(
            listingIds,
            (ids, from, to) =>
              input.db
                .schema("market")
                .from("listing_items")
                .select(
                  "id,listing_id,item_instance_id,status,buyer_user_id,sold_order_id",
                )
                .in("listing_id", ids)
                .range(from, to),
            "RECONCILIATION_MARKET_LISTING_ITEM_LOOKUP_FAILED",
          )
        : Promise.resolve([]),
      orderIds.length
        ? selectInChunks<MarketOrderItemRow>(
            orderIds,
            (ids, from, to) =>
              input.db
                .schema("market")
                .from("order_items")
                .select("order_id,listing_item_id,item_instance_id")
                .in("order_id", ids)
                .range(from, to),
            "RECONCILIATION_MARKET_ORDER_ITEM_LOOKUP_FAILED",
          )
        : Promise.resolve([]),
      listingIds.length
        ? selectInChunks<MarketListingRow>(
            listingIds,
            (ids, from, to) =>
              input.db
                .schema("market")
                .from("listings")
                .select("id,seller_user_id,status,item_count,remaining_count")
                .in("id", ids)
                .range(from, to),
            "RECONCILIATION_MARKET_LISTING_LOOKUP_FAILED",
          )
        : Promise.resolve([]),
    ]);
  const itemIds = uniqueStrings([
    ...listingItems.map((row) => row.item_instance_id),
    ...orderItems.map((row) => row.item_instance_id),
  ]);
  const itemInstances = itemIds.length
    ? await selectInChunks<ItemInstanceRow>(
        itemIds,
        (ids, from, to) =>
          input.db
            .schema("inventory")
            .from("item_instances")
            .select(
              "id,owner_user_id,source_type,source_id,nft_mint_status,minted_nft_item_id",
            )
            .in("id", ids)
            .range(from, to),
        "RECONCILIATION_MARKET_ITEM_INSTANCE_LOOKUP_FAILED",
      )
    : [];
  const ledgersById = mapById(ledgers);
  const feesByOrder = groupBy(feeSettlements, (row) => row.market_order_id);
  const listingItemsById = mapById(listingItems);
  const listingItemsByOrder = groupBy(listingItems, (row) => row.sold_order_id);
  const orderItemsByOrder = groupBy(orderItems, (row) => row.order_id);
  const listingsById = mapById(listings);
  const itemsById = mapById(itemInstances);
  const findings: Phase5ReconciliationFinding[] = [];

  for (const order of orders) {
    const buyerLedger = order.buyer_ledger_id
      ? ledgersById.get(order.buyer_ledger_id)
      : null;
    const sellerLedger = order.seller_ledger_id
      ? ledgersById.get(order.seller_ledger_id)
      : null;
    const orderFees = feesByOrder.get(order.id) ?? [];
    const soldListingItems = listingItemsByOrder.get(order.id) ?? [];
    const relatedOrderItems = orderItemsByOrder.get(order.id) ?? [];
    const listing = listingsById.get(order.listing_id) ?? null;
    const expectedItemCount = readPositiveInteger(order.item_count);
    const totalPrice = toNumber(order.total_price_kcoin);
    const feeBps = toNumber(order.fee_bps);
    const expectedFeeAmount = Math.floor((totalPrice * feeBps) / 10_000);
    const expectedSellerNetAmount = totalPrice - expectedFeeAmount;

    if (order.status === "completed") {
      if (
        toNumber(order.fee_amount_kcoin) !== expectedFeeAmount ||
        toNumber(order.seller_net_amount_kcoin) !== expectedSellerNetAmount
      ) {
        findings.push(
          buildFinding({
            code: "phase6_market_order_amount_formula_mismatch",
            message:
              "Completed market order fee or seller net amount does not match the fee formula.",
            severity: "high",
            sourceType: "market_order",
            sourceId: order.id,
            userId: order.seller_user_id,
            detail: {
              total_price_kcoin: totalPrice,
              fee_bps: feeBps,
              actual_fee_amount_kcoin: toNumber(order.fee_amount_kcoin),
              expected_fee_amount_kcoin: expectedFeeAmount,
              actual_seller_net_amount_kcoin: toNumber(
                order.seller_net_amount_kcoin,
              ),
              expected_seller_net_amount_kcoin: expectedSellerNetAmount,
            },
          }),
        );
      }

      if (!buyerLedger || !sellerLedger) {
        findings.push(
          buildFinding({
            code: "phase6_market_order_ledger_missing",
            message: "Completed market order is missing buyer or seller ledger.",
            severity: "critical",
            sourceType: "market_order",
            sourceId: order.id,
            userId: order.buyer_user_id,
            detail: {
              buyer_ledger_id: order.buyer_ledger_id,
              seller_ledger_id: order.seller_ledger_id,
            },
          }),
        );
      }

      if (
        buyerLedger &&
        (buyerLedger.user_id !== order.buyer_user_id ||
          buyerLedger.currency_code !== "KCOIN" ||
          buyerLedger.entry_type !== "debit" ||
          toNumber(buyerLedger.amount) !== totalPrice ||
          buyerLedger.source_type !== "market_buy" ||
          buyerLedger.source_id !== order.id)
      ) {
        findings.push(
          buildFinding({
            code: "phase6_market_buyer_ledger_mismatch",
            message: "Market buyer ledger does not match the completed order.",
            severity: "critical",
            sourceType: "market_order",
            sourceId: order.id,
            userId: order.buyer_user_id,
            detail: {
              buyer_ledger_id: buyerLedger.id,
              ledger_user_id: buyerLedger.user_id,
              ledger_currency_code: buyerLedger.currency_code,
              ledger_entry_type: buyerLedger.entry_type,
              ledger_amount: toNumber(buyerLedger.amount),
              ledger_source_type: buyerLedger.source_type,
              ledger_source_id: buyerLedger.source_id,
              expected_amount: totalPrice,
              expected_source_type: "market_buy",
              expected_source_id: order.id,
            },
          }),
        );
      }

      if (
        sellerLedger &&
        (sellerLedger.user_id !== order.seller_user_id ||
          sellerLedger.currency_code !== "KCOIN" ||
          sellerLedger.entry_type !== "credit" ||
          toNumber(sellerLedger.amount) !== expectedSellerNetAmount ||
          sellerLedger.source_type !== "market_sell" ||
          sellerLedger.source_id !== order.id)
      ) {
        findings.push(
          buildFinding({
            code: "phase6_market_seller_ledger_mismatch",
            message: "Market seller ledger does not match the completed order.",
            severity: "critical",
            sourceType: "market_order",
            sourceId: order.id,
            userId: order.seller_user_id,
            detail: {
              seller_ledger_id: sellerLedger.id,
              ledger_user_id: sellerLedger.user_id,
              ledger_currency_code: sellerLedger.currency_code,
              ledger_entry_type: sellerLedger.entry_type,
              ledger_amount: toNumber(sellerLedger.amount),
              ledger_source_type: sellerLedger.source_type,
              ledger_source_id: sellerLedger.source_id,
              expected_amount: expectedSellerNetAmount,
              expected_source_type: "market_sell",
              expected_source_id: order.id,
            },
          }),
        );
      }

      const settledFees = orderFees.filter((fee) => fee.status === "settled");
      const settledFee = settledFees[0] ?? null;
      if (
        settledFees.length !== 1 ||
        !settledFee ||
        settledFee.currency_code !== "KCOIN" ||
        toNumber(settledFee.fee_amount) !== expectedFeeAmount ||
        toNumber(settledFee.fee_bps) !== feeBps
      ) {
        findings.push(
          buildFinding({
            code: "phase6_market_fee_settlement_mismatch",
            message: "Market fee settlement is missing or inconsistent.",
            severity: "high",
            sourceType: "market_order",
            sourceId: order.id,
            userId: order.seller_user_id,
            detail: {
              fee_settlement_count: orderFees.length,
              settled_fee_count: settledFees.length,
              expected_fee_amount_kcoin: expectedFeeAmount,
              expected_fee_bps: feeBps,
              settled_fee_amount: settledFee
                ? toNumber(settledFee.fee_amount)
                : null,
              settled_fee_bps: settledFee ? toNumber(settledFee.fee_bps) : null,
              settled_fee_status: settledFee?.status ?? null,
            },
          }),
        );
      }

      if (
        expectedItemCount !== null &&
        relatedOrderItems.length !== expectedItemCount
      ) {
        findings.push(
          buildFinding({
            code: "phase6_market_order_item_count_mismatch",
            message: "Market order item count does not match the order header.",
            severity: "critical",
            sourceType: "market_order",
            sourceId: order.id,
            userId: order.buyer_user_id,
            detail: {
              expected_item_count: expectedItemCount,
              actual_order_item_count: relatedOrderItems.length,
            },
          }),
        );
      }

      if (soldListingItems.length !== relatedOrderItems.length) {
        findings.push(
          buildFinding({
            code: "phase6_market_order_item_link_mismatch",
            message:
              "Market order_items and listing_items do not agree on sold item count.",
            severity: "critical",
            sourceType: "market_order",
            sourceId: order.id,
            userId: order.buyer_user_id,
            detail: {
              sold_listing_item_count: soldListingItems.length,
              order_item_count: relatedOrderItems.length,
            },
          }),
        );
      }

      const relatedOrderItemKeys = new Set(
        relatedOrderItems.map(
          (row) => `${row.listing_item_id}:${row.item_instance_id}`,
        ),
      );

      for (const orderItem of relatedOrderItems) {
        const listingItem = listingItemsById.get(orderItem.listing_item_id);
        const item = itemsById.get(orderItem.item_instance_id);

        if (
          !listingItem ||
          listingItem.listing_id !== order.listing_id ||
          listingItem.item_instance_id !== orderItem.item_instance_id ||
          listingItem.status !== "sold" ||
          listingItem.buyer_user_id !== order.buyer_user_id ||
          listingItem.sold_order_id !== order.id
        ) {
          findings.push(
            buildFinding({
              code: "phase6_market_order_item_link_mismatch",
              message:
                "Market order_item is not backed by the expected sold listing_item.",
              severity: "critical",
              sourceType: "market_order",
              sourceId: order.id,
              userId: order.buyer_user_id,
              detail: {
                order_item_listing_item_id: orderItem.listing_item_id,
                order_item_item_instance_id: orderItem.item_instance_id,
                listing_item_found: Boolean(listingItem),
                listing_item_listing_id: listingItem?.listing_id ?? null,
                listing_item_item_instance_id:
                  listingItem?.item_instance_id ?? null,
                listing_item_status: listingItem?.status ?? null,
                listing_item_buyer_user_id: listingItem?.buyer_user_id ?? null,
                listing_item_sold_order_id: listingItem?.sold_order_id ?? null,
              },
            }),
          );
        }

        if (!item) {
          findings.push(
            buildFinding({
              code: "phase6_market_item_owner_mismatch",
              message:
                "Completed market order item ownership does not match the buyer.",
              severity: "critical",
              sourceType: "market_order",
              sourceId: order.id,
              userId: order.buyer_user_id,
              detail: {
                listing_item_id: orderItem.listing_item_id,
                item_instance_id: orderItem.item_instance_id,
                item_found: false,
                item_owner_user_id: null,
                expected_owner_user_id: order.buyer_user_id,
              },
            }),
          );
          continue;
        }

        if (item.owner_user_id !== order.buyer_user_id) {
          findings.push(
            buildFinding({
              code: "phase6_market_item_owner_mismatch",
              message:
                "Completed market order item ownership does not match the buyer.",
              severity: "critical",
              sourceType: "market_order",
              sourceId: order.id,
              userId: order.buyer_user_id,
              detail: {
                listing_item_id: orderItem.listing_item_id,
                item_instance_id: orderItem.item_instance_id,
                item_found: true,
                item_owner_user_id: item.owner_user_id,
                expected_owner_user_id: order.buyer_user_id,
                item_source_type: item.source_type,
                item_source_id: item.source_id,
              },
            }),
          );
        }
      }

      for (const listingItem of soldListingItems) {
        const hasOrderItem = relatedOrderItemKeys.has(
          `${listingItem.id}:${listingItem.item_instance_id}`,
        );

        if (!hasOrderItem) {
          findings.push(
            buildFinding({
              code: "phase6_market_order_item_link_mismatch",
              message:
                "Sold listing_item is missing the matching market order_item.",
              severity: "critical",
              sourceType: "market_order",
              sourceId: order.id,
              userId: order.buyer_user_id,
              detail: {
                listing_item_id: listingItem.id,
                item_instance_id: listingItem.item_instance_id,
                listing_item_status: listingItem.status,
                listing_item_buyer_user_id: listingItem.buyer_user_id,
                listing_item_sold_order_id: listingItem.sold_order_id,
              },
            }),
          );
        }
      }
    }

    if (listing && listing.seller_user_id !== order.seller_user_id) {
      findings.push(
        buildFinding({
          code: "phase6_market_listing_seller_mismatch",
          message: "Market listing seller does not match the order seller.",
          severity: "high",
          sourceType: "market_order",
          sourceId: order.id,
          userId: order.seller_user_id,
          detail: {
            listing_id: listing.id,
            listing_seller_user_id: listing.seller_user_id,
            order_seller_user_id: order.seller_user_id,
          },
        }),
      );
    }
  }

  return {
    checkedCount:
      orders.length +
      ledgers.length +
      feeSettlements.length +
      orderItems.length +
      listingItems.length +
      itemInstances.length,
    findings,
  };
}

async function collectInventoryLockFindings(input: {
  db: SupabaseAdminClient;
  limit: number;
  now: Date;
}): Promise<ReconciliationCollectionResult> {
  const locks = await selectMany<InventoryLockRow>(
    input.db
      .schema("inventory")
      .from("inventory_locks")
      .select(
        "id,item_instance_id,user_id,lock_type,source_type,source_id,status,locked_at,expires_at",
      )
      .eq("status", "active")
      .order("locked_at", { ascending: false })
      .limit(input.limit),
    "RECONCILIATION_INVENTORY_LOCK_LOOKUP_FAILED",
  );
  const itemIds = uniqueStrings(locks.map((row) => row.item_instance_id));
  const listingIds = uniqueStrings(
    locks
      .filter((row) => row.source_type === "market_listing")
      .map((row) => row.source_id),
  );
  const mintQueueIds = uniqueStrings(
    locks
      .filter(
        (row) => row.source_type === "mint_queue" || row.lock_type === "mint",
      )
      .map((row) => row.source_id),
  );
  const [items, listings, listingItems, mintQueues] = await Promise.all([
    itemIds.length
      ? selectInChunks<ItemInstanceRow>(
          itemIds,
          (ids, from, to) =>
            input.db
              .schema("inventory")
              .from("item_instances")
              .select(
                "id,owner_user_id,source_type,source_id,nft_mint_status,minted_nft_item_id",
              )
              .in("id", ids)
              .range(from, to),
          "RECONCILIATION_INVENTORY_LOCK_ITEM_LOOKUP_FAILED",
        )
      : Promise.resolve([]),
    listingIds.length
      ? selectInChunks<MarketListingRow>(
          listingIds,
          (ids, from, to) =>
            input.db
              .schema("market")
              .from("listings")
              .select("id,seller_user_id,status,item_count,remaining_count")
              .in("id", ids)
              .range(from, to),
          "RECONCILIATION_INVENTORY_LOCK_LISTING_LOOKUP_FAILED",
        )
      : Promise.resolve([]),
    listingIds.length
      ? selectInChunks<MarketListingItemRow>(
          listingIds,
          (ids, from, to) =>
            input.db
              .schema("market")
              .from("listing_items")
              .select(
                "id,listing_id,item_instance_id,status,buyer_user_id,sold_order_id",
              )
              .in("listing_id", ids)
              .range(from, to),
          "RECONCILIATION_INVENTORY_LOCK_LISTING_ITEM_LOOKUP_FAILED",
        )
      : Promise.resolve([]),
    mintQueueIds.length
      ? selectInChunks<MintQueueRow>(
          mintQueueIds,
          (ids, from, to) =>
            input.db
              .schema("onchain")
              .from("mint_queue")
              .select(
                "id,user_id,item_instance_id,status,nft_item_id,tx_hash,error_message,updated_at",
              )
              .in("id", ids)
              .range(from, to),
          "RECONCILIATION_INVENTORY_LOCK_MINT_QUEUE_LOOKUP_FAILED",
        )
      : Promise.resolve([]),
  ]);
  const itemsById = mapById(items);
  const listingsById = mapById(listings);
  const listingItemsByListing = groupBy(
    listingItems,
    (row) => row.listing_id,
  );
  const mintQueuesById = mapById(mintQueues);
  const nowMs = input.now.getTime();
  const findings: Phase5ReconciliationFinding[] = [];

  for (const lock of locks) {
    const item = itemsById.get(lock.item_instance_id) ?? null;

    if (!item) {
      findings.push(
        buildFinding({
          code: "phase6_inventory_lock_item_missing",
          message: "Active inventory lock points to a missing item instance.",
          severity: "critical",
          sourceType: "inventory_lock",
          sourceId: lock.id,
          userId: lock.user_id,
          detail: {
            item_instance_id: lock.item_instance_id,
            lock_type: lock.lock_type,
            source_type: lock.source_type,
            source_id: lock.source_id,
          },
        }),
      );
      continue;
    }

    if (item.owner_user_id !== lock.user_id) {
      findings.push(
        buildFinding({
          code: "phase6_inventory_lock_owner_mismatch",
          message: "Inventory lock user does not match item owner.",
          severity: "high",
          sourceType: "inventory_lock",
          sourceId: lock.id,
          userId: lock.user_id,
          detail: {
            item_instance_id: item.id,
            lock_user_id: lock.user_id,
            item_owner_user_id: item.owner_user_id,
          },
        }),
      );
    }

    if (lock.expires_at && new Date(lock.expires_at).getTime() < nowMs) {
      findings.push(
        buildFinding({
          code: "phase6_inventory_lock_expired_active",
          message: "Inventory lock is expired but still active.",
          severity: "medium",
          sourceType: "inventory_lock",
          sourceId: lock.id,
          userId: lock.user_id,
          detail: {
            item_instance_id: item.id,
            expires_at: lock.expires_at,
            locked_at: lock.locked_at,
          },
        }),
      );
    }

    if (lock.source_type === "market_listing") {
      const listing = lock.source_id ? listingsById.get(lock.source_id) : null;
      const lockListingItems = lock.source_id
        ? (listingItemsByListing.get(lock.source_id) ?? [])
        : [];
      const lockListingItem =
        lockListingItems.find(
          (row) => row.item_instance_id === lock.item_instance_id,
        ) ?? null;

      if (!listing || !["active", "partially_sold"].includes(listing.status)) {
        findings.push(
          buildFinding({
            code: "phase6_inventory_market_lock_source_invalid",
            message:
              "Active market inventory lock has no active listing source.",
            severity: "high",
            sourceType: "inventory_lock",
            sourceId: lock.id,
            userId: lock.user_id,
            detail: {
              source_id: lock.source_id,
              listing_found: Boolean(listing),
              listing_status: listing?.status ?? null,
            },
          }),
        );
      }

      if (listing && listing.seller_user_id !== lock.user_id) {
        findings.push(
          buildFinding({
            code: "phase6_inventory_market_lock_seller_mismatch",
            message:
              "Active market inventory lock user does not match listing seller.",
            severity: "high",
            sourceType: "inventory_lock",
            sourceId: lock.id,
            userId: lock.user_id,
            detail: {
              source_id: lock.source_id,
              listing_seller_user_id: listing.seller_user_id,
              lock_user_id: lock.user_id,
            },
          }),
        );
      }

      if (!lockListingItem || lockListingItem.status !== "reserved") {
        findings.push(
          buildFinding({
            code: "phase6_inventory_market_lock_listing_item_mismatch",
            message:
              "Active market inventory lock is not backed by a reserved listing item.",
            severity: "high",
            sourceType: "inventory_lock",
            sourceId: lock.id,
            userId: lock.user_id,
            detail: {
              source_id: lock.source_id,
              item_instance_id: lock.item_instance_id,
              listing_item_found: Boolean(lockListingItem),
              listing_item_id: lockListingItem?.id ?? null,
              listing_item_status: lockListingItem?.status ?? null,
              listing_item_buyer_user_id:
                lockListingItem?.buyer_user_id ?? null,
              listing_item_sold_order_id:
                lockListingItem?.sold_order_id ?? null,
            },
          }),
        );
      }

      continue;
    }

    if (lock.source_type === "mint_queue" || lock.lock_type === "mint") {
      const queue = lock.source_id ? mintQueuesById.get(lock.source_id) : null;
      const terminalStatuses = new Set(["minted", "failed", "cancelled"]);
      const activeStatuses = new Set([
        "queued",
        "processing",
        "submitted",
        "confirming",
        "retrying",
        "manual_review",
      ]);

      if (!queue) {
        findings.push(
          buildFinding({
            code: "phase6_inventory_mint_lock_source_invalid",
            message: "Active mint inventory lock has no mint queue source.",
            severity: "high",
            sourceType: "inventory_lock",
            sourceId: lock.id,
            userId: lock.user_id,
            mintQueueId: lock.source_id,
            detail: {
              source_type: lock.source_type,
              source_id: lock.source_id,
              item_instance_id: lock.item_instance_id,
            },
          }),
        );
        continue;
      }

      if (
        queue.user_id !== lock.user_id ||
        queue.item_instance_id !== lock.item_instance_id
      ) {
        findings.push(
          buildFinding({
            code: "phase6_inventory_mint_lock_mismatch",
            message:
              "Active mint inventory lock does not match the mint queue user or item.",
            severity: "high",
            sourceType: "inventory_lock",
            sourceId: lock.id,
            userId: lock.user_id,
            mintQueueId: queue.id,
            detail: {
              queue_user_id: queue.user_id,
              lock_user_id: lock.user_id,
              queue_item_instance_id: queue.item_instance_id,
              lock_item_instance_id: lock.item_instance_id,
              queue_status: queue.status,
            },
          }),
        );
      }

      if (terminalStatuses.has(queue.status)) {
        findings.push(
          buildFinding({
            code: "phase6_inventory_mint_lock_terminal_queue",
            message:
              "Active mint inventory lock points to a terminal mint queue.",
            severity: "high",
            sourceType: "inventory_lock",
            sourceId: lock.id,
            userId: lock.user_id,
            mintQueueId: queue.id,
            detail: {
              queue_status: queue.status,
              item_instance_id: lock.item_instance_id,
              source_id: lock.source_id,
            },
          }),
        );
      } else if (!activeStatuses.has(queue.status)) {
        findings.push(
          buildFinding({
            code: "phase6_inventory_mint_lock_source_invalid",
            message:
              "Active mint inventory lock points to an unsupported mint queue status.",
            severity: "medium",
            sourceType: "inventory_lock",
            sourceId: lock.id,
            userId: lock.user_id,
            mintQueueId: queue.id,
            detail: {
              queue_status: queue.status,
              item_instance_id: lock.item_instance_id,
              source_id: lock.source_id,
            },
          }),
        );
      }

      continue;
    }

    findings.push(
      buildFinding({
        code: "phase6_inventory_lock_source_unsupported",
        message: "Active inventory lock has an unsupported source type.",
        severity: lock.source_id ? "high" : "medium",
        sourceType: "inventory_lock",
        sourceId: lock.id,
        userId: lock.user_id,
        detail: {
          lock_type: lock.lock_type,
          source_type: lock.source_type,
          source_id: lock.source_id,
          item_instance_id: lock.item_instance_id,
        },
      }),
    );
  }

  return {
    checkedCount:
      locks.length +
      items.length +
      listings.length +
      listingItems.length +
      mintQueues.length,
    findings,
  };
}

async function collectGachaStockFindings(input: {
  db: SupabaseAdminClient;
  limit: number;
}): Promise<ReconciliationCollectionResult> {
  const [boxes, poolItems] = await Promise.all([
    selectMany<BlindBoxRow>(
      input.db
        .schema("gacha")
        .from("blind_boxes")
        .select("id,total_stock,remaining_stock")
        .limit(input.limit),
      "RECONCILIATION_GACHA_BOX_LOOKUP_FAILED",
    ),
    selectMany<DropPoolItemRow>(
      input.db
        .schema("gacha")
        .from("drop_pool_items")
        .select("id,pool_version_id,stock_total,stock_remaining")
        .limit(input.limit),
      "RECONCILIATION_GACHA_POOL_ITEM_LOOKUP_FAILED",
    ),
  ]);
  const boxIds = uniqueStrings(boxes.map((row) => row.id));
  const poolItemIds = uniqueStrings(poolItems.map((row) => row.id));
  const drawResults = uniqueById([
    ...(boxIds.length
      ? await selectInChunks<DrawResultRow>(
          boxIds,
          (ids, from, to) =>
            input.db
              .schema("gacha")
              .from("draw_results")
              .select(
                "id,draw_order_id,user_id,box_id,pool_version_id,draw_index,drop_pool_item_id,item_instance_id",
              )
              .in("box_id", ids)
              .range(from, to),
          "RECONCILIATION_GACHA_RESULT_BY_BOX_LOOKUP_FAILED",
        )
      : []),
    ...(poolItemIds.length
      ? await selectInChunks<DrawResultRow>(
          poolItemIds,
          (ids, from, to) =>
            input.db
              .schema("gacha")
              .from("draw_results")
              .select(
                "id,draw_order_id,user_id,box_id,pool_version_id,draw_index,drop_pool_item_id,item_instance_id",
              )
              .in("drop_pool_item_id", ids)
              .range(from, to),
          "RECONCILIATION_GACHA_RESULT_BY_POOL_ITEM_LOOKUP_FAILED",
        )
      : []),
  ]);
  const resultsByBox = groupBy(drawResults, (row) => row.box_id);
  const resultsByPoolItem = groupBy(drawResults, (row) => row.drop_pool_item_id);
  const findings: Phase5ReconciliationFinding[] = [];

  for (const box of boxes) {
    if (box.total_stock === null || box.remaining_stock === null) {
      continue;
    }

    const totalStock = toNumber(box.total_stock);
    const remainingStock = toNumber(box.remaining_stock);
    const producedCount = resultsByBox.get(box.id)?.length ?? 0;
    const consumedStock = totalStock - remainingStock;

    if (consumedStock !== producedCount) {
      findings.push(
        buildFinding({
          code: "phase6_gacha_box_stock_mismatch",
          message:
            "Blind box stock consumption does not match recorded draw output.",
          severity: consumedStock < producedCount ? "critical" : "high",
          sourceType: "blind_box",
          sourceId: box.id,
          userId: null,
          detail: {
            total_stock: totalStock,
            remaining_stock: remainingStock,
            consumed_stock: consumedStock,
            draw_result_count: producedCount,
          },
        }),
      );
    }
  }

  for (const drawResult of drawResults) {
    if (!drawResult.drop_pool_item_id) {
      findings.push(
        buildFinding({
          code: "phase6_gacha_draw_result_pool_item_missing",
          message: "Draw result is missing drop_pool_item_id for stock audit.",
          severity: "high",
          sourceType: "draw_result",
          sourceId: drawResult.id,
          userId: drawResult.user_id,
          drawOrderId: drawResult.draw_order_id,
          detail: {
            box_id: drawResult.box_id ?? null,
            pool_version_id: drawResult.pool_version_id ?? null,
            draw_index: drawResult.draw_index,
            item_instance_id: drawResult.item_instance_id,
          },
        }),
      );
    }
  }

  for (const poolItem of poolItems) {
    if (poolItem.stock_total === null || poolItem.stock_remaining === null) {
      continue;
    }

    const totalStock = toNumber(poolItem.stock_total);
    const remainingStock = toNumber(poolItem.stock_remaining);
    const producedCount = resultsByPoolItem.get(poolItem.id)?.length ?? 0;
    const consumedStock = totalStock - remainingStock;

    if (consumedStock !== producedCount) {
      findings.push(
        buildFinding({
          code: "phase6_gacha_pool_item_stock_mismatch",
          message:
            "Drop pool item stock consumption does not match draw output.",
          severity: consumedStock < producedCount ? "critical" : "high",
          sourceType: "drop_pool_item",
          sourceId: poolItem.id,
          userId: null,
          detail: {
            pool_version_id: poolItem.pool_version_id,
            stock_total: totalStock,
            stock_remaining: remainingStock,
            consumed_stock: consumedStock,
            draw_result_count: producedCount,
          },
        }),
      );
    }
  }

  return {
    checkedCount: boxes.length + poolItems.length + drawResults.length,
    findings,
  };
}

async function collectReferralCommissionFindings(input: {
  db: SupabaseAdminClient;
  limit: number;
}): Promise<ReconciliationCollectionResult> {
  const referrals = await selectMany<ReferralRow>(
    input.db
      .schema("tasks")
      .from("referrals")
      .select(
        "id,inviter_user_id,invitee_user_id,first_open_order_id,status,qualified_at,rewarded_at",
      )
      .in("status", ["qualified", "rewarded"])
      .order("updated_at", { ascending: false })
      .limit(input.limit),
    "RECONCILIATION_REFERRAL_LOOKUP_FAILED",
  );
  const referralIds = uniqueStrings(referrals.map((row) => row.id));
  const inviteeUserIds = uniqueStrings(
    referrals.map((row) => row.invitee_user_id),
  );
  const [rewards, commissions, drawOrders] = await Promise.all([
    referralIds.length
      ? selectInChunks<ReferralRewardRow>(
          referralIds,
          (ids, from, to) =>
            input.db
              .schema("tasks")
              .from("referral_rewards")
              .select(
                "id,referral_id,user_id,reward_role,currency_code,amount,ledger_id,status",
              )
              .in("referral_id", ids)
              .range(from, to),
          "RECONCILIATION_REFERRAL_REWARD_LOOKUP_FAILED",
        )
      : Promise.resolve([]),
    referralIds.length
      ? selectInChunks<ReferralCommissionRow>(
          referralIds,
          (ids, from, to) =>
            input.db
              .schema("tasks")
              .from("referral_commissions")
              .select(
                "id,referral_id,inviter_user_id,invitee_user_id,source_type,source_id,base_amount_kcoin,commission_bps,commission_amount_kcoin,ledger_id,status",
              )
              .in("referral_id", ids)
              .range(from, to),
          "RECONCILIATION_REFERRAL_COMMISSION_LOOKUP_FAILED",
        )
      : Promise.resolve([]),
    inviteeUserIds.length
      ? selectInChunks<DrawOrderRow>(
          inviteeUserIds,
          (ids, from, to) =>
            input.db
              .schema("gacha")
              .from("draw_orders")
              .select(
                "id,user_id,payment_star_order_id,status,quantity,draw_count,open_reward_kcoin",
              )
              .in("user_id", ids)
              .in("status", ["opening", "opened", "completed"])
              .range(from, to),
          "RECONCILIATION_REFERRAL_DRAW_ORDER_LOOKUP_FAILED",
        )
      : Promise.resolve([]),
  ]);
  const drawOrderIds = uniqueStrings(drawOrders.map((row) => row.id));
  const ledgerIds = uniqueStrings([
    ...rewards.map((row) => row.ledger_id),
    ...commissions.map((row) => row.ledger_id),
  ]);
  const [drawResults, linkedLedgers, commissionClaimLedgers] =
    await Promise.all([
      drawOrderIds.length
        ? selectInChunks<DrawResultRow>(
            drawOrderIds,
            (ids, from, to) =>
              input.db
                .schema("gacha")
                .from("draw_results")
                .select(
                  "id,draw_order_id,user_id,box_id,pool_version_id,draw_index,drop_pool_item_id,item_instance_id",
                )
                .in("draw_order_id", ids)
                .range(from, to),
            "RECONCILIATION_REFERRAL_DRAW_RESULT_LOOKUP_FAILED",
          )
        : Promise.resolve([]),
      ledgerIds.length
        ? selectInChunks<CurrencyLedgerRow>(
            ledgerIds,
            (ids, from, to) =>
              input.db
                .schema("economy")
                .from("currency_ledger")
                .select(
                  "id,user_id,currency_code,entry_type,amount,available_after,locked_after,source_type,source_id,metadata,created_at",
                )
                .in("id", ids)
                .range(from, to),
            "RECONCILIATION_REFERRAL_LEDGER_LOOKUP_FAILED",
          )
        : Promise.resolve([]),
      selectPagedMany<CurrencyLedgerRow>(
        (from, to) =>
          input.db
            .schema("economy")
            .from("currency_ledger")
            .select(
              "id,user_id,currency_code,entry_type,amount,available_after,locked_after,source_type,source_id,metadata,created_at",
            )
            .eq("source_type", "referral_commission_claim")
            .range(from, to),
        "RECONCILIATION_REFERRAL_CLAIM_LEDGER_LOOKUP_FAILED",
      ),
    ]);
  const rewardsByReferral = groupBy(rewards, (row) => row.referral_id);
  const commissionsByBusinessKey = groupBy(commissions, (row) =>
    row.source_id
      ? `${row.referral_id}:${row.source_type}:${row.source_id}`
      : null,
  );
  const referralsById = mapById(referrals);
  const drawOrdersByInvitee = groupBy(drawOrders, (row) => row.user_id);
  const drawResultsByOrder = groupBy(drawResults, (row) => row.draw_order_id);
  const allLedgers = uniqueById([...linkedLedgers, ...commissionClaimLedgers]);
  const ledgersById = mapById(allLedgers);
  const findings: Phase5ReconciliationFinding[] = [];

  for (const referral of referrals) {
    const relatedRewards = rewardsByReferral.get(referral.id) ?? [];
    const inviterRewards = relatedRewards.filter(
      (row) => row.reward_role === "inviter",
    );
    const inviteeRewards = relatedRewards.filter(
      (row) => row.reward_role === "invitee",
    );

    if (referral.rewarded_at || referral.status === "rewarded") {
      if (inviterRewards.length !== 1 || inviteeRewards.length !== 1) {
        findings.push(
          buildFinding({
            code: "phase6_referral_first_open_reward_mismatch",
            message:
              "Qualified referral does not have exactly one inviter and invitee reward.",
            severity: "high",
            sourceType: "referral",
            sourceId: referral.id,
            userId: referral.inviter_user_id,
            drawOrderId: referral.first_open_order_id,
            detail: {
              inviter_reward_count: inviterRewards.length,
              invitee_reward_count: inviteeRewards.length,
              first_open_order_id: referral.first_open_order_id,
              rewarded_at: referral.rewarded_at,
            },
          }),
        );
      }

      for (const reward of relatedRewards) {
        const expectedUserId =
          reward.reward_role === "inviter"
            ? referral.inviter_user_id
            : reward.reward_role === "invitee"
              ? referral.invitee_user_id
              : null;
        const rewardLedger = reward.ledger_id
          ? ledgersById.get(reward.ledger_id)
          : null;

        if (
          expectedUserId === null ||
          reward.user_id !== expectedUserId ||
          reward.currency_code !== "KCOIN" ||
          toNumber(reward.amount ?? null) <= 0
        ) {
          findings.push(
            buildFinding({
              code: "phase6_referral_first_open_reward_mismatch",
              message:
                "Referral first-open reward user, currency, or amount is inconsistent.",
              severity: "high",
              sourceType: "referral_reward",
              sourceId: reward.id,
              userId: reward.user_id,
              drawOrderId: referral.first_open_order_id,
              detail: {
                referral_id: reward.referral_id,
                reward_role: reward.reward_role,
                reward_user_id: reward.user_id,
                expected_user_id: expectedUserId,
                currency_code: reward.currency_code ?? null,
                amount: reward.amount ?? null,
              },
            }),
          );
        }

        if (reward.status === "granted" && !rewardLedger) {
          findings.push(
            buildFinding({
              code: "phase6_referral_reward_ledger_missing",
              message: "Granted referral reward is missing its ledger link.",
              severity: "critical",
              sourceType: "referral_reward",
              sourceId: reward.id,
              userId: reward.user_id,
              detail: {
                referral_id: reward.referral_id,
                reward_role: reward.reward_role,
                status: reward.status,
              },
            }),
          );
        } else if (
          reward.status === "granted" &&
          rewardLedger &&
          (rewardLedger.user_id !== reward.user_id ||
            rewardLedger.currency_code !== "KCOIN" ||
            rewardLedger.entry_type !== "credit" ||
            rewardLedger.source_type !== "referral_first_open" ||
            rewardLedger.source_id !== referral.id ||
            toNumber(rewardLedger.amount ?? null) !== toNumber(reward.amount ?? null))
        ) {
          findings.push(
            buildFinding({
              code: "phase6_referral_reward_ledger_mismatch",
              message:
                "Granted referral reward ledger does not match the reward row.",
              severity: "critical",
              sourceType: "referral_reward",
              sourceId: reward.id,
              userId: reward.user_id,
              detail: {
                referral_id: reward.referral_id,
                reward_role: reward.reward_role,
                ledger_id: rewardLedger.id,
                ledger_user_id: rewardLedger.user_id,
                ledger_currency_code: rewardLedger.currency_code,
                ledger_entry_type: rewardLedger.entry_type,
                ledger_amount: rewardLedger.amount ?? null,
                ledger_source_type: rewardLedger.source_type,
                ledger_source_id: rewardLedger.source_id,
                expected_source_type: "referral_first_open",
                expected_source_id: referral.id,
                expected_amount: reward.amount ?? null,
              },
            }),
          );
        }
      }

      const successfulDrawOrders =
        drawOrdersByInvitee.get(referral.invitee_user_id) ?? [];
      for (const drawOrder of successfulDrawOrders) {
        if (drawOrder.id === referral.first_open_order_id) {
          continue;
        }

        const requiredResultCount = getRequiredDrawResultCount(drawOrder);
        const actualResultCount =
          drawResultsByOrder.get(drawOrder.id)?.length ?? 0;
        const baseAmountKcoin = toNumber(drawOrder.open_reward_kcoin ?? null);
        if (
          baseAmountKcoin <= 0 ||
          actualResultCount < requiredResultCount
        ) {
          continue;
        }

        const key = `${referral.id}:gacha_open:${drawOrder.id}`;
        if ((commissionsByBusinessKey.get(key) ?? []).length === 0) {
          findings.push(
            buildFinding({
              code: "phase6_referral_commission_missing",
              message:
                "Rewarded referral has a successful later draw order without a referral commission.",
              severity: "high",
              sourceType: "draw_order",
              sourceId: drawOrder.id,
              userId: referral.inviter_user_id,
              drawOrderId: drawOrder.id,
              detail: {
                referral_id: referral.id,
                invitee_user_id: referral.invitee_user_id,
                draw_order_status: drawOrder.status,
                required_result_count: requiredResultCount,
                actual_result_count: actualResultCount,
                open_reward_kcoin: baseAmountKcoin,
                expected_source_type: "gacha_open",
              },
            }),
          );
        }
      }
    }
  }

  for (const [key, rows] of commissionsByBusinessKey) {
    if (rows.length <= 1) {
      continue;
    }

    const referral = referralsById.get(rows[0]?.referral_id ?? "");
    findings.push(
      buildFinding({
        code: "phase6_referral_commission_duplicate",
        message:
          "Referral commission business source has duplicate commission rows.",
        severity: "critical",
        sourceType: "referral_commission",
        sourceId: rows[0]?.id ?? null,
        userId: rows[0]?.inviter_user_id ?? null,
        drawOrderId: rows[0]?.source_id ?? referral?.first_open_order_id,
        detail: {
          business_key: key,
          commission_ids: rows.map((row) => row.id),
        },
      }),
    );
  }

  for (const commission of commissions) {
    if (commission.status !== "granted") {
      continue;
    }

    const ledger = findReferralCommissionLedger(
      commission,
      ledgersById,
      allLedgers,
    );

    if (!ledger) {
      findings.push(
        buildFinding({
          code: "phase6_referral_commission_ledger_missing",
          message: "Granted referral commission is missing its ledger link.",
          severity: "critical",
          sourceType: "referral_commission",
          sourceId: commission.id,
          userId: commission.inviter_user_id,
          drawOrderId: commission.source_id,
          detail: {
            referral_id: commission.referral_id,
            source_type: commission.source_type,
            source_id: commission.source_id,
            status: commission.status,
          },
        }),
      );
      continue;
    }

    if (isReferralCommissionLedgerMismatch(commission, ledger)) {
      findings.push(
        buildFinding({
          code: "phase6_referral_commission_ledger_mismatch",
          message:
            "Granted referral commission ledger does not match commission scope or amount.",
          severity: "critical",
          sourceType: "referral_commission",
          sourceId: commission.id,
          userId: commission.inviter_user_id,
          drawOrderId: commission.source_id,
          detail: {
            referral_id: commission.referral_id,
            source_type: commission.source_type,
            source_id: commission.source_id,
            status: commission.status,
            ledger_id: ledger.id,
            ledger_user_id: ledger.user_id,
            ledger_currency_code: ledger.currency_code,
            ledger_entry_type: ledger.entry_type,
            ledger_amount: ledger.amount ?? null,
            ledger_source_type: ledger.source_type,
            ledger_source_id: ledger.source_id,
            ledger_commission_ids: readLedgerCommissionIds(ledger),
            expected_amount: commission.commission_amount_kcoin ?? null,
          },
        }),
      );
    }
  }

  return {
    checkedCount:
      referrals.length +
      rewards.length +
      commissions.length +
      drawOrders.length +
      drawResults.length +
      allLedgers.length,
    findings,
  };
}

async function createReconciliationRun(input: {
  db: SupabaseAdminClient;
  runType: Phase5ReconciliationRunType;
  requestId: string;
  limit: number;
  createdBy: string;
  writeRiskEvents: boolean;
}): Promise<string> {
  const { data, error } = await input.db
    .schema("economy")
    .from("reconciliation_runs")
    .insert({
      run_type: input.runType,
      status: "running",
      result: toJson({
        request_id: input.requestId,
        limit: input.limit,
        dry_run: !input.writeRiskEvents,
        write_risk_events: input.writeRiskEvents,
      }),
      created_by: input.createdBy,
    })
    .select("id")
    .single();

  if (error || !data || typeof (data as { id?: unknown }).id !== "string") {
    if (isUniqueViolation(error)) {
      throw new Error(
        `RECONCILIATION_RUN_LOCKED: ${input.runType} already has a running reconciliation job`,
      );
    }

    throw new Error(
      `Failed to create reconciliation run: ${error?.message ?? "missing id"}`,
    );
  }

  return (data as { id: string }).id;
}

async function finishReconciliationRun(
  db: SupabaseAdminClient,
  runId: string,
  status: "success" | "failed",
  result: Record<string, unknown>,
  errorMessage?: string | null,
): Promise<void> {
  const { error } = await db
    .schema("economy")
    .from("reconciliation_runs")
    .update({
      status,
      finished_at: new Date().toISOString(),
      result: toJson(result),
      error_message: errorMessage ?? null,
    })
    .eq("id", runId);

  if (error) {
    throw new Error(`Failed to finish reconciliation run: ${error.message}`);
  }
}

async function writeRiskEvents(
  db: SupabaseAdminClient,
  input: {
    requestId: string;
    runId: string;
    runType: Phase5ReconciliationRunType;
    findings: Phase5ReconciliationFinding[];
  },
): Promise<RiskEventWriteCounts> {
  const counts = emptyRiskEventWriteCounts();

  for (const finding of input.findings) {
    logFinding(input.requestId, input.runId, input.runType, finding);

    if (!finding.sourceId) {
      counts.skipped += 1;
      continue;
    }

    if (finding.sourceId) {
      const existing = await selectMaybe<{ id: string }>(
        db
          .schema("ops")
          .from("risk_events")
          .select("id")
          .eq("event_type", finding.code)
          .eq("source_type", finding.sourceType)
          .eq("source_id", finding.sourceId)
          .in("status", ["open", "reviewing"])
          .limit(1)
          .maybeSingle(),
        "RECONCILIATION_RISK_EVENT_LOOKUP_FAILED",
      );

      if (existing) {
        counts.existing += 1;
        continue;
      }
    }

    const { error } = await db
      .schema("ops")
      .from("risk_events")
      .insert({
        user_id: finding.userId,
        event_type: finding.code,
        severity: finding.severity,
        status: "open",
        source_type: finding.sourceType,
        source_id: finding.sourceId,
        detail: toJson({
          ...finding.detail,
          request_id: input.requestId,
          reconciliation_run_id: input.runId,
          reconciliation_run_type: input.runType,
          message: finding.message,
          suggested_action: finding.suggestedAction,
          star_order_id: finding.starOrderId ?? null,
          draw_order_id: finding.drawOrderId ?? null,
          payment_charge_id: finding.paymentChargeId ?? null,
          mint_queue_id: finding.mintQueueId ?? null,
          tx_hash: finding.txHash ?? null,
        }),
      });

    if (error) {
      if (isUniqueViolation(error)) {
        counts.existing += 1;
        continue;
      }

      throw new Error(`Failed to write risk event: ${error.message}`);
    }

    counts.inserted += 1;
  }

  return counts;
}

function emptyRiskEventWriteCounts(): RiskEventWriteCounts {
  return {
    inserted: 0,
    existing: 0,
    skipped: 0,
  };
}

function buildFinding(
  input: Omit<Phase5ReconciliationFinding, "detail" | "suggestedAction"> & {
    detail?: Record<string, unknown> | undefined;
    suggestedAction?: string | undefined;
  },
): Phase5ReconciliationFinding {
  return {
    ...input,
    suggestedAction:
      input.suggestedAction ??
      getDefaultSuggestedAction(input.code, input.severity),
    detail: input.detail ?? {},
  };
}

function serializeFinding(finding: Phase5ReconciliationFinding) {
  return {
    code: finding.code,
    message: finding.message,
    severity: finding.severity,
    source_type: finding.sourceType,
    source_id: finding.sourceId,
    user_id: finding.userId,
    star_order_id: finding.starOrderId ?? null,
    draw_order_id: finding.drawOrderId ?? null,
    payment_charge_id: finding.paymentChargeId ?? null,
    mint_queue_id: finding.mintQueueId ?? null,
    tx_hash: finding.txHash ?? null,
    suggested_action: finding.suggestedAction,
    detail: finding.detail,
  };
}

function logFinding(
  requestId: string,
  runId: string,
  runType: Phase5ReconciliationRunType,
  finding: Phase5ReconciliationFinding,
): void {
  console.warn("[phase5-reconciliation:finding]", {
    requestId,
    runId,
    runType,
    code: finding.code,
    severity: finding.severity,
    userId: finding.userId,
    starOrderId: finding.starOrderId ?? null,
    drawOrderId: finding.drawOrderId ?? null,
    paymentChargeId: finding.paymentChargeId ?? null,
    mintQueueId: finding.mintQueueId ?? null,
    txHash: finding.txHash ?? null,
    sourceType: finding.sourceType,
    sourceId: finding.sourceId,
    suggestedAction: finding.suggestedAction,
  });
}

function summarizeRuns(
  runs: Phase5ReconciliationRunResult[],
): Pick<
  Phase5ReconciliationResult,
  | "checkedCount"
  | "findingCount"
  | "criticalCount"
  | "riskEventCount"
  | "riskEventInsertedCount"
  | "riskEventExistingCount"
  | "riskEventSkippedCount"
> {
  return runs.reduce(
    (summary, run) => ({
      checkedCount: summary.checkedCount + run.checkedCount,
      findingCount: summary.findingCount + run.findingCount,
      criticalCount: summary.criticalCount + run.criticalCount,
      riskEventCount: summary.riskEventCount + run.riskEventCount,
      riskEventInsertedCount:
        summary.riskEventInsertedCount + run.riskEventInsertedCount,
      riskEventExistingCount:
        summary.riskEventExistingCount + run.riskEventExistingCount,
      riskEventSkippedCount:
        summary.riskEventSkippedCount + run.riskEventSkippedCount,
    }),
    {
      checkedCount: 0,
      findingCount: 0,
      criticalCount: 0,
      riskEventCount: 0,
      riskEventInsertedCount: 0,
      riskEventExistingCount: 0,
      riskEventSkippedCount: 0,
    },
  );
}

function countFindingsBySeverity(
  findings: Phase5ReconciliationFinding[],
): Record<ReconciliationSeverity, number> {
  const counts: Record<ReconciliationSeverity, number> = {
    low: 0,
    medium: 0,
    high: 0,
    critical: 0,
  };

  for (const finding of findings) {
    counts[finding.severity] += 1;
  }

  return counts;
}

function sortFindings(
  findings: Phase5ReconciliationFinding[],
): Phase5ReconciliationFinding[] {
  const severityRank: Record<ReconciliationSeverity, number> = {
    critical: 0,
    high: 1,
    medium: 2,
    low: 3,
  };

  return [...findings].sort((left, right) => {
    const severityDiff =
      severityRank[left.severity] - severityRank[right.severity];

    if (severityDiff !== 0) {
      return severityDiff;
    }

    return left.code.localeCompare(right.code);
  });
}

function summarizeSuggestedAction(
  findings: Phase5ReconciliationFinding[],
): string {
  if (findings.length === 0) {
    return "No action required.";
  }

  if (findings.some((finding) => finding.severity === "critical")) {
    return "Review critical findings before retrying settlement, fulfillment, mint, or manual remediation.";
  }

  if (findings.some((finding) => finding.severity === "high")) {
    return "Review high severity findings and decide whether to retry, repair, ignore, or escalate.";
  }

  return "Review findings during the next operations pass.";
}

function getDefaultSuggestedAction(
  code: string,
  severity: ReconciliationSeverity,
): string {
  if (code.includes("ledger")) {
    return "Compare the linked ledger entry with the business record; create a corrective ledger adjustment only through an approved admin RPC.";
  }

  if (code.includes("payment") || code.includes("fulfilled")) {
    return "Inspect the Stars order, webhook event, and draw order; retry fulfillment only after confirming payment state.";
  }

  if (code.includes("market")) {
    return "Inspect the market order, listing items, fee settlement, and ledger links before any manual repair.";
  }

  if (code.includes("inventory")) {
    return "Inspect the item instance and active lock source; release or repair the lock only through audited admin operations.";
  }

  if (code.includes("gacha")) {
    return "Inspect the blind box or drop pool stock counters against draw results before changing live pool configuration.";
  }

  if (code.includes("referral")) {
    return "Inspect the referral, reward, commission, and ledger links; use audited task/admin flows for repair.";
  }

  if (code.includes("mint") || code.includes("tx")) {
    return "Inspect the mint queue, NFT item, and confirmed transaction; retry mint only when chain state is clear.";
  }

  if (code.includes("wallet")) {
    return "Inspect the wallet sync job and retry after checking latest on-chain sync logs.";
  }

  return severity === "critical"
    ? "Review immediately and escalate if ownership, balance, or fulfillment state is inconsistent."
    : "Review and classify the finding.";
}

function isUniqueViolation(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code?: unknown }).code === "23505"
  );
}

async function selectMany<T>(
  query: PromiseLike<{ data: unknown; error: { message?: string } | null }>,
  errorCode: string,
): Promise<T[]> {
  const { data, error } = await query;

  if (error) {
    throw new Error(`${errorCode}: ${error.message ?? "unknown error"}`);
  }

  return Array.isArray(data) ? (data as T[]) : [];
}

async function selectPagedMany<T>(
  buildQuery: (
    from: number,
    to: number,
  ) => PromiseLike<{ data: unknown; error: { message?: string } | null }>,
  errorCode: string,
  pageSize = RELATED_ROW_PAGE_SIZE,
): Promise<T[]> {
  const rows: T[] = [];

  for (let from = 0; ; from += pageSize) {
    const page = await selectMany<T>(
      buildQuery(from, from + pageSize - 1),
      errorCode,
    );

    rows.push(...page);

    if (page.length < pageSize) {
      break;
    }
  }

  return rows;
}

async function selectInChunks<T>(
  values: string[],
  buildQuery: (
    values: string[],
    from: number,
    to: number,
  ) => PromiseLike<{ data: unknown; error: { message?: string } | null }>,
  errorCode: string,
): Promise<T[]> {
  const rows: T[] = [];

  for (const valueChunk of chunkStrings(values, MAX_IN_FILTER_VALUES)) {
    rows.push(
      ...(await selectPagedMany<T>(
        (from, to) => buildQuery(valueChunk, from, to),
        errorCode,
      )),
    );
  }

  return rows;
}

async function selectMaybe<T>(
  query: PromiseLike<{ data: unknown; error: { message?: string } | null }>,
  errorCode: string,
): Promise<T | null> {
  const { data, error } = await query;

  if (error) {
    throw new Error(`${errorCode}: ${error.message ?? "unknown error"}`);
  }

  return data ? (data as T) : null;
}

function uniqueStrings(values: Array<string | null | undefined>): string[] {
  return [
    ...new Set(values.filter((value): value is string => Boolean(value))),
  ];
}

function chunkStrings(values: string[], size: number): string[][] {
  const chunks: string[][] = [];

  for (let index = 0; index < values.length; index += size) {
    chunks.push(values.slice(index, index + size));
  }

  return chunks;
}

function mapById<T extends { id: string }>(rows: T[]): Map<string, T> {
  return new Map(rows.map((row) => [row.id, row]));
}

function uniqueById<T extends { id: string }>(rows: T[]): T[] {
  return [...mapById(rows).values()];
}

function groupBy<T>(
  rows: T[],
  getKey: (row: T) => string | null | undefined,
): Map<string, T[]> {
  const grouped = new Map<string, T[]>();

  for (const row of rows) {
    const key = getKey(row);

    if (!key) {
      continue;
    }

    const current = grouped.get(key) ?? [];
    current.push(row);
    grouped.set(key, current);
  }

  return grouped;
}

function getRequiredDrawResultCount(order: DrawOrderRow): number {
  return Math.max(
    readPositiveInteger(order.draw_count) ??
      readPositiveInteger(order.quantity) ??
      1,
    1,
  );
}

function findReferralCommissionLedger(
  commission: ReferralCommissionRow,
  ledgersById: Map<string, CurrencyLedgerRow>,
  ledgers: CurrencyLedgerRow[],
): CurrencyLedgerRow | null {
  if (commission.ledger_id) {
    const directLedger = ledgersById.get(commission.ledger_id);

    if (directLedger) {
      return directLedger;
    }
  }

  return (
    ledgers.find((ledger) =>
      readLedgerCommissionIds(ledger).includes(commission.id),
    ) ?? null
  );
}

function isReferralCommissionLedgerMismatch(
  commission: ReferralCommissionRow,
  ledger: CurrencyLedgerRow,
): boolean {
  const commissionIds = readLedgerCommissionIds(ledger);
  const hasCommissionScope =
    ledger.source_id === commission.id || commissionIds.includes(commission.id);
  const amount = toNumber(ledger.amount ?? null);
  const expectedAmount = toNumber(commission.commission_amount_kcoin ?? null);
  const isBatchClaim = commissionIds.length > 1;
  const amountMismatch =
    !isBatchClaim &&
    Number.isFinite(amount) &&
    Number.isFinite(expectedAmount) &&
    amount !== expectedAmount;

  return (
    ledger.user_id !== commission.inviter_user_id ||
    ledger.currency_code !== "KCOIN" ||
    ledger.entry_type !== "credit" ||
    ledger.source_type !== "referral_commission_claim" ||
    !hasCommissionScope ||
    amountMismatch
  );
}

function readLedgerCommissionIds(ledger: CurrencyLedgerRow): string[] {
  const metadata = ledger.metadata;

  if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) {
    return [];
  }

  const commissionIds = (metadata as Record<string, unknown>).commission_ids;

  if (!Array.isArray(commissionIds)) {
    return [];
  }

  return commissionIds.filter(
    (commissionId): commissionId is string => typeof commissionId === "string",
  );
}

function balanceKey(userId: string, currencyCode: string): string {
  return `${userId}:${currencyCode.toUpperCase()}`;
}

function readPositiveInteger(value: number | string): number | null {
  const parsed = typeof value === "number" ? value : Number.parseInt(value, 10);

  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}

function toNumber(value: number | string | null): number {
  if (typeof value === "number") {
    return value;
  }

  if (typeof value === "string") {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : Number.NaN;
  }

  return Number.NaN;
}

function normalizeLimit(value: number | undefined): number {
  if (!Number.isFinite(value) || !value) {
    return DEFAULT_LIMIT;
  }

  return Math.max(1, Math.min(MAX_LIMIT, Math.trunc(value)));
}

function toJson(value: unknown): Json {
  return JSON.parse(JSON.stringify(value)) as Json;
}

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
