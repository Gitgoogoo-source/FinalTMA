import type { Json } from "../db/database.js";
import {
  getSupabaseAdminClient,
  type SupabaseAdminClient,
} from "../db/supabaseAdmin.js";

export type Phase5ReconciliationRunType =
  | "payment_fulfillment"
  | "mint_queue"
  | "wallet_sync"
  | "ledger_balance";

export type ReconciliationSeverity = "low" | "medium" | "high" | "critical";

export type Phase5ReconciliationFinding = {
  code: string;
  message: string;
  severity: ReconciliationSeverity;
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
  findingCount: number;
  riskEventCount: number;
  findings: Phase5ReconciliationFinding[];
};

export type Phase5ReconciliationResult = {
  requestId: string;
  startedAt: string;
  finishedAt: string;
  limit: number;
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
  payment_star_order_id: string | null;
  status: string;
  quantity: number | string;
  draw_count: number | string;
};

type DrawResultRow = {
  id: string;
  draw_order_id: string;
  user_id: string;
  draw_index: number | string;
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
  available_after: number | string | null;
  locked_after: number | string | null;
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

const DEFAULT_RUN_TYPES: Phase5ReconciliationRunType[] = [
  "payment_fulfillment",
  "mint_queue",
  "wallet_sync",
  "ledger_balance",
];
const DEFAULT_LIMIT = 500;
const MAX_LIMIT = 2_000;
const MAX_RELATED_ROW_LIMIT = 5_000;
const WALLET_SYNC_STUCK_MS = 30 * 60 * 1000;

export async function runPhase5Reconciliation(
  input: RunPhase5ReconciliationInput,
): Promise<Phase5ReconciliationResult> {
  const db = input.db ?? getSupabaseAdminClient();
  const startedAt = (input.now ?? new Date()).toISOString();
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

  return {
    requestId: input.requestId,
    startedAt,
    finishedAt,
    limit,
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
  const runId = await createReconciliationRun(input);

  try {
    const findings = await collectFindings(input);
    const riskEventCount = input.writeRiskEvents
      ? await writeRiskEvents(input.db, {
          requestId: input.requestId,
          runId,
          runType: input.runType,
          findings,
        })
      : 0;

    await finishReconciliationRun(input.db, runId, "success", {
      request_id: input.requestId,
      run_type: input.runType,
      finding_count: findings.length,
      risk_event_count: riskEventCount,
      findings: findings.map(serializeFinding),
    });

    console.info("[phase5-reconciliation:success]", {
      requestId: input.requestId,
      runType: input.runType,
      runId,
      findingCount: findings.length,
      riskEventCount,
    });

    return {
      runType: input.runType,
      runId,
      status: "success",
      findingCount: findings.length,
      riskEventCount,
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
}): Promise<Phase5ReconciliationFinding[]> {
  switch (input.runType) {
    case "payment_fulfillment":
      return collectPaymentFulfillmentFindings(input);
    case "mint_queue":
      return collectMintQueueFindings(input);
    case "wallet_sync":
      return collectWalletSyncFindings(input);
    case "ledger_balance":
      return collectLedgerBalanceFindings(input);
  }
}

async function collectPaymentFulfillmentFindings(input: {
  db: SupabaseAdminClient;
  requestId: string;
  limit: number;
}): Promise<Phase5ReconciliationFinding[]> {
  const orders = await selectMany<StarOrderRow>(
    input.db
      .schema("payments")
      .from("star_orders")
      .select(
        "id,user_id,business_id,status,paid_at,fulfilled_at,error_message,created_at,updated_at",
      )
      .in("status", ["paid", "fulfilling", "fulfilled"])
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

    if (order.status !== "fulfilled" && order.paid_at && !order.fulfilled_at) {
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

  return findings.slice(0, input.limit);
}

async function collectLedgerBalanceFindings(input: {
  db: SupabaseAdminClient;
  limit: number;
}): Promise<Phase5ReconciliationFinding[]> {
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

  return findings.slice(0, input.limit);
}

async function collectMintQueueFindings(input: {
  db: SupabaseAdminClient;
  limit: number;
}): Promise<Phase5ReconciliationFinding[]> {
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

  return findings.slice(0, input.limit);
}

async function collectWalletSyncFindings(input: {
  db: SupabaseAdminClient;
  limit: number;
  now: Date;
}): Promise<Phase5ReconciliationFinding[]> {
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

  return findings.slice(0, input.limit);
}

async function createReconciliationRun(input: {
  db: SupabaseAdminClient;
  runType: Phase5ReconciliationRunType;
  requestId: string;
  limit: number;
  createdBy: string;
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
      }),
      created_by: input.createdBy,
    })
    .select("id")
    .single();

  if (error || !data || typeof (data as { id?: unknown }).id !== "string") {
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
): Promise<number> {
  let inserted = 0;

  for (const finding of input.findings) {
    logFinding(input.requestId, input.runId, input.runType, finding);

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
          star_order_id: finding.starOrderId ?? null,
          draw_order_id: finding.drawOrderId ?? null,
          payment_charge_id: finding.paymentChargeId ?? null,
          mint_queue_id: finding.mintQueueId ?? null,
          tx_hash: finding.txHash ?? null,
        }),
      });

    if (error) {
      throw new Error(`Failed to write risk event: ${error.message}`);
    }

    inserted += 1;
  }

  return inserted;
}

function buildFinding(
  input: Omit<Phase5ReconciliationFinding, "detail"> & {
    detail?: Record<string, unknown> | undefined;
  },
): Phase5ReconciliationFinding {
  return {
    ...input,
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
  });
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
