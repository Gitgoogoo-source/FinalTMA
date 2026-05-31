import {
  getSupabaseAdminClient,
  type SupabaseAdminClient,
} from "../../packages/server/src/db/supabaseAdmin.js";
import { loadPaymentSupportConfig } from "../_shared/paymentSupportConfig.js";
import { ApiError, withApiHandler } from "../_shared/handler.js";
import { requireAdmin } from "../_shared/requireAdmin.js";
import { firstQueryValue } from "./_shared.js";

type MonitorStatus = "ok" | "warning" | "critical";

type PaymentOrderMonitorRow = {
  id: string;
  user_id: string;
  status: string;
  paid_at: string | null;
  fulfilled_at: string | null;
  error_message: string | null;
  created_at: string;
  updated_at: string;
};

type WebhookEventMonitorRow = {
  id: string;
  update_id: number | string | null;
  event_type: string;
  process_status: string;
  processed_at: string | null;
  error_message: string | null;
  created_at: string;
};

type MintQueueMonitorRow = {
  id: string;
  user_id: string;
  status: string;
  attempt_count: number | string;
  max_attempts: number | string;
  next_attempt_at: string | null;
  completed_at: string | null;
  error_message: string | null;
  created_at: string;
  updated_at: string;
};

const PAYMENT_ORDER_MONITOR_COLUMNS = [
  "id",
  "user_id",
  "status",
  "paid_at",
  "fulfilled_at",
  "error_message",
  "created_at",
  "updated_at",
].join(",");

const WEBHOOK_EVENT_MONITOR_COLUMNS = [
  "id",
  "update_id",
  "event_type",
  "process_status",
  "processed_at",
  "error_message",
  "created_at",
].join(",");

const MINT_QUEUE_MONITOR_COLUMNS = [
  "id",
  "user_id",
  "status",
  "attempt_count",
  "max_attempts",
  "next_attempt_at",
  "completed_at",
  "error_message",
  "created_at",
  "updated_at",
].join(",");

const DEFAULT_WINDOW_HOURS = 24;
const MAX_WINDOW_HOURS = 168;
const DEFAULT_WEBHOOK_STUCK_MINUTES = 5;
const DEFAULT_FULFILLMENT_STUCK_MINUTES = 10;
const DEFAULT_MINT_STUCK_MINUTES = 30;
const MONITORING_LIMIT = 1000;

const PAYMENT_FAILURE_STATUSES = new Set([
  "failed",
  "expired",
  "refunded",
  "disputed",
]);
const PAID_LIFECYCLE_STATUSES = new Set([
  "paid",
  "fulfilling",
  "fulfilled",
  "failed",
  "refunded",
  "disputed",
]);
const FULFILLMENT_FAILURE_STATUSES = new Set(["failed", "disputed"]);
const ACTIVE_FULFILLMENT_STATUSES = ["paid", "fulfilling"];
const ACTIVE_WEBHOOK_STATUSES = ["received", "processing"];
const ACTIVE_MINT_STATUSES = [
  "queued",
  "processing",
  "submitted",
  "confirming",
  "retrying",
];

export default withApiHandler(
  async (req) => {
    await requireAdmin(req, {
      permissions: ["payments:read", "mint:read", "onchain:read"],
    });

    const now = new Date();
    const windowHours = parseWindowHours(req.query.windowHours);
    const thresholds = {
      webhookStuckMinutes: parsePositiveInteger(
        req.query.webhookStuckMinutes,
        DEFAULT_WEBHOOK_STUCK_MINUTES,
        60,
      ),
      fulfillmentStuckMinutes: parsePositiveInteger(
        req.query.fulfillmentStuckMinutes,
        DEFAULT_FULFILLMENT_STUCK_MINUTES,
        120,
      ),
      mintStuckMinutes: parsePositiveInteger(
        req.query.mintStuckMinutes,
        DEFAULT_MINT_STUCK_MINUTES,
        240,
      ),
    };
    const windowStartedAt = new Date(
      now.getTime() - windowHours * 60 * 60 * 1000,
    ).toISOString();
    const db = getSupabaseAdminClient();

    const [
      paymentOrders,
      activePaymentOrders,
      webhookEvents,
      activeWebhookEvents,
      mintQueueRows,
      activeMintQueueRows,
      paymentSupportConfig,
    ] = await Promise.all([
      listPaymentOrders(db, windowStartedAt),
      listActivePaymentOrders(db),
      listWebhookEvents(db, windowStartedAt),
      listActiveWebhookEvents(db),
      listMintQueueRows(db, windowStartedAt),
      listActiveMintQueueRows(db),
      loadPaymentSupportConfig(db),
    ]);

    const fulfillmentStuckBefore = new Date(
      now.getTime() - thresholds.fulfillmentStuckMinutes * 60 * 1000,
    );
    const webhookStuckBefore = new Date(
      now.getTime() - thresholds.webhookStuckMinutes * 60 * 1000,
    );
    const mintStuckBefore = new Date(
      now.getTime() - thresholds.mintStuckMinutes * 60 * 1000,
    );

    const stuckFulfillmentOrders = activePaymentOrders.filter(
      (order) =>
        Boolean(order.paid_at) &&
        isBefore(order.paid_at, fulfillmentStuckBefore),
    );
    const stuckWebhookEvents = activeWebhookEvents.filter((event) =>
      isBefore(event.created_at, webhookStuckBefore),
    );
    const stuckMintQueueRows = activeMintQueueRows.filter((row) =>
      isBefore(row.updated_at, mintStuckBefore),
    );

    const processedWebhookLatencies = webhookEvents
      .map((event) => calculateLatencyMs(event.created_at, event.processed_at))
      .filter((value): value is number => value !== null);

    return {
      window: {
        hours: windowHours,
        startedAt: windowStartedAt,
        endedAt: now.toISOString(),
      },
      thresholds,
      metrics: {
        paymentFailureRate: buildPaymentFailureRate(paymentOrders),
        fulfillmentFailureRate: buildFulfillmentFailureRate(
          paymentOrders,
          stuckFulfillmentOrders,
        ),
        webhookLatency: buildWebhookLatencyMetric(
          processedWebhookLatencies,
          activeWebhookEvents,
          stuckWebhookEvents,
        ),
        mintStuckCount: buildMintStuckMetric(
          activeMintQueueRows,
          stuckMintQueueRows,
        ),
      },
      recentExceptions: {
        paymentOrders: uniqueById([
          ...stuckFulfillmentOrders,
          ...paymentOrders.filter(isPaymentException),
        ])
          .slice(0, 8)
          .map(mapPaymentException),
        webhookEvents: uniqueById([
          ...stuckWebhookEvents,
          ...webhookEvents.filter(isWebhookException),
        ])
          .slice(0, 8)
          .map(mapWebhookException),
        mintQueue: uniqueById([
          ...stuckMintQueueRows,
          ...mintQueueRows.filter(isMintException),
        ])
          .slice(0, 8)
          .map(mapMintException),
      },
      paymentSupport: paymentSupportConfig,
      warnings: buildMonitoringWarnings(paymentSupportConfig),
      sources: {
        paymentOrderRows: paymentOrders.length,
        activePaymentOrderRows: activePaymentOrders.length,
        webhookEventRows: webhookEvents.length,
        activeWebhookEventRows: activeWebhookEvents.length,
        mintQueueRows: mintQueueRows.length,
        activeMintQueueRows: activeMintQueueRows.length,
        limitPerQuery: MONITORING_LIMIT,
      },
      serverTime: now.toISOString(),
    };
  },
  {
    methods: ["GET"],
    rateLimit: {
      action: "admin.read",
    },
  },
);

async function listPaymentOrders(
  db: SupabaseAdminClient,
  windowStartedAt: string,
): Promise<PaymentOrderMonitorRow[]> {
  const { data, error } = await db
    .schema("payments")
    .from("star_orders")
    .select(PAYMENT_ORDER_MONITOR_COLUMNS)
    .gte("created_at", windowStartedAt)
    .order("created_at", { ascending: false })
    .limit(MONITORING_LIMIT);

  if (error) {
    throw new ApiError(
      500,
      "ADMIN_MONITORING_PAYMENT_LOOKUP_FAILED",
      "支付监控数据查询失败。",
      { expose: false, cause: error },
    );
  }

  return Array.isArray(data)
    ? (data as unknown as PaymentOrderMonitorRow[])
    : [];
}

async function listActivePaymentOrders(
  db: SupabaseAdminClient,
): Promise<PaymentOrderMonitorRow[]> {
  const { data, error } = await db
    .schema("payments")
    .from("star_orders")
    .select(PAYMENT_ORDER_MONITOR_COLUMNS)
    .in("status", ACTIVE_FULFILLMENT_STATUSES)
    .order("paid_at", { ascending: true })
    .limit(MONITORING_LIMIT);

  if (error) {
    throw new ApiError(
      500,
      "ADMIN_MONITORING_FULFILLMENT_LOOKUP_FAILED",
      "发货监控数据查询失败。",
      { expose: false, cause: error },
    );
  }

  return Array.isArray(data)
    ? (data as unknown as PaymentOrderMonitorRow[])
    : [];
}

async function listWebhookEvents(
  db: SupabaseAdminClient,
  windowStartedAt: string,
): Promise<WebhookEventMonitorRow[]> {
  const { data, error } = await db
    .schema("payments")
    .from("telegram_webhook_events")
    .select(WEBHOOK_EVENT_MONITOR_COLUMNS)
    .gte("created_at", windowStartedAt)
    .order("created_at", { ascending: false })
    .limit(MONITORING_LIMIT);

  if (error) {
    throw new ApiError(
      500,
      "ADMIN_MONITORING_WEBHOOK_LOOKUP_FAILED",
      "Webhook 监控数据查询失败。",
      { expose: false, cause: error },
    );
  }

  return Array.isArray(data)
    ? (data as unknown as WebhookEventMonitorRow[])
    : [];
}

async function listActiveWebhookEvents(
  db: SupabaseAdminClient,
): Promise<WebhookEventMonitorRow[]> {
  const { data, error } = await db
    .schema("payments")
    .from("telegram_webhook_events")
    .select(WEBHOOK_EVENT_MONITOR_COLUMNS)
    .in("process_status", ACTIVE_WEBHOOK_STATUSES)
    .order("created_at", { ascending: true })
    .limit(MONITORING_LIMIT);

  if (error) {
    throw new ApiError(
      500,
      "ADMIN_MONITORING_WEBHOOK_ACTIVE_LOOKUP_FAILED",
      "Webhook 未完成事件查询失败。",
      { expose: false, cause: error },
    );
  }

  return Array.isArray(data)
    ? (data as unknown as WebhookEventMonitorRow[])
    : [];
}

async function listMintQueueRows(
  db: SupabaseAdminClient,
  windowStartedAt: string,
): Promise<MintQueueMonitorRow[]> {
  const { data, error } = await db
    .schema("onchain")
    .from("mint_queue")
    .select(MINT_QUEUE_MONITOR_COLUMNS)
    .gte("created_at", windowStartedAt)
    .order("created_at", { ascending: false })
    .limit(MONITORING_LIMIT);

  if (error) {
    throw new ApiError(
      500,
      "ADMIN_MONITORING_MINT_LOOKUP_FAILED",
      "Mint 监控数据查询失败。",
      { expose: false, cause: error },
    );
  }

  return Array.isArray(data) ? (data as unknown as MintQueueMonitorRow[]) : [];
}

async function listActiveMintQueueRows(
  db: SupabaseAdminClient,
): Promise<MintQueueMonitorRow[]> {
  const { data, error } = await db
    .schema("onchain")
    .from("mint_queue")
    .select(MINT_QUEUE_MONITOR_COLUMNS)
    .in("status", ACTIVE_MINT_STATUSES)
    .order("updated_at", { ascending: true })
    .limit(MONITORING_LIMIT);

  if (error) {
    throw new ApiError(
      500,
      "ADMIN_MONITORING_MINT_ACTIVE_LOOKUP_FAILED",
      "Mint 未完成队列查询失败。",
      { expose: false, cause: error },
    );
  }

  return Array.isArray(data) ? (data as unknown as MintQueueMonitorRow[]) : [];
}

function buildPaymentFailureRate(rows: PaymentOrderMonitorRow[]) {
  const denominator = rows.length;
  const numerator = rows.filter((row) =>
    PAYMENT_FAILURE_STATUSES.has(row.status),
  ).length;
  const rate = ratio(numerator, denominator);

  return {
    key: "payment_failure_rate",
    label: "支付失败率",
    value: rate,
    unit: "percent",
    numerator,
    denominator,
    status: rateStatus(rate, 0.02, 0.05),
    description: "窗口内 failed、expired、refunded、disputed 支付订单占比。",
  };
}

function buildFulfillmentFailureRate(
  rows: PaymentOrderMonitorRow[],
  stuckRows: PaymentOrderMonitorRow[],
) {
  const paidRows = rows.filter(
    (row) => Boolean(row.paid_at) || PAID_LIFECYCLE_STATUSES.has(row.status),
  );
  const numerator = paidRows.filter(
    (row) =>
      FULFILLMENT_FAILURE_STATUSES.has(row.status) ||
      (Boolean(row.error_message) && !row.fulfilled_at),
  ).length;
  const denominator = paidRows.length;
  const rate = ratio(numerator, denominator);

  return {
    key: "fulfillment_failure_rate",
    label: "发货失败率",
    value: rate,
    unit: "percent",
    numerator,
    denominator,
    stuckCount: stuckRows.length,
    status: stuckRows.length > 0 ? "critical" : rateStatus(rate, 0.005, 0.02),
    description:
      "窗口内已支付生命周期订单中，失败、争议或有错误且未 fulfilled 的占比；paid/fulfilling 超过阈值未发货直接 critical。",
  };
}

function buildWebhookLatencyMetric(
  processedLatencies: number[],
  activeRows: WebhookEventMonitorRow[],
  stuckRows: WebhookEventMonitorRow[],
) {
  const p95Ms = percentile(processedLatencies, 0.95);
  const maxMs =
    processedLatencies.length > 0 ? Math.max(...processedLatencies) : null;
  const averageMs =
    processedLatencies.length > 0
      ? Math.round(
          processedLatencies.reduce((sum, value) => sum + value, 0) /
            processedLatencies.length,
        )
      : null;
  const status =
    stuckRows.length > 0 ? "critical" : latencyStatus(p95Ms, 15_000, 60_000);

  return {
    key: "webhook_latency",
    label: "Webhook 延迟",
    value: p95Ms,
    unit: "milliseconds",
    averageMs,
    p95Ms,
    maxMs,
    processedCount: processedLatencies.length,
    pendingCount: activeRows.length,
    stuckCount: stuckRows.length,
    status,
    description:
      "窗口内 processed_at - created_at 的 p95；未完成事件超过阈值直接 critical。",
  };
}

function buildMintStuckMetric(
  activeRows: MintQueueMonitorRow[],
  stuckRows: MintQueueMonitorRow[],
) {
  const count = stuckRows.length;

  return {
    key: "mint_stuck_count",
    label: "Mint 卡住数量",
    value: count,
    unit: "count",
    activeCount: activeRows.length,
    stuckCount: count,
    status: count >= 5 ? "critical" : count > 0 ? "warning" : "ok",
    description:
      "active Mint 状态 queued/processing/submitted/confirming/retrying 中，updated_at 超过阈值未推进的数量。",
  };
}

function isPaymentException(row: PaymentOrderMonitorRow): boolean {
  return PAYMENT_FAILURE_STATUSES.has(row.status) || Boolean(row.error_message);
}

function isWebhookException(row: WebhookEventMonitorRow): boolean {
  return (
    !["processed", "ignored"].includes(row.process_status) ||
    Boolean(row.error_message) ||
    row.processed_at === null
  );
}

function isMintException(row: MintQueueMonitorRow): boolean {
  return (
    ["failed", "manual_review", "cancelled"].includes(row.status) ||
    Boolean(row.error_message)
  );
}

function mapPaymentException(row: PaymentOrderMonitorRow) {
  return {
    id: row.id,
    userId: row.user_id,
    status: row.status,
    paidAt: row.paid_at,
    fulfilledAt: row.fulfilled_at,
    errorMessage: row.error_message,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function buildMonitoringWarnings(paymentSupport: {
  configured: boolean;
}): Array<{
  code: string;
  severity: "warning";
  message: string;
  suggestedAction: string;
}> {
  if (paymentSupport.configured) {
    return [];
  }

  return [
    {
      code: "PAYMENT_SUPPORT_CONFIG_MISSING",
      severity: "warning",
      message: "支付客服入口未配置，支付失败页不会展示客服入口。",
      suggestedAction: "在监控页配置 PAYMENT_SUPPORT_CONFIG 的 URL 或 email。",
    },
  ];
}

function mapWebhookException(row: WebhookEventMonitorRow) {
  return {
    id: row.id,
    updateId: row.update_id,
    eventType: row.event_type,
    processStatus: row.process_status,
    processedAt: row.processed_at,
    errorMessage: row.error_message,
    createdAt: row.created_at,
  };
}

function mapMintException(row: MintQueueMonitorRow) {
  return {
    id: row.id,
    userId: row.user_id,
    status: row.status,
    attemptCount: Number(row.attempt_count),
    maxAttempts: Number(row.max_attempts),
    nextAttemptAt: row.next_attempt_at,
    completedAt: row.completed_at,
    errorMessage: row.error_message,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function parseWindowHours(value: unknown): number {
  return parsePositiveInteger(value, DEFAULT_WINDOW_HOURS, MAX_WINDOW_HOURS);
}

function parsePositiveInteger(
  value: unknown,
  fallback: number,
  max: number,
): number {
  const raw = firstQueryValue(value);
  const parsed = raw ? Number.parseInt(raw, 10) : fallback;

  if (!Number.isFinite(parsed) || parsed <= 0) {
    return fallback;
  }

  return Math.min(parsed, max);
}

function calculateLatencyMs(
  startedAt: string,
  finishedAt: string | null,
): number | null {
  if (!finishedAt) {
    return null;
  }

  const start = new Date(startedAt).getTime();
  const end = new Date(finishedAt).getTime();

  if (!Number.isFinite(start) || !Number.isFinite(end) || end < start) {
    return null;
  }

  return end - start;
}

function isBefore(value: string | null, threshold: Date): boolean {
  if (!value) {
    return false;
  }

  const date = new Date(value);
  return Number.isFinite(date.getTime()) && date < threshold;
}

function ratio(numerator: number, denominator: number): number {
  return denominator > 0 ? numerator / denominator : 0;
}

function rateStatus(
  value: number,
  warningAt: number,
  criticalAt: number,
): MonitorStatus {
  if (value >= criticalAt) {
    return "critical";
  }

  if (value >= warningAt) {
    return "warning";
  }

  return "ok";
}

function latencyStatus(
  value: number | null,
  warningAtMs: number,
  criticalAtMs: number,
): MonitorStatus {
  if (value === null) {
    return "ok";
  }

  if (value >= criticalAtMs) {
    return "critical";
  }

  if (value >= warningAtMs) {
    return "warning";
  }

  return "ok";
}

function percentile(values: number[], percentileValue: number): number | null {
  if (values.length === 0) {
    return null;
  }

  const sorted = [...values].sort((left, right) => left - right);
  const index = Math.ceil(percentileValue * sorted.length) - 1;
  return sorted[Math.max(0, Math.min(sorted.length - 1, index))] ?? null;
}

function uniqueById<T extends { id: string }>(rows: T[]): T[] {
  const seen = new Set<string>();
  const result: T[] = [];

  for (const row of rows) {
    if (!seen.has(row.id)) {
      seen.add(row.id);
      result.push(row);
    }
  }

  return result;
}
