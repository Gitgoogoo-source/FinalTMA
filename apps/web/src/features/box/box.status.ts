import type { FeedbackToastType } from "@/features/feedback/feedback.types";

export type PaymentStatusTone =
  | "pending"
  | "progress"
  | "success"
  | "warning"
  | "danger"
  | "neutral";

export type PaymentStatusMeta = {
  status: string;
  label: string;
  title: string;
  detail: string;
  tone: PaymentStatusTone;
  actionLabel: string;
  toastType: FeedbackToastType;
};

const PAYMENT_STATUS_META: Readonly<Record<string, PaymentStatusMeta>> = {
  pending_payment: {
    status: "pending_payment",
    label: "待支付",
    title: "等待支付",
    detail: "订单已创建，请在 Telegram Stars 完成支付。",
    tone: "pending",
    actionLabel: "刷新支付状态",
    toastType: "info",
  },
  created: {
    status: "created",
    label: "支付中",
    title: "支付订单已创建",
    detail: "订单已创建，请在 Telegram Stars 完成支付。",
    tone: "pending",
    actionLabel: "刷新状态",
    toastType: "info",
  },
  invoice_created: {
    status: "invoice_created",
    label: "支付中",
    title: "等待 Stars 支付",
    detail:
      "支付结果必须等 Telegram 回调和服务端确认，关闭支付窗口不代表成功。",
    tone: "pending",
    actionLabel: "查看结果状态",
    toastType: "info",
  },
  precheckout_checked: {
    status: "precheckout_checked",
    label: "支付校验中",
    title: "Telegram 正在校验支付",
    detail: "支付校验中，服务端已确认订单可支付，正在等待最终支付成功回调。",
    tone: "pending",
    actionLabel: "查看支付状态",
    toastType: "info",
  },
  paid: {
    status: "paid",
    label: "已支付",
    title: "支付已成功，等待发货",
    detail: "服务端已收到 successful_payment，正在等待发货事务。",
    tone: "progress",
    actionLabel: "查看发货状态",
    toastType: "info",
  },
  paid_waiting_fulfillment: {
    status: "paid_waiting_fulfillment",
    label: "已支付",
    title: "支付已成功，等待发货",
    detail: "Telegram 已确认支付，正在等待服务端发货事务。",
    tone: "progress",
    actionLabel: "查看发货状态",
    toastType: "info",
  },
  fulfilling: {
    status: "fulfilling",
    label: "发货中",
    title: "发货处理中",
    detail: "服务端正在生成抽卡结果、库存和账本记录。",
    tone: "progress",
    actionLabel: "查看开盒结果",
    toastType: "info",
  },
  fulfilled: {
    status: "fulfilled",
    label: "已完成",
    title: "开盒完成",
    detail: "发货完成，可以查看开盒结果。",
    tone: "success",
    actionLabel: "查看开盒结果",
    toastType: "success",
  },
  failed: {
    status: "failed",
    label: "失败",
    title: "支付或发货异常",
    detail: "订单处理异常，稍后会自动补发或请联系客服。",
    tone: "danger",
    actionLabel: "重试查询",
    toastType: "error",
  },
  fulfillment_failed_retrying: {
    status: "fulfillment_failed_retrying",
    label: "补发中",
    title: "支付已成功，奖励补发中",
    detail: "发货事务异常，后台会重试补发；请不要重复支付。",
    tone: "warning",
    actionLabel: "查看补发状态",
    toastType: "info",
  },
  cancelled: {
    status: "cancelled",
    label: "已取消",
    title: "支付已取消",
    detail: "Telegram 支付窗口已取消；如需继续开盒，请重新发起支付。",
    tone: "warning",
    actionLabel: "查看订单状态",
    toastType: "info",
  },
  expired: {
    status: "expired",
    label: "过期",
    title: "订单已过期",
    detail: "订单已过期，请重新开盒。",
    tone: "warning",
    actionLabel: "重新查看状态",
    toastType: "info",
  },
  refunded: {
    status: "refunded",
    label: "退款",
    title: "已退款",
    detail: "该订单已退款，资产状态以服务端记录为准。",
    tone: "neutral",
    actionLabel: "查看订单状态",
    toastType: "info",
  },
  disputed: {
    status: "disputed",
    label: "争议",
    title: "订单争议处理中",
    detail: "订单正在争议处理中，请等待客服或后台处理结果。",
    tone: "warning",
    actionLabel: "查看订单状态",
    toastType: "info",
  },
};

const PAYMENT_STATUS_ALIASES: Readonly<Record<string, string>> = {
  completed: "fulfilled",
  dev_paid: "fulfilled",
  opened: "fulfilled",
  paid_waiting: "paid_waiting_fulfillment",
  paid_and_fulfilled: "fulfilled",
  pending: "created",
  precheckout_ok: "precheckout_checked",
  processing: "fulfilling",
  opening: "fulfilling",
  canceled: "cancelled",
};

const PAYMENT_RETRY_ALLOWED_STATUSES = new Set([
  "",
  "pending_payment",
  "created",
  "invoice_created",
  "precheckout_checked",
]);

const PAYMENT_ACTIVE_FULFILLMENT_STATUSES = new Set([
  "paid",
  "paid_waiting_fulfillment",
  "fulfilling",
  "fulfillment_failed_retrying",
]);

const PAYMENT_TERMINAL_STATUSES = new Set([
  "fulfilled",
  "cancelled",
  "failed",
  "expired",
  "refunded",
  "disputed",
]);

export function getPaymentStatusMeta(
  value: string | null | undefined,
): PaymentStatusMeta {
  const status = normalizePaymentStatus(value);
  const meta = PAYMENT_STATUS_META[status];

  if (meta) {
    return meta;
  }

  return {
    status,
    label: "支付中",
    title: "状态同步中",
    detail: status
      ? `订单状态 ${status} 暂未匹配到固定文案，请刷新后以服务端状态为准。`
      : "订单状态暂未返回，请稍后刷新。",
    tone: "neutral",
    actionLabel: "刷新状态",
    toastType: "info",
  };
}

export function normalizePaymentStatus(
  value: string | null | undefined,
): string {
  const normalized = String(value ?? "")
    .trim()
    .toLowerCase();

  if (!normalized) {
    return "";
  }

  return PAYMENT_STATUS_ALIASES[normalized] ?? normalized;
}

export function isPaymentRetryAllowed(
  value: string | null | undefined,
): boolean {
  return PAYMENT_RETRY_ALLOWED_STATUSES.has(normalizePaymentStatus(value));
}

export function isPaymentFulfillmentActive(
  value: string | null | undefined,
): boolean {
  return PAYMENT_ACTIVE_FULFILLMENT_STATUSES.has(normalizePaymentStatus(value));
}

export function isPaymentTerminalStatus(
  value: string | null | undefined,
): boolean {
  return PAYMENT_TERMINAL_STATUSES.has(normalizePaymentStatus(value));
}

export function shouldPollDrawResultStatus(
  result:
    | {
        status?: string | null | undefined;
        paymentStatus?: string | null | undefined;
        orderStatus?: string | null | undefined;
      }
    | null
    | undefined,
): boolean {
  if (!result || result.status !== "pending") {
    return false;
  }

  const paymentStatus = normalizePaymentStatus(result.paymentStatus);
  const orderStatus = normalizePaymentStatus(result.orderStatus);

  if (paymentStatus === "fulfillment_failed_retrying") {
    return true;
  }

  if (
    isPaymentTerminalStatus(paymentStatus) ||
    isPaymentTerminalStatus(orderStatus)
  ) {
    return false;
  }

  if (
    isPaymentFulfillmentActive(paymentStatus) ||
    isPaymentFulfillmentActive(orderStatus)
  ) {
    return true;
  }

  return (
    isPaymentRetryAllowed(paymentStatus) ||
    isPaymentRetryAllowed(orderStatus) ||
    (!paymentStatus && !orderStatus)
  );
}
