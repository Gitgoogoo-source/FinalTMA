import { ApiError, withApiHandler } from "../../_shared/handler.js";
import { requireAdmin } from "../../_shared/requireAdmin.js";
import { firstQueryValue } from "../_shared.js";
import {
  getAdminDb,
  getPage,
  nextCursorFor,
  requireUserId,
  rows,
  sanitizeJson,
} from "./_shared.js";

const STAR_ORDER_COLUMNS = [
  "id",
  "user_id",
  "business_type",
  "business_id",
  "status",
  "xtr_amount",
  "title",
  "description",
  "expires_at",
  "precheckout_at",
  "paid_at",
  "fulfilled_at",
  "error_message",
  "created_at",
  "updated_at",
].join(",");

export default withApiHandler(
  async (req) => {
    await requireAdmin(req, {
      permissions: ["payments:read", "admin:read"],
      requireAll: false,
    });

    const db = getAdminDb();
    const userId = requireUserId(req.query.userId ?? req.query.user_id);
    const { limit, offset } = getPage(req.query);
    const status = firstQueryValue(req.query.status);
    let query = db
      .schema("payments")
      .from("star_orders")
      .select(STAR_ORDER_COLUMNS)
      .eq("user_id", userId);

    if (status) {
      query = query.eq("status", status);
    }

    const { data, error } = await query
      .order("created_at", { ascending: false })
      .range(offset, offset + limit);

    if (error) {
      throw new ApiError(
        500,
        "ADMIN_USER_PAYMENTS_LOOKUP_FAILED",
        "用户支付查询失败。",
        {
          expose: false,
          cause: error,
        },
      );
    }

    const page = nextCursorFor(
      rows<Record<string, unknown>>(data),
      limit,
      offset,
    );
    const orderIds = page.pageRows
      .map((row) => (typeof row.id === "string" ? row.id : null))
      .filter((id): id is string => Boolean(id));
    const [payments, refunds, disputes] = await Promise.all([
      loadRelated("star_payments", "star_order_id", orderIds),
      loadRelated("star_refunds", "star_order_id", orderIds),
      loadRelated("payment_disputes", "star_order_id", orderIds),
    ]);

    return {
      items: page.pageRows.map((order) => ({
        ...order,
        payment: payments.find((row) => row.star_order_id === order.id) ?? null,
        refunds: refunds.filter((row) => row.star_order_id === order.id),
        disputes: disputes.filter((row) => row.star_order_id === order.id),
      })),
      nextCursor: page.nextCursor,
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

async function loadRelated(
  table: "star_payments" | "star_refunds" | "payment_disputes",
  column: string,
  orderIds: string[],
): Promise<Array<Record<string, unknown> & { star_order_id?: string }>> {
  if (orderIds.length === 0) {
    return [];
  }

  const db = getAdminDb();
  const { data, error } = await db
    .schema("payments")
    .from(table)
    .select(relatedColumns(table))
    .in(column, orderIds)
    .order("created_at", { ascending: false })
    .limit(200);

  if (error) {
    throw new ApiError(
      500,
      "ADMIN_USER_PAYMENT_RELATED_LOOKUP_FAILED",
      "支付关联数据查询失败。",
      {
        expose: false,
        cause: error,
      },
    );
  }

  return rows<Record<string, unknown> & { star_order_id?: string }>(data).map(
    sanitizeRelatedPaymentRow,
  );
}

function relatedColumns(
  table: "star_payments" | "star_refunds" | "payment_disputes",
): string {
  switch (table) {
    case "star_payments":
      return [
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
      ].join(",");
    case "star_refunds":
      return [
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
        "created_at",
        "updated_at",
      ].join(",");
    case "payment_disputes":
      return [
        "id",
        "user_id",
        "star_order_id",
        "star_payment_id",
        "status",
        "subject",
        "message",
        "resolution",
        "resolved_by_admin_id",
        "resolved_at",
        "metadata",
        "created_at",
        "updated_at",
      ].join(",");
  }
}

function sanitizeRelatedPaymentRow<T extends Record<string, unknown>>(
  row: T,
): T {
  return {
    ...row,
    metadata:
      row.metadata === undefined ? undefined : sanitizeJson(row.metadata),
  };
}
