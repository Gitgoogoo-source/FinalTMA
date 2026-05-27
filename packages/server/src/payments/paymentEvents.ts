export const PAYMENT_ORDER_STATUSES = [
  "created",
  "invoice_created",
  "precheckout_checked",
  "paid",
  "fulfilling",
  "fulfilled",
  "cancelled",
  "expired",
  "failed",
  "refunded",
  "disputed",
] as const;

export type PaymentOrderStatus = (typeof PAYMENT_ORDER_STATUSES)[number];

export const WEBHOOK_EVENT_PROCESS_STATUSES = [
  "received",
  "processing",
  "processed",
  "ignored",
  "failed",
] as const;

export type WebhookEventProcessStatus =
  (typeof WEBHOOK_EVENT_PROCESS_STATUSES)[number];

export interface BackendStatusContextInput {
  requestId: string;
  source: string;
  errorReason?: string | undefined;
  errorMessage?: string | undefined;
  details?: Record<string, unknown> | undefined;
}

export interface PaymentWebhookStatusUpdateInput extends BackendStatusContextInput {
  processStatus: WebhookEventProcessStatus;
  processingDurationMs?: number | undefined;
  nextRetryAt?: string | Date | null | undefined;
  webhookSecretVerified?: boolean | undefined;
}

const PAYMENT_ORDER_STATUS_SET = new Set<string>(PAYMENT_ORDER_STATUSES);

const PAYMENT_ORDER_STATUS_ALIASES: Record<string, PaymentOrderStatus> = {
  precheckout_ok: "precheckout_checked",
  pending: "created",
  pending_payment: "invoice_created",
  dev_paid: "fulfilled",
  opened: "fulfilled",
  completed: "fulfilled",
  opening: "fulfilling",
  processing: "fulfilling",
  canceled: "cancelled",
};

export function normalizePaymentOrderStatus(
  value: unknown,
): PaymentOrderStatus | null {
  const normalized = normalizeStatusText(value);

  if (!normalized) {
    return null;
  }

  const aliased = PAYMENT_ORDER_STATUS_ALIASES[normalized] ?? normalized;

  return PAYMENT_ORDER_STATUS_SET.has(aliased)
    ? (aliased as PaymentOrderStatus)
    : null;
}

export function inferPaymentOrderStatusFromDrawOrderStatus(
  value: unknown,
): PaymentOrderStatus | null {
  const normalized = normalizeStatusText(value);

  switch (normalized) {
    case "invoice_created":
    case "pending_payment":
    case "created":
      return "created";
    case "paid":
      return "paid";
    case "opening":
    case "processing":
      return "fulfilling";
    case "opened":
    case "completed":
      return "fulfilled";
    case "failed":
    case "expired":
    case "cancelled":
    case "canceled":
      return normalizePaymentOrderStatus(normalized);
    default:
      return null;
  }
}

export function isTerminalPaymentOrderStatus(
  value: unknown,
): value is PaymentOrderStatus {
  const status = normalizePaymentOrderStatus(value);

  return (
    status === "fulfilled" ||
    status === "failed" ||
    status === "expired" ||
    status === "refunded" ||
    status === "disputed" ||
    status === "cancelled"
  );
}

export function buildBackendStatusContext(
  input: BackendStatusContextInput,
): Record<string, unknown> {
  return removeUndefined({
    request_id: input.requestId,
    source: input.source,
    error_reason: normalizeOptionalText(input.errorReason),
    error_message: normalizeOptionalText(input.errorMessage),
    ...input.details,
  });
}

export function buildPaymentWebhookStatusUpdate(
  input: PaymentWebhookStatusUpdateInput,
): Record<string, unknown> {
  return removeUndefined({
    process_status: input.processStatus,
    error_message: normalizeOptionalText(input.errorMessage),
    processing_duration_ms: normalizeDurationMs(input.processingDurationMs),
    next_retry_at: normalizeDateTime(input.nextRetryAt),
    webhook_secret_verified: input.webhookSecretVerified,
    status_context: buildBackendStatusContext(input),
  });
}

function normalizeStatusText(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }

  const normalized = value.trim().toLowerCase();

  return normalized.length > 0 ? normalized : null;
}

function normalizeOptionalText(value: string | undefined): string | undefined {
  const normalized = value?.trim();

  return normalized ? normalized : undefined;
}

function normalizeDurationMs(value: number | undefined): number | undefined {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return undefined;
  }

  return Math.max(0, Math.trunc(value));
}

function normalizeDateTime(
  value: string | Date | null | undefined,
): string | null | undefined {
  if (value === null) {
    return null;
  }

  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? undefined : value.toISOString();
  }

  return normalizeOptionalText(value);
}

function removeUndefined<T extends Record<string, unknown>>(value: T): T {
  return Object.fromEntries(
    Object.entries(value).filter(([, itemValue]) => itemValue !== undefined),
  ) as T;
}
