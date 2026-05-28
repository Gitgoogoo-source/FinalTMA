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
    title: "支付已成功",
    detail: "服务端已收到 successful_payment，正在等待发货事务。",
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
  paid_and_fulfilled: "fulfilled",
  pending: "created",
  pending_payment: "invoice_created",
  precheckout_ok: "precheckout_checked",
};

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
