import {
  getSupabaseAdminClient,
  type SupabaseAdminClient,
} from "../../packages/server/src/db/supabaseAdmin.js";
import { ApiError, withApiHandler } from "../_shared/handler.js";
import { hasAdminPermission, requireAdmin } from "../_shared/requireAdmin.js";
import {
  firstQueryValue,
  isRecord,
  normalizeRequiredUuid,
  type JsonRecord,
} from "./_shared.js";

type StarOrderRow = {
  id: string;
  user_id: string;
  business_type: string;
  business_id: string | null;
  status: string;
  xtr_amount: number | string;
  telegram_invoice_payload: string;
  title: string;
  description: string | null;
  idempotency_key: string;
  expires_at: string | null;
  precheckout_at: string | null;
  paid_at: string | null;
  fulfilled_at: string | null;
  error_message: string | null;
  metadata: unknown;
  created_at: string;
  updated_at: string;
};

type CoreUserRow = {
  id: string;
  telegram_user_id: number | string;
  username: string | null;
  first_name: string | null;
  last_name: string | null;
  status: string;
  risk_score: number | string;
  last_seen_at: string | null;
  last_auth_at: string | null;
  created_at: string;
};

type StarPaymentRow = {
  id: string;
  star_order_id: string;
  user_id: string;
  telegram_payment_charge_id: string;
  provider_payment_charge_id: string | null;
  xtr_amount: number | string;
  currency: string;
  invoice_payload: string;
  paid_at: string;
  created_at: string;
  metadata: unknown;
};

type StarRefundRow = {
  id: string;
  star_payment_id: string;
  star_order_id: string;
  user_id: string;
  telegram_payment_charge_id: string;
  xtr_amount: number | string;
  status: string;
  reason: string | null;
  requested_by_admin_id: string | null;
  processed_at: string | null;
  metadata: unknown;
  created_at: string;
  updated_at: string;
};

type DrawOrderRow = {
  id: string;
  user_id: string;
  box_id: string;
  pool_version_id: string | null;
  payment_star_order_id: string | null;
  status: string;
  quantity: number | string;
  draw_count: number | string;
  unit_price_stars: number | string;
  discount_bps: number | string;
  total_price_stars: number | string;
  open_reward_kcoin: number | string;
  invoice_payload: string | null;
  paid_at: string | null;
  opened_at: string | null;
  payment_provider: string | null;
  payment_status: string | null;
  star_amount: number | string | null;
  telegram_invoice_payload: string | null;
  telegram_payment_charge_id: string | null;
  error_message: string | null;
  metadata: unknown;
  created_at: string;
  updated_at: string;
};

type DrawResultRow = {
  id: string;
  draw_order_id: string;
  user_id: string;
  box_id: string;
  pool_version_id: string | null;
  draw_index: number | string;
  drop_pool_item_id: string | null;
  item_instance_id: string | null;
  template_id: string;
  form_id: string | null;
  rarity_code: string;
  was_pity: boolean;
  random_roll: number | string | null;
  metadata: unknown;
  created_at: string;
};

type ItemInstanceRow = {
  id: string;
  owner_user_id: string;
  template_id: string;
  form_id: string | null;
  serial_no: number | string;
  level: number | string;
  power: number | string;
  status: string;
  source_type: string;
  source_id: string | null;
  nft_mint_status: string | null;
  minted_nft_item_id: string | null;
  acquired_at: string;
  created_at: string;
};

type CurrencyLedgerRow = {
  id: string;
  user_id: string;
  currency_code: string;
  entry_type: string;
  amount: number | string;
  available_before: number | string | null;
  available_after: number | string | null;
  locked_before: number | string | null;
  locked_after: number | string | null;
  source_type: string;
  source_id: string | null;
  source_ref: string | null;
  idempotency_key: string | null;
  note: string | null;
  created_at: string;
};

type UserBalanceRow = {
  user_id: string;
  currency_code: string;
  available_amount: number | string;
  locked_amount: number | string;
  updated_at: string;
  created_at: string;
};

type WebhookEventRow = {
  id: string;
  update_id: number | string | null;
  event_type: string;
  user_id: string | null;
  telegram_user_id: number | string | null;
  invoice_payload: string | null;
  process_status: string;
  processed_at: string | null;
  error_message: string | null;
  retry_count: number | string;
  next_retry_at: string | null;
  webhook_secret_verified: boolean;
  status_context: unknown;
  payload: unknown;
  processing_duration_ms: number | string | null;
  request_headers_hash: string | null;
  created_at: string;
};

type PaymentDetailErrorContext = {
  code: string | null;
  message: string | null;
  requestId: string | null;
  errorStack?: string | null;
  stack?: string | null;
  raw?: unknown;
};

type PaymentDiagnosticSeverity = "critical" | "warning" | "info";

type PaymentDiagnostic = {
  severity: PaymentDiagnosticSeverity;
  code: string;
  message: string;
  related_id: string | null;
  suggested_action: string;
};

const STAR_ORDER_COLUMNS = [
  "id",
  "user_id",
  "business_type",
  "business_id",
  "status",
  "xtr_amount",
  "telegram_invoice_payload",
  "title",
  "description",
  "idempotency_key",
  "expires_at",
  "precheckout_at",
  "paid_at",
  "fulfilled_at",
  "error_message",
  "metadata",
  "created_at",
  "updated_at",
].join(",");

const CORE_USER_COLUMNS = [
  "id",
  "telegram_user_id",
  "username",
  "first_name",
  "last_name",
  "status",
  "risk_score",
  "last_seen_at",
  "last_auth_at",
  "created_at",
].join(",");

const STAR_PAYMENT_COLUMNS = [
  "id",
  "star_order_id",
  "user_id",
  "telegram_payment_charge_id",
  "provider_payment_charge_id",
  "xtr_amount",
  "currency",
  "invoice_payload",
  "paid_at",
  "created_at",
  "metadata",
].join(",");

const STAR_REFUND_COLUMNS = [
  "id",
  "star_payment_id",
  "star_order_id",
  "user_id",
  "telegram_payment_charge_id",
  "xtr_amount",
  "status",
  "reason",
  "requested_by_admin_id",
  "processed_at",
  "metadata",
  "created_at",
  "updated_at",
].join(",");

const DRAW_ORDER_COLUMNS = [
  "id",
  "user_id",
  "box_id",
  "pool_version_id",
  "payment_star_order_id",
  "status",
  "quantity",
  "draw_count",
  "unit_price_stars",
  "discount_bps",
  "total_price_stars",
  "open_reward_kcoin",
  "invoice_payload",
  "paid_at",
  "opened_at",
  "payment_provider",
  "payment_status",
  "star_amount",
  "telegram_invoice_payload",
  "telegram_payment_charge_id",
  "error_message",
  "metadata",
  "created_at",
  "updated_at",
].join(",");

const DRAW_RESULT_COLUMNS = [
  "id",
  "draw_order_id",
  "user_id",
  "box_id",
  "pool_version_id",
  "draw_index",
  "drop_pool_item_id",
  "item_instance_id",
  "template_id",
  "form_id",
  "rarity_code",
  "was_pity",
  "random_roll",
  "metadata",
  "created_at",
].join(",");

const ITEM_INSTANCE_COLUMNS = [
  "id",
  "owner_user_id",
  "template_id",
  "form_id",
  "serial_no",
  "level",
  "power",
  "status",
  "source_type",
  "source_id",
  "nft_mint_status",
  "minted_nft_item_id",
  "acquired_at",
  "created_at",
].join(",");

const LEDGER_COLUMNS = [
  "id",
  "user_id",
  "currency_code",
  "entry_type",
  "amount",
  "available_before",
  "available_after",
  "locked_before",
  "locked_after",
  "source_type",
  "source_id",
  "source_ref",
  "idempotency_key",
  "note",
  "created_at",
].join(",");

const USER_BALANCE_COLUMNS = [
  "user_id",
  "currency_code",
  "available_amount",
  "locked_amount",
  "updated_at",
  "created_at",
].join(",");

const WEBHOOK_EVENT_COLUMNS = [
  "id",
  "update_id",
  "event_type",
  "user_id",
  "telegram_user_id",
  "invoice_payload",
  "process_status",
  "processed_at",
  "error_message",
  "retry_count",
  "next_retry_at",
  "webhook_secret_verified",
  "status_context",
  "payload",
  "processing_duration_ms",
  "request_headers_hash",
  "created_at",
].join(",");

export default withApiHandler(
  async (req) => {
    const admin = await requireAdmin(req, {
      permissions: "payments:read",
    });
    const starOrderId = normalizeRequiredUuid(
      firstQueryValue(req.query.starOrderId ?? req.query.star_order_id),
      "starOrderId",
    );
    const db = getSupabaseAdminClient();
    const order = await loadOrder(db, starOrderId);

    if (!order) {
      throw new ApiError(
        404,
        "ADMIN_PAYMENT_ORDER_NOT_FOUND",
        "Payment order not found",
      );
    }

    const canViewDebug =
      admin.isSuperAdmin ||
      hasAdminPermission(admin.permissions, "payments:debug");

    const [user, payment, initialDrawOrder, webhookEvents, refunds] =
      await Promise.all([
        loadUser(db, order.user_id),
        loadPayment(db, order.id),
        loadDrawOrderByPaymentOrder(db, order.id),
        loadWebhookEvents(db, order.telegram_invoice_payload),
        loadRefunds(db, order.id),
      ]);
    const drawOrder =
      initialDrawOrder ??
      (order.business_id
        ? await loadDrawOrderById(db, order.business_id)
        : null);
    const drawResults = drawOrder
      ? await loadDrawResults(db, drawOrder.id)
      : [];
    const itemInstanceIds = uniqueStrings(
      drawResults.map((result) => result.item_instance_id),
    );
    const itemInstances = await loadItemInstances(db, itemInstanceIds);
    const ledgerSourceIds = uniqueStrings([
      order.id,
      order.business_id,
      payment?.id,
      drawOrder?.id,
      ...refunds.map((refund) => refund.id),
      ...drawResults.map((result) => result.id),
      ...itemInstanceIds,
    ]);
    const ledgerEntries = await loadLedgerEntries(
      db,
      order.user_id,
      ledgerSourceIds,
    );
    const ledgerCurrencyCodes = uniqueStrings(
      ledgerEntries.map((entry) => entry.currency_code),
    );
    const [duplicateChargePayments, userBalances, latestLedgerEntries] =
      await Promise.all([
        loadPaymentsByTelegramChargeId(
          db,
          payment?.telegram_payment_charge_id ?? null,
        ),
        loadUserBalances(db, order.user_id, ledgerCurrencyCodes),
        loadLatestLedgerEntriesByCurrency(
          db,
          order.user_id,
          ledgerCurrencyCodes,
        ),
      ]);
    const normalizedOrder = normalizeOrder(order);
    const normalizedPayment = payment ? normalizePayment(payment) : null;
    const normalizedRefunds = refunds.map(normalizeRefund);
    const normalizedDrawOrder = drawOrder
      ? normalizeDrawOrder(drawOrder)
      : null;
    const normalizedDrawResults = drawResults.map(normalizeDrawResult);
    const normalizedItemInstances = itemInstances.map(normalizeItemInstance);
    const normalizedLedgerEntries = ledgerEntries.map(normalizeLedgerEntry);
    const diagnostics = buildDiagnostics({
      order: normalizedOrder,
      payment: normalizedPayment,
      drawOrder: normalizedDrawOrder,
      drawResults: normalizedDrawResults,
      itemInstances: normalizedItemInstances,
      ledgerEntries: normalizedLedgerEntries,
      duplicateChargePayments: duplicateChargePayments.map(normalizePayment),
      userBalances: userBalances.map(normalizeUserBalance),
      latestLedgerEntries: latestLedgerEntries.map(normalizeLedgerEntry),
    });

    return {
      order: normalizedOrder,
      user: user ? normalizeUser(user) : null,
      payment: normalizedPayment,
      refunds: normalizedRefunds,
      drawOrder: normalizedDrawOrder,
      drawResults: normalizedDrawResults,
      itemInstances: normalizedItemInstances,
      ledgerEntries: normalizedLedgerEntries,
      webhookEvents: webhookEvents.map(normalizeWebhookEvent),
      diagnostics,
      errorContext: buildErrorContext(order, webhookEvents, canViewDebug),
      serverTime: new Date().toISOString(),
    };
  },
  {
    methods: ["GET"],
    rateLimit: {
      action: "admin.read",
    },
  },
);

async function loadOrder(
  db: SupabaseAdminClient,
  starOrderId: string,
): Promise<StarOrderRow | null> {
  const { data, error } = await db
    .schema("payments")
    .from("star_orders")
    .select(STAR_ORDER_COLUMNS)
    .eq("id", starOrderId)
    .limit(1);

  if (error) {
    throw new ApiError(
      500,
      "ADMIN_PAYMENT_ORDER_LOOKUP_FAILED",
      "Payment order lookup failed",
      { expose: false, cause: error },
    );
  }

  return firstRow<StarOrderRow>(data);
}

async function loadUser(
  db: SupabaseAdminClient,
  userId: string,
): Promise<CoreUserRow | null> {
  const { data, error } = await db
    .schema("core")
    .from("users")
    .select(CORE_USER_COLUMNS)
    .eq("id", userId)
    .limit(1);

  if (error) {
    throw new ApiError(
      500,
      "ADMIN_PAYMENT_USER_LOOKUP_FAILED",
      "User lookup failed",
      {
        expose: false,
        cause: error,
      },
    );
  }

  return firstRow<CoreUserRow>(data);
}

async function loadPayment(
  db: SupabaseAdminClient,
  starOrderId: string,
): Promise<StarPaymentRow | null> {
  const { data, error } = await db
    .schema("payments")
    .from("star_payments")
    .select(STAR_PAYMENT_COLUMNS)
    .eq("star_order_id", starOrderId)
    .order("paid_at", { ascending: false })
    .order("created_at", { ascending: false })
    .limit(1);

  if (error) {
    throw new ApiError(
      500,
      "ADMIN_STAR_PAYMENT_LOOKUP_FAILED",
      "Star payment lookup failed",
      { expose: false, cause: error },
    );
  }

  return firstRow<StarPaymentRow>(data);
}

async function loadPaymentsByTelegramChargeId(
  db: SupabaseAdminClient,
  telegramPaymentChargeId: string | null,
): Promise<StarPaymentRow[]> {
  if (!telegramPaymentChargeId) {
    return [];
  }

  const { data, error } = await db
    .schema("payments")
    .from("star_payments")
    .select(STAR_PAYMENT_COLUMNS)
    .eq("telegram_payment_charge_id", telegramPaymentChargeId)
    .order("created_at", { ascending: false })
    .limit(10);

  if (error) {
    throw new ApiError(
      500,
      "ADMIN_STAR_PAYMENT_CHARGE_LOOKUP_FAILED",
      "Star payment charge lookup failed",
      { expose: false, cause: error },
    );
  }

  return rows<StarPaymentRow>(data);
}

async function loadRefunds(
  db: SupabaseAdminClient,
  starOrderId: string,
): Promise<StarRefundRow[]> {
  const { data, error } = await db
    .schema("payments")
    .from("star_refunds")
    .select(STAR_REFUND_COLUMNS)
    .eq("star_order_id", starOrderId)
    .order("created_at", { ascending: false })
    .limit(20);

  if (error) {
    throw new ApiError(
      500,
      "ADMIN_STAR_REFUNDS_LOOKUP_FAILED",
      "Star refund lookup failed",
      { expose: false, cause: error },
    );
  }

  return rows<StarRefundRow>(data);
}

async function loadDrawOrderByPaymentOrder(
  db: SupabaseAdminClient,
  starOrderId: string,
): Promise<DrawOrderRow | null> {
  const { data, error } = await db
    .schema("gacha")
    .from("draw_orders")
    .select(DRAW_ORDER_COLUMNS)
    .eq("payment_star_order_id", starOrderId)
    .order("created_at", { ascending: false })
    .limit(1);

  if (error) {
    throw new ApiError(
      500,
      "ADMIN_DRAW_ORDER_LOOKUP_FAILED",
      "Draw order lookup failed",
      { expose: false, cause: error },
    );
  }

  return firstRow<DrawOrderRow>(data);
}

async function loadDrawOrderById(
  db: SupabaseAdminClient,
  drawOrderId: string,
): Promise<DrawOrderRow | null> {
  const { data, error } = await db
    .schema("gacha")
    .from("draw_orders")
    .select(DRAW_ORDER_COLUMNS)
    .eq("id", drawOrderId)
    .limit(1);

  if (error) {
    throw new ApiError(
      500,
      "ADMIN_DRAW_ORDER_LOOKUP_FAILED",
      "Draw order lookup failed",
      { expose: false, cause: error },
    );
  }

  return firstRow<DrawOrderRow>(data);
}

async function loadDrawResults(
  db: SupabaseAdminClient,
  drawOrderId: string,
): Promise<DrawResultRow[]> {
  const { data, error } = await db
    .schema("gacha")
    .from("draw_results")
    .select(DRAW_RESULT_COLUMNS)
    .eq("draw_order_id", drawOrderId)
    .order("draw_index", { ascending: true });

  if (error) {
    throw new ApiError(
      500,
      "ADMIN_DRAW_RESULTS_LOOKUP_FAILED",
      "Draw results lookup failed",
      { expose: false, cause: error },
    );
  }

  return rows<DrawResultRow>(data);
}

async function loadItemInstances(
  db: SupabaseAdminClient,
  itemInstanceIds: string[],
): Promise<ItemInstanceRow[]> {
  if (itemInstanceIds.length === 0) {
    return [];
  }

  const { data, error } = await db
    .schema("inventory")
    .from("item_instances")
    .select(ITEM_INSTANCE_COLUMNS)
    .in("id", itemInstanceIds)
    .order("created_at", { ascending: true });

  if (error) {
    throw new ApiError(
      500,
      "ADMIN_ITEM_INSTANCES_LOOKUP_FAILED",
      "Item instances lookup failed",
      { expose: false, cause: error },
    );
  }

  return rows<ItemInstanceRow>(data);
}

async function loadLedgerEntries(
  db: SupabaseAdminClient,
  userId: string,
  sourceIds: string[],
): Promise<CurrencyLedgerRow[]> {
  if (sourceIds.length === 0) {
    return [];
  }

  const { data, error } = await db
    .schema("economy")
    .from("currency_ledger")
    .select(LEDGER_COLUMNS)
    .eq("user_id", userId)
    .in("source_id", sourceIds)
    .order("created_at", { ascending: false })
    .limit(50);

  if (error) {
    throw new ApiError(
      500,
      "ADMIN_LEDGER_LOOKUP_FAILED",
      "Ledger lookup failed",
      { expose: false, cause: error },
    );
  }

  return rows<CurrencyLedgerRow>(data);
}

async function loadUserBalances(
  db: SupabaseAdminClient,
  userId: string,
  currencyCodes: string[],
): Promise<UserBalanceRow[]> {
  if (currencyCodes.length === 0) {
    return [];
  }

  const { data, error } = await db
    .schema("economy")
    .from("user_balances")
    .select(USER_BALANCE_COLUMNS)
    .eq("user_id", userId)
    .in("currency_code", currencyCodes);

  if (error) {
    throw new ApiError(
      500,
      "ADMIN_USER_BALANCE_LOOKUP_FAILED",
      "User balance lookup failed",
      { expose: false, cause: error },
    );
  }

  return rows<UserBalanceRow>(data);
}

async function loadLatestLedgerEntriesByCurrency(
  db: SupabaseAdminClient,
  userId: string,
  currencyCodes: string[],
): Promise<CurrencyLedgerRow[]> {
  if (currencyCodes.length === 0) {
    return [];
  }

  const { data, error } = await db
    .schema("economy")
    .from("currency_ledger")
    .select(LEDGER_COLUMNS)
    .eq("user_id", userId)
    .in("currency_code", currencyCodes)
    .order("created_at", { ascending: false })
    .limit(200);

  if (error) {
    throw new ApiError(
      500,
      "ADMIN_LATEST_LEDGER_LOOKUP_FAILED",
      "Latest ledger lookup failed",
      { expose: false, cause: error },
    );
  }

  const byCurrency = new Map<string, CurrencyLedgerRow>();

  for (const row of rows<CurrencyLedgerRow>(data)) {
    if (!byCurrency.has(row.currency_code)) {
      byCurrency.set(row.currency_code, row);
    }
  }

  return [...byCurrency.values()];
}

async function loadWebhookEvents(
  db: SupabaseAdminClient,
  invoicePayload: string,
): Promise<WebhookEventRow[]> {
  const { data, error } = await db
    .schema("payments")
    .from("telegram_webhook_events")
    .select(WEBHOOK_EVENT_COLUMNS)
    .eq("invoice_payload", invoicePayload)
    .order("created_at", { ascending: false })
    .limit(50);

  if (error) {
    throw new ApiError(
      500,
      "ADMIN_WEBHOOK_EVENTS_LOOKUP_FAILED",
      "Webhook events lookup failed",
      { expose: false, cause: error },
    );
  }

  return rows<WebhookEventRow>(data);
}

function normalizeOrder(row: StarOrderRow): StarOrderRow {
  return {
    ...row,
    xtr_amount: Number(row.xtr_amount),
  };
}

function normalizeUser(row: CoreUserRow): CoreUserRow {
  return {
    ...row,
    risk_score: Number(row.risk_score),
  };
}

function normalizePayment(row: StarPaymentRow): StarPaymentRow {
  return {
    ...row,
    xtr_amount: Number(row.xtr_amount),
  };
}

function normalizeRefund(row: StarRefundRow): StarRefundRow {
  return {
    ...row,
    xtr_amount: Number(row.xtr_amount),
  };
}

function normalizeDrawOrder(row: DrawOrderRow): DrawOrderRow {
  return {
    ...row,
    quantity: Number(row.quantity),
    draw_count: Number(row.draw_count),
    unit_price_stars: Number(row.unit_price_stars),
    discount_bps: Number(row.discount_bps),
    total_price_stars: Number(row.total_price_stars),
    open_reward_kcoin: Number(row.open_reward_kcoin),
    star_amount: row.star_amount === null ? null : Number(row.star_amount),
  };
}

function normalizeDrawResult(row: DrawResultRow): DrawResultRow {
  return {
    ...row,
    draw_index: Number(row.draw_index),
    random_roll: row.random_roll === null ? null : Number(row.random_roll),
  };
}

function normalizeItemInstance(row: ItemInstanceRow): ItemInstanceRow {
  return {
    ...row,
    serial_no: Number(row.serial_no),
    level: Number(row.level),
    power: Number(row.power),
  };
}

function normalizeLedgerEntry(row: CurrencyLedgerRow): CurrencyLedgerRow {
  return {
    ...row,
    amount: Number(row.amount),
    available_before:
      row.available_before === null ? null : Number(row.available_before),
    available_after:
      row.available_after === null ? null : Number(row.available_after),
    locked_before:
      row.locked_before === null ? null : Number(row.locked_before),
    locked_after: row.locked_after === null ? null : Number(row.locked_after),
  };
}

function normalizeUserBalance(row: UserBalanceRow): UserBalanceRow {
  return {
    ...row,
    available_amount: Number(row.available_amount),
    locked_amount: Number(row.locked_amount),
  };
}

function normalizeWebhookEvent(row: WebhookEventRow): WebhookEventRow {
  return {
    ...row,
    retry_count: Number(row.retry_count),
    processing_duration_ms:
      row.processing_duration_ms === null
        ? null
        : Number(row.processing_duration_ms),
  };
}

function buildDiagnostics(input: {
  order: StarOrderRow;
  payment: StarPaymentRow | null;
  drawOrder: DrawOrderRow | null;
  drawResults: DrawResultRow[];
  itemInstances: ItemInstanceRow[];
  ledgerEntries: CurrencyLedgerRow[];
  duplicateChargePayments: StarPaymentRow[];
  userBalances: UserBalanceRow[];
  latestLedgerEntries: CurrencyLedgerRow[];
}): PaymentDiagnostic[] {
  const diagnostics: PaymentDiagnostic[] = [];
  const isPaidUnfulfilledStatus = ["paid", "fulfilling", "failed"].includes(
    input.order.status,
  );
  const isFulfilled =
    input.order.status === "fulfilled" || Boolean(input.order.fulfilled_at);

  if (isPaidUnfulfilledStatus && !input.order.fulfilled_at) {
    diagnostics.push({
      severity: "critical",
      code: "PAID_NOT_FULFILLED",
      message: "订单已收款但未完成发货。",
      related_id: input.order.id,
      suggested_action:
        "在支付监控确认 webhook/RPC 状态，必要时重试发货或进入退款流程。",
    });
  }

  if (isFulfilled && input.drawResults.length === 0) {
    diagnostics.push({
      severity: "critical",
      code: "FULFILLED_WITHOUT_DRAW_RESULTS",
      message: "订单已标记 fulfilled，但没有生成 draw_results。",
      related_id: input.drawOrder?.id ?? input.order.id,
      suggested_action: "进入对账检查发货链路，并按补偿流程处理库存和奖励。",
    });
  }

  if (
    input.drawOrder &&
    input.drawResults.length !== Number(input.drawOrder.draw_count)
  ) {
    diagnostics.push({
      severity: isFulfilled ? "critical" : "warning",
      code: "DRAW_RESULTS_COUNT_MISMATCH",
      message: `draw_results 数量为 ${input.drawResults.length}，与 draw_count ${input.drawOrder.draw_count} 不一致。`,
      related_id: input.drawOrder.id,
      suggested_action:
        "进入对账核对 draw_order 与 draw_results，确认是否需要补偿发货。",
    });
  }

  const chargeId = input.payment?.telegram_payment_charge_id ?? null;
  const duplicateChargePaymentIds = uniqueStrings(
    input.duplicateChargePayments
      .filter((payment) => payment.telegram_payment_charge_id === chargeId)
      .map((payment) => payment.id),
  );

  if (chargeId && duplicateChargePaymentIds.length > 1) {
    diagnostics.push({
      severity: "critical",
      code: "DUPLICATE_TELEGRAM_CHARGE_ID",
      message: `同一个 Telegram charge id 关联了 ${duplicateChargePaymentIds.length} 条支付记录。`,
      related_id: chargeId,
      suggested_action: "暂停自动补偿，进入风控和对账检查重复支付来源。",
    });
  }

  const itemInstanceIds = new Set(input.itemInstances.map((item) => item.id));

  for (const result of input.drawResults) {
    if (
      result.item_instance_id &&
      !itemInstanceIds.has(result.item_instance_id)
    ) {
      diagnostics.push({
        severity: "critical",
        code: "DRAW_RESULT_ITEM_INSTANCE_MISSING",
        message: "draw_result 指向的 item_instance 不存在或未被详情接口读到。",
        related_id: result.id,
        suggested_action:
          "进入对账检查库存生成链路，必要时人工补偿或标记风险事件。",
      });
    }
  }

  const balancesByCurrency = new Map(
    input.userBalances.map((balance) => [balance.currency_code, balance]),
  );
  const latestLedgerByCurrency = new Map(
    input.latestLedgerEntries.map((entry) => [entry.currency_code, entry]),
  );

  for (const currencyCode of uniqueStrings(
    input.ledgerEntries.map((entry) => entry.currency_code),
  )) {
    const latestLedger = latestLedgerByCurrency.get(currencyCode);

    if (!latestLedger) {
      continue;
    }

    const balance = balancesByCurrency.get(currencyCode);

    if (!balance) {
      diagnostics.push({
        severity: "critical",
        code: "BALANCE_SNAPSHOT_MISSING",
        message: `${currencyCode} 存在 ledger，但缺少 user_balances 快照。`,
        related_id: input.order.user_id,
        suggested_action: "进入对账重建余额快照，并检查是否存在发货补偿遗漏。",
      });
      continue;
    }

    if (
      !sameNumericValue(
        latestLedger.available_after,
        balance.available_amount,
      ) ||
      !sameNumericValue(latestLedger.locked_after, balance.locked_amount)
    ) {
      diagnostics.push({
        severity: "critical",
        code: "LEDGER_BALANCE_MISMATCH",
        message: `${currencyCode} 最新 ledger 余额与 user_balances 快照不一致。`,
        related_id: input.order.user_id,
        suggested_action:
          "进入对账检查 ledger 与余额快照，禁止直接修改历史流水。",
      });
    }
  }

  return diagnostics;
}

function buildErrorContext(
  order: StarOrderRow,
  webhookEvents: WebhookEventRow[],
  canViewDebug: boolean,
): PaymentDetailErrorContext | null {
  const metadata = isRecord(order.metadata) ? order.metadata : {};
  const latestFailedWebhook = webhookEvents.find(
    (event) => event.error_message || event.process_status === "failed",
  );
  const statusContext = isRecord(latestFailedWebhook?.status_context)
    ? latestFailedWebhook.status_context
    : {};
  const rawError =
    readRecord(metadata, "error") ?? readRecord(metadata, "errorContext");
  const rawErrorRecord = isRecord(rawError) ? rawError : {};
  const code =
    readText(rawErrorRecord, "code") ??
    readText(metadata, "error_code") ??
    readText(metadata, "errorCode") ??
    readText(statusContext, "code") ??
    readText(statusContext, "error_code");
  const message =
    order.error_message ??
    latestFailedWebhook?.error_message ??
    readText(rawErrorRecord, "message") ??
    readText(metadata, "error_message") ??
    readText(statusContext, "message") ??
    null;
  const requestId =
    readText(rawErrorRecord, "requestId") ??
    readText(rawErrorRecord, "request_id") ??
    readText(metadata, "request_id") ??
    readText(metadata, "requestId") ??
    readText(statusContext, "request_id") ??
    null;
  const stack =
    readText(rawErrorRecord, "stack") ??
    readText(rawErrorRecord, "errorStack") ??
    readText(metadata, "error_stack") ??
    readText(statusContext, "stack");

  if (!code && !message && !requestId && !stack) {
    return null;
  }

  return {
    code,
    message,
    requestId,
    raw: metadata,
    ...(canViewDebug
      ? {
          errorStack: stack ?? null,
          stack: stack ?? null,
        }
      : {}),
  };
}

function readRecord(record: JsonRecord, key: string): unknown {
  return record[key];
}

function readText(record: JsonRecord, key: string): string | null {
  const value = record[key];

  return typeof value === "string" && value.trim() ? value : null;
}

function sameNumericValue(
  left: number | string | null,
  right: number | string | null,
): boolean {
  if (left === null || right === null) {
    return left === right;
  }

  const leftNumber = Number(left);
  const rightNumber = Number(right);

  return (
    Number.isFinite(leftNumber) &&
    Number.isFinite(rightNumber) &&
    Math.abs(leftNumber - rightNumber) < 0.000001
  );
}

function firstRow<T>(data: unknown): T | null {
  return rows<T>(data)[0] ?? null;
}

function rows<T>(data: unknown): T[] {
  return Array.isArray(data) ? (data as T[]) : [];
}

function uniqueStrings(values: Array<string | null | undefined>): string[] {
  return Array.from(
    new Set(
      values.filter(
        (value): value is string =>
          typeof value === "string" && value.trim().length > 0,
      ),
    ),
  );
}
