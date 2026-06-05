import { useCallback } from "react";

import { getTelegramWebApp, type TelegramWebApp } from "@/types/telegram";

import type { CreateVipOrderResponse } from "../vip.types";

export type VipStarsInvoiceCallbackStatus =
  | "paid"
  | "cancelled"
  | "failed"
  | "pending"
  | "unknown";

export type VipStarsInvoiceCallbackResult = {
  status: VipStarsInvoiceCallbackStatus;
  rawStatus: string | null;
};

export type VipStarsInvoiceOpenAttempt =
  | {
      ok: true;
      status: "opening";
    }
  | {
      ok: false;
      status: "not_opened";
      reason: "missing_invoice_link" | "unsupported" | "open_failed";
      message: string;
    };

type OpenVipStarsInvoiceOptions = {
  webApp?: TelegramWebApp | null;
  onStatus?: (result: VipStarsInvoiceCallbackResult) => void;
};

const INVOICE_NOT_OPENED_MESSAGE = "支付未打开，可重试支付。";

export function useVipStarsPayment() {
  return useCallback(
    (
      order: CreateVipOrderResponse,
      onStatus?: (result: VipStarsInvoiceCallbackResult) => void,
    ) => openVipStarsInvoice(order, onStatus ? { onStatus } : {}),
    [],
  );
}

export function openVipStarsInvoice(
  order: CreateVipOrderResponse,
  options: OpenVipStarsInvoiceOptions = {},
): VipStarsInvoiceOpenAttempt {
  const invoiceLink = order.invoiceLink?.trim();

  if (!invoiceLink) {
    return createNotOpenedAttempt(
      "missing_invoice_link",
      "订单没有返回 Telegram invoice link，支付未打开，可重试支付。",
    );
  }

  const webApp = options.webApp ?? getTelegramWebApp();

  if (!webApp?.openInvoice) {
    return createNotOpenedAttempt(
      "unsupported",
      "当前环境不能打开 Telegram Stars invoice，请从 Telegram Mini App 内重试。",
    );
  }

  try {
    webApp.openInvoice(invoiceLink, (status) => {
      options.onStatus?.(normalizeVipInvoiceStatus(status));
    });

    return {
      ok: true,
      status: "opening",
    };
  } catch {
    return createNotOpenedAttempt("open_failed", INVOICE_NOT_OPENED_MESSAGE);
  }
}

export function normalizeVipInvoiceStatus(
  value: unknown,
): VipStarsInvoiceCallbackResult {
  const rawStatus =
    typeof value === "string" && value.trim().length > 0
      ? value.trim().toLowerCase()
      : null;

  switch (rawStatus) {
    case "paid":
    case "cancelled":
    case "failed":
    case "pending":
      return {
        status: rawStatus,
        rawStatus,
      };
    default:
      return {
        status: "unknown",
        rawStatus,
      };
  }
}

function createNotOpenedAttempt(
  reason: "missing_invoice_link" | "unsupported" | "open_failed",
  message: string,
): VipStarsInvoiceOpenAttempt {
  return {
    ok: false,
    status: "not_opened",
    reason,
    message,
  };
}
