import {
  getSupabaseAdminClient,
  type SupabaseAdminClient,
} from "../../packages/server/src/db/supabaseAdmin.js";
import { ApiError, withApiHandler } from "../_shared/handler.js";
import { requireAdmin } from "../_shared/requireAdmin.js";
import {
  buildNextCursor,
  firstQueryValue,
  normalizeDateEnd,
  normalizeDateStart,
  normalizeStatus,
  normalizeUuid,
  parseAdminLimit,
  parseOffsetCursor,
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
  expires_at: string | null;
  precheckout_at: string | null;
  paid_at: string | null;
  fulfilled_at: string | null;
  error_message: string | null;
  metadata: unknown;
  created_at: string;
  updated_at: string;
};

type StarPaymentRow = {
  id: string;
  star_order_id: string;
  user_id: string;
  xtr_amount: number | string;
  currency: string;
  invoice_payload: string;
  paid_at: string;
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
  created_at: string;
};

type RefundRow = {
  id: string;
  star_payment_id: string;
  star_order_id: string;
  user_id: string;
  xtr_amount: number | string;
  status: string;
  reason: string | null;
  processed_at: string | null;
  created_at: string;
  updated_at: string;
};

type DisputeRow = {
  id: string;
  user_id: string;
  star_order_id: string | null;
  star_payment_id: string | null;
  status: string;
  subject: string;
  message: string | null;
  resolution: string | null;
  resolved_at: string | null;
  created_at: string;
  updated_at: string;
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
  "expires_at",
  "precheckout_at",
  "paid_at",
  "fulfilled_at",
  "error_message",
  "metadata",
  "created_at",
  "updated_at",
].join(",");

const STAR_PAYMENT_COLUMNS = [
  "id",
  "star_order_id",
  "user_id",
  "xtr_amount",
  "currency",
  "invoice_payload",
  "paid_at",
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
  "created_at",
].join(",");

const REFUND_COLUMNS = [
  "id",
  "star_payment_id",
  "star_order_id",
  "user_id",
  "xtr_amount",
  "status",
  "reason",
  "processed_at",
  "created_at",
  "updated_at",
].join(",");

const DISPUTE_COLUMNS = [
  "id",
  "user_id",
  "star_order_id",
  "star_payment_id",
  "status",
  "subject",
  "message",
  "resolution",
  "resolved_at",
  "created_at",
  "updated_at",
].join(",");

export default withApiHandler(
  async (req) => {
    await requireAdmin(req, {
      permissions: "payments:read",
    });

    const db = getSupabaseAdminClient();
    const limit = parseAdminLimit(req.query.limit);
    const offset = parseOffsetCursor(req.query.cursor);
    const orders = await listPaymentOrders(db, req.query, offset, limit);
    const pageOrders = orders.slice(0, limit);
    const orderIds = pageOrders.map((order) => order.id);
    const [paymentsByOrderId, events, refunds, disputes] = await Promise.all([
      loadPaymentsByOrderId(db, orderIds),
      listWebhookEvents(db, req.query),
      listRefunds(db, req.query),
      listDisputes(db, req.query),
    ]);

    return {
      orders: pageOrders.map((order) => ({
        ...order,
        xtr_amount: Number(order.xtr_amount),
        payment: paymentsByOrderId.get(order.id) ?? null,
      })),
      events,
      exceptions: pageOrders.filter(isExceptionOrder),
      refunds,
      disputes,
      summary: summarizeOrders(pageOrders),
      nextCursor: buildNextCursor(orders.length, limit, offset),
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

async function listPaymentOrders(
  db: SupabaseAdminClient,
  queryInput: Record<string, unknown>,
  offset: number,
  limit: number,
): Promise<StarOrderRow[]> {
  let query = db
    .schema("payments")
    .from("star_orders")
    .select(STAR_ORDER_COLUMNS);
  const status = normalizeStatus(queryInput.status);
  const userId = normalizeUuid(queryInput.userId ?? queryInput.user_id);
  const q = firstQueryValue(queryInput.q);
  const from = normalizeDateStart(queryInput.from);
  const to = normalizeDateEnd(queryInput.to);
  const invoicePayload = firstQueryValue(
    queryInput.invoicePayload ?? queryInput.invoice_payload,
  );

  if (status) {
    query = query.eq("status", status);
  }

  if (userId) {
    query = query.eq("user_id", userId);
  }

  if (invoicePayload) {
    query = query.eq("telegram_invoice_payload", invoicePayload);
  } else if (q) {
    query = normalizeUuid(q)
      ? query.eq("id", q)
      : query.ilike("telegram_invoice_payload", `%${q}%`);
  }

  if (from) {
    query = query.gte("created_at", from);
  }

  if (to) {
    query = query.lte("created_at", to);
  }

  const { data, error } = await query
    .order("created_at", { ascending: false })
    .order("id", { ascending: false })
    .range(offset, offset + limit);

  if (error) {
    throw new ApiError(
      500,
      "ADMIN_PAYMENTS_LOOKUP_FAILED",
      "支付订单查询失败。",
      {
        expose: false,
        cause: error,
      },
    );
  }

  return Array.isArray(data) ? (data as unknown as StarOrderRow[]) : [];
}

async function loadPaymentsByOrderId(
  db: SupabaseAdminClient,
  orderIds: string[],
): Promise<Map<string, StarPaymentRow>> {
  if (orderIds.length === 0) {
    return new Map();
  }

  const { data, error } = await db
    .schema("payments")
    .from("star_payments")
    .select(STAR_PAYMENT_COLUMNS)
    .in("star_order_id", orderIds);

  if (error) {
    throw new ApiError(
      500,
      "ADMIN_STAR_PAYMENTS_LOOKUP_FAILED",
      "支付流水查询失败。",
      {
        expose: false,
        cause: error,
      },
    );
  }

  const result = new Map<string, StarPaymentRow>();

  for (const row of (Array.isArray(data)
    ? data
    : []) as unknown as StarPaymentRow[]) {
    result.set(row.star_order_id, {
      ...row,
      xtr_amount: Number(row.xtr_amount),
    });
  }

  return result;
}

async function listWebhookEvents(
  db: SupabaseAdminClient,
  queryInput: Record<string, unknown>,
): Promise<WebhookEventRow[]> {
  let query = db
    .schema("payments")
    .from("telegram_webhook_events")
    .select(WEBHOOK_EVENT_COLUMNS);
  const status = normalizeStatus(
    queryInput.eventStatus ?? queryInput.process_status,
  );
  const invoicePayload = firstQueryValue(
    queryInput.invoicePayload ?? queryInput.invoice_payload,
  );

  if (status) {
    query = query.eq("process_status", status);
  }

  if (invoicePayload) {
    query = query.eq("invoice_payload", invoicePayload);
  }

  const { data, error } = await query
    .order("created_at", { ascending: false })
    .limit(50);

  if (error) {
    throw new ApiError(
      500,
      "ADMIN_WEBHOOK_EVENTS_LOOKUP_FAILED",
      "Webhook 事件查询失败。",
      {
        expose: false,
        cause: error,
      },
    );
  }

  return Array.isArray(data) ? (data as unknown as WebhookEventRow[]) : [];
}

async function listRefunds(
  db: SupabaseAdminClient,
  queryInput: Record<string, unknown>,
): Promise<RefundRow[]> {
  let query = db.schema("payments").from("star_refunds").select(REFUND_COLUMNS);
  const status = normalizeStatus(queryInput.refundStatus);

  if (status) {
    query = query.eq("status", status);
  }

  const { data, error } = await query
    .order("created_at", { ascending: false })
    .limit(50);

  if (error) {
    throw new ApiError(
      500,
      "ADMIN_REFUNDS_LOOKUP_FAILED",
      "退款记录查询失败。",
      {
        expose: false,
        cause: error,
      },
    );
  }

  return Array.isArray(data) ? (data as unknown as RefundRow[]) : [];
}

async function listDisputes(
  db: SupabaseAdminClient,
  queryInput: Record<string, unknown>,
): Promise<DisputeRow[]> {
  let query = db
    .schema("payments")
    .from("payment_disputes")
    .select(DISPUTE_COLUMNS);
  const status = normalizeStatus(queryInput.disputeStatus);

  if (status) {
    query = query.eq("status", status);
  }

  const { data, error } = await query
    .order("created_at", { ascending: false })
    .limit(50);

  if (error) {
    throw new ApiError(
      500,
      "ADMIN_DISPUTES_LOOKUP_FAILED",
      "争议记录查询失败。",
      {
        expose: false,
        cause: error,
      },
    );
  }

  return Array.isArray(data) ? (data as unknown as DisputeRow[]) : [];
}

function isExceptionOrder(order: StarOrderRow): boolean {
  if (["failed", "refunded", "disputed"].includes(order.status)) {
    return true;
  }

  return Boolean(order.error_message);
}

function summarizeOrders(orders: StarOrderRow[]): JsonRecord {
  const summary: JsonRecord = {};

  for (const order of orders) {
    summary[order.status] = Number(summary[order.status] ?? 0) + 1;
  }

  return summary;
}
