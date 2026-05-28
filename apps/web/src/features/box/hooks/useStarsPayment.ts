import { useCallback } from "react";

import { getTelegramWebApp, type TelegramWebApp } from "@/types/telegram";

import type { CreateOpenOrderResponse } from "../box.types";

export const PENDING_STARS_PAYMENT_STORAGE_KEY =
  "tma:box:pending-stars-payment-order";

export type StarsInvoiceCallbackStatus =
  | "paid"
  | "cancelled"
  | "failed"
  | "pending"
  | "unknown";

export type StarsInvoiceCallbackResult = {
  status: StarsInvoiceCallbackStatus;
  rawStatus: string | null;
};

export type StarsInvoiceOpenAttempt =
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

export type PendingStarsPaymentOrder = {
  orderId: string;
  expiresAt: string | null;
  savedAt: string;
};

type OpenTelegramStarsInvoiceOptions = {
  storage?: StarsPaymentStorage | null;
  webApp?: TelegramWebApp | null;
  now?: () => Date;
  onStatus?: (result: StarsInvoiceCallbackResult) => void;
};

type StarsPaymentStorage = Pick<Storage, "getItem" | "removeItem" | "setItem">;
type StarsPaymentPersistenceOptions = {
  storage?: StarsPaymentStorage | null | undefined;
  now?: (() => Date) | undefined;
};

const INVOICE_NOT_OPENED_MESSAGE = "支付未打开，可重试支付。";

export function useStarsPayment() {
  return useCallback(
    (
      order: CreateOpenOrderResponse,
      onStatus?: (result: StarsInvoiceCallbackResult) => void,
    ) => openTelegramStarsInvoice(order, onStatus ? { onStatus } : {}),
    [],
  );
}

export function openTelegramStarsInvoice(
  order: CreateOpenOrderResponse,
  options: OpenTelegramStarsInvoiceOptions = {},
): StarsInvoiceOpenAttempt {
  savePendingStarsPaymentOrder(order, {
    now: options.now,
    storage: options.storage,
  });

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
      options.onStatus?.(normalizeTelegramInvoiceStatus(status));
    });

    return {
      ok: true,
      status: "opening",
    };
  } catch {
    return createNotOpenedAttempt("open_failed", INVOICE_NOT_OPENED_MESSAGE);
  }
}

export function savePendingStarsPaymentOrder(
  order: CreateOpenOrderResponse,
  options: StarsPaymentPersistenceOptions = {},
): PendingStarsPaymentOrder | null {
  const orderId = order.orderId.trim();

  if (!orderId) {
    return null;
  }

  const record: PendingStarsPaymentOrder = {
    orderId,
    expiresAt: order.expiresAt,
    savedAt: (options.now?.() ?? new Date()).toISOString(),
  };

  const storage = resolveStarsPaymentStorage(options.storage);

  if (!storage) {
    return record;
  }

  try {
    storage.setItem(PENDING_STARS_PAYMENT_STORAGE_KEY, JSON.stringify(record));
  } catch {
    // Local persistence is only a restore hint; invoice opening must continue.
  }

  return record;
}

export function readPendingStarsPaymentOrder(
  options: StarsPaymentPersistenceOptions = {},
): PendingStarsPaymentOrder | null {
  const storage = resolveStarsPaymentStorage(options.storage);

  if (!storage) {
    return null;
  }

  try {
    const raw = storage.getItem(PENDING_STARS_PAYMENT_STORAGE_KEY);

    if (!raw) {
      return null;
    }

    const value = JSON.parse(raw) as unknown;
    const record = normalizePendingStarsPaymentOrder(value);

    if (!record) {
      storage.removeItem(PENDING_STARS_PAYMENT_STORAGE_KEY);
      return null;
    }

    if (isExpiredPendingOrder(record, options.now?.() ?? new Date())) {
      storage.removeItem(PENDING_STARS_PAYMENT_STORAGE_KEY);
      return null;
    }

    return record;
  } catch {
    return null;
  }
}

export function clearPendingStarsPaymentOrder(
  orderId?: string | null,
  storageOption?: StarsPaymentStorage | null,
): void {
  const storage = resolveStarsPaymentStorage(storageOption);

  if (!storage) {
    return;
  }

  try {
    if (orderId) {
      const current = readStoredPendingStarsPaymentOrder(storage);

      if (current?.orderId !== orderId) {
        return;
      }
    }

    storage.removeItem(PENDING_STARS_PAYMENT_STORAGE_KEY);
  } catch {
    // Best-effort cleanup only.
  }
}

export function normalizeTelegramInvoiceStatus(
  value: unknown,
): StarsInvoiceCallbackResult {
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
): StarsInvoiceOpenAttempt {
  return {
    ok: false,
    status: "not_opened",
    reason,
    message,
  };
}

function readStoredPendingStarsPaymentOrder(
  storage: StarsPaymentStorage,
): PendingStarsPaymentOrder | null {
  const raw = storage.getItem(PENDING_STARS_PAYMENT_STORAGE_KEY);

  if (!raw) {
    return null;
  }

  return normalizePendingStarsPaymentOrder(JSON.parse(raw) as unknown);
}

function normalizePendingStarsPaymentOrder(
  value: unknown,
): PendingStarsPaymentOrder | null {
  if (!isRecord(value)) {
    return null;
  }

  const orderId = readNonEmptyString(value.orderId);
  const savedAt = readNonEmptyString(value.savedAt);

  if (!orderId || !savedAt) {
    return null;
  }

  return {
    orderId,
    expiresAt: readNonEmptyString(value.expiresAt),
    savedAt,
  };
}

function isExpiredPendingOrder(
  order: PendingStarsPaymentOrder,
  now: Date,
): boolean {
  if (!order.expiresAt) {
    return false;
  }

  const expiresAt = Date.parse(order.expiresAt);

  if (!Number.isFinite(expiresAt)) {
    return false;
  }

  return expiresAt <= now.getTime();
}

function resolveStarsPaymentStorage(
  storageOption: StarsPaymentStorage | null | undefined,
): StarsPaymentStorage | null {
  if (storageOption !== undefined) {
    return storageOption;
  }

  try {
    return globalThis.localStorage ?? null;
  } catch {
    return null;
  }
}

function readNonEmptyString(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }

  const normalized = value.trim();

  return normalized.length > 0 ? normalized : null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
