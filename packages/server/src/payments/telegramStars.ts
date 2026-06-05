import type { SupabaseAdminClient } from "../db/supabaseAdmin.js";
import { callRpcRaw } from "../db/rpc.js";
import { isPaymentWebhookFulfillmentEnabled } from "./paymentGuards.js";

export type TelegramInvoiceOpenMode =
  | "telegram_link"
  | "web_app_open_invoice"
  | "bot_api"
  | "unknown";

export type TelegramStarsInvoiceResult = {
  starOrderId: string;
  payload: string;
  invoiceLink: string | null;
  openMode: TelegramInvoiceOpenMode;
  botApiMethod: "createInvoiceLink";
  expiresAt: string | null;
  invoiceStatus: string;
  paymentOrderStatus: string;
  reused: boolean;
};

export type CreateTelegramStarsInvoiceInput = {
  starOrderId: string;
  drawOrderId: string;
  userId: string;
  invoicePayload: string;
  xtrAmount: number;
  requestId: string;
  openMode?: TelegramInvoiceOpenMode | undefined;
  client?: SupabaseAdminClient | undefined;
  fetchImpl?: FetchImpl | undefined;
  env?: NodeJS.ProcessEnv | undefined;
};

export type TelegramCreateInvoiceLinkRequest = {
  title: string;
  description: string;
  payload: string;
  provider_token: string;
  currency: "XTR";
  prices: [
    {
      label: string;
      amount: number;
    },
  ];
};

export type TelegramPreCheckoutQuery = {
  id: string;
  fromId: number;
  currency: string;
  totalAmount: number;
  invoicePayload: string;
};

export type TelegramPreCheckoutUpdate = {
  updateId: number;
  preCheckoutQuery: TelegramPreCheckoutQuery;
};

export type TelegramSuccessfulPayment = {
  fromId: number;
  currency: string;
  totalAmount: number;
  invoicePayload: string;
  telegramPaymentChargeId: string;
  providerPaymentChargeId: string | null;
};

export type TelegramSuccessfulPaymentUpdate = {
  updateId: number;
  successfulPayment: TelegramSuccessfulPayment;
};

export type TelegramAnswerPreCheckoutQueryRequest = {
  pre_checkout_query_id: string;
  ok: boolean;
  error_message?: string | undefined;
};

export type PaymentMarkPrecheckoutResult = {
  allowed: boolean;
  idempotent: boolean;
  eventId: string;
  starOrderId: string | null;
  drawOrderId: string | null;
  invoicePayload: string | null;
  reasonCode: string | null;
  errorMessage: string | null;
  paymentOrderStatus: string | null;
};

export type ProcessTelegramPreCheckoutInput = {
  update: unknown;
  requestId: string;
  requestHeadersHash?: string | null | undefined;
  webhookSecretVerified?: boolean | undefined;
  client?: SupabaseAdminClient | undefined;
  fetchImpl?: FetchImpl | undefined;
  env?: NodeJS.ProcessEnv | undefined;
};

export type ProcessTelegramPreCheckoutResult = PaymentMarkPrecheckoutResult & {
  eventType: "pre_checkout_query";
  answered: true;
  telegramAnswerOk: boolean;
};

export type PaymentRecordSuccessfulPaymentResult = {
  paymentRecorded: boolean;
  idempotent: boolean;
  duplicateUpdate: boolean;
  duplicateCharge: boolean;
  eventId: string;
  starOrderId: string | null;
  starPaymentId: string | null;
  drawOrderId: string | null;
  invoicePayload: string | null;
  telegramPaymentChargeId: string | null;
  reasonCode: string | null;
  errorMessage: string | null;
  paymentOrderStatus: string | null;
  processStatus: string | null;
  paidAt: string | null;
};

export type PaymentFulfillmentResult = {
  fulfilled: boolean;
  idempotent: boolean;
  status: string | null;
  starOrderId: string | null;
  drawOrderId: string | null;
  drawCount: number | null;
  quantity: number | null;
  resultCount: number | null;
  reasonCode: string | null;
  errorMessage: string | null;
  paymentOrderStatus: string | null;
  retryable: boolean;
};

export type ProcessTelegramSuccessfulPaymentInput = {
  update: unknown;
  requestId: string;
  requestHeadersHash?: string | null | undefined;
  webhookSecretVerified?: boolean | undefined;
  client?: SupabaseAdminClient | undefined;
  env?: NodeJS.ProcessEnv | undefined;
};

export type ProcessTelegramSuccessfulPaymentResult =
  PaymentRecordSuccessfulPaymentResult & {
    eventType: "successful_payment";
    fulfillmentAttempted: boolean;
    fulfillment: PaymentFulfillmentResult | null;
  };

export type TelegramWebhookProcessStatus =
  | "received"
  | "processing"
  | "processed"
  | "ignored"
  | "failed";

export type RecordTelegramWebhookReceivedInput = {
  update: unknown;
  eventType: string;
  requestId: string;
  requestHeadersHash?: string | null | undefined;
  webhookSecretVerified: boolean;
  processStatus?: TelegramWebhookProcessStatus | undefined;
  errorMessage?: string | null | undefined;
  statusContext?: Record<string, unknown> | undefined;
  nextRetryAt?: string | Date | null | undefined;
  incrementRetryCount?: boolean | undefined;
  client?: SupabaseAdminClient | undefined;
};

export type TelegramWebhookReceivedResult = {
  eventId: string;
  updateId: number | null;
  eventType: string;
  processStatus: TelegramWebhookProcessStatus;
  telegramUserId: number | null;
  invoicePayload: string | null;
  webhookSecretVerified: boolean;
  duplicateUpdate: boolean;
  eventTypeConflict: boolean;
  retryCount: number;
  reasonCode: string | null;
  errorMessage: string | null;
};

type FetchImpl = (input: string | URL, init?: RequestInit) => Promise<Response>;

type StarOrderRow = {
  id: string;
  user_id: string;
  business_type: string;
  business_id: string | null;
  status: string;
  xtr_amount: number;
  telegram_invoice_payload: string;
  title: string;
  description: string | null;
  expires_at: string | null;
};

type StarInvoiceRow = {
  star_order_id: string;
  invoice_link: string | null;
  payload: string;
  status: string;
  open_mode: string;
  bot_api_method: string | null;
  expires_at: string | null;
};

type TelegramBotApiPayload = {
  ok?: unknown;
  result?: unknown;
  description?: unknown;
  error_code?: unknown;
  parameters?: unknown;
};

export class TelegramStarsInvoiceError extends Error {
  readonly statusCode: number;
  readonly code: string;
  readonly expose: boolean;
  readonly details?: Record<string, unknown> | undefined;
  override readonly cause?: unknown;

  constructor(
    statusCode: number,
    code: string,
    message: string,
    options: {
      expose?: boolean | undefined;
      details?: Record<string, unknown> | undefined;
      cause?: unknown;
    } = {},
  ) {
    super(message);
    this.name = "TelegramStarsInvoiceError";
    this.statusCode = statusCode;
    this.code = code;
    this.expose = options.expose ?? statusCode < 500;
    this.details = options.details;
    this.cause = options.cause;
  }
}

export class TelegramStarsWebhookError extends Error {
  readonly statusCode: number;
  readonly code: string;
  readonly expose: boolean;
  readonly details?: Record<string, unknown> | undefined;
  override readonly cause?: unknown;

  constructor(
    statusCode: number,
    code: string,
    message: string,
    options: {
      expose?: boolean | undefined;
      details?: Record<string, unknown> | undefined;
      cause?: unknown;
    } = {},
  ) {
    super(message);
    this.name = "TelegramStarsWebhookError";
    this.statusCode = statusCode;
    this.code = code;
    this.expose = options.expose ?? statusCode < 500;
    this.details = options.details;
    this.cause = options.cause;
  }
}

const TELEGRAM_BOT_API_BASE_URL = "https://api.telegram.org";
const CREATE_INVOICE_LINK_METHOD = "createInvoiceLink";
const ANSWER_PRE_CHECKOUT_QUERY_METHOD = "answerPreCheckoutQuery";
const DEFAULT_OPEN_MODE: TelegramInvoiceOpenMode = "web_app_open_invoice";
const MAX_TELEGRAM_TITLE_CHARS = 32;
const MAX_TELEGRAM_DESCRIPTION_CHARS = 255;
const MAX_TELEGRAM_PAYLOAD_BYTES = 128;
const MAX_PRE_CHECKOUT_ERROR_MESSAGE_CHARS = 200;
const INVOICE_CREATABLE_STAR_ORDER_STATUSES = new Set([
  "created",
  "invoice_created",
  "precheckout_ok",
  "precheckout_checked",
]);

export function hasTelegramPreCheckoutQuery(
  update: unknown,
): update is Record<string, unknown> {
  return isRecord(update) && isRecord(update.pre_checkout_query);
}

export function hasTelegramSuccessfulPayment(
  update: unknown,
): update is Record<string, unknown> {
  return (
    isRecord(update) &&
    isRecord(update.message) &&
    isRecord(update.message.successful_payment)
  );
}

export function inferTelegramUpdateEventType(update: unknown): string {
  if (!isRecord(update)) {
    return "invalid_update";
  }

  if (isRecord(update.pre_checkout_query)) {
    return "pre_checkout_query";
  }

  if (isRecord(update.message) && isRecord(update.message.successful_payment)) {
    return "successful_payment";
  }

  if (isRecord(update.message)) {
    return "message";
  }

  if (isRecord(update.edited_message)) {
    return "edited_message";
  }

  if (isRecord(update.callback_query)) {
    return "callback_query";
  }

  return "unsupported_update";
}

export async function recordTelegramWebhookReceived(
  input: RecordTelegramWebhookReceivedInput,
): Promise<TelegramWebhookReceivedResult> {
  const fields = extractTelegramWebhookAuditFields(input.update);
  const rpcOptions = {
    schema: "api" as never,
    context: {
      requestId: input.requestId,
      updateId: fields.updateId,
      eventType: input.eventType,
    },
    ...(input.client ? { client: input.client } : {}),
  };
  const rawResult = await callRpcRaw<Record<string, unknown>>(
    "payment_record_telegram_webhook_received",
    {
      p_update_id: fields.updateId,
      p_event_type: input.eventType,
      p_telegram_user_id: fields.telegramUserId,
      p_invoice_payload: fields.invoicePayload,
      p_raw_update: toWebhookJsonPayload(input.update),
      p_request_headers_hash: input.requestHeadersHash ?? null,
      p_request_id: input.requestId,
      p_webhook_secret_verified: input.webhookSecretVerified,
      p_process_status: input.processStatus ?? "received",
      p_error_message: input.errorMessage ?? null,
      p_status_context: input.statusContext ?? {},
      p_next_retry_at: normalizeWebhookDateTime(input.nextRetryAt),
      p_increment_retry_count: input.incrementRetryCount ?? true,
    },
    rpcOptions,
  );

  return normalizeTelegramWebhookReceivedResult(rawResult);
}

export function parseTelegramPreCheckoutUpdate(
  update: unknown,
): TelegramPreCheckoutUpdate {
  if (!isRecord(update)) {
    throw new TelegramStarsWebhookError(
      400,
      "TELEGRAM_UPDATE_INVALID",
      "Telegram update 格式无效。",
    );
  }

  const updateId = requiredWebhookInteger(update.update_id, "update.update_id");
  const preCheckoutQuery = update.pre_checkout_query;

  if (!isRecord(preCheckoutQuery)) {
    throw new TelegramStarsWebhookError(
      400,
      "PRE_CHECKOUT_QUERY_MISSING",
      "Telegram update 缺少 pre_checkout_query。",
    );
  }

  const from = preCheckoutQuery.from;

  if (!isRecord(from)) {
    throw new TelegramStarsWebhookError(
      400,
      "PRE_CHECKOUT_FROM_MISSING",
      "Telegram pre_checkout_query 缺少 from。",
    );
  }

  return {
    updateId,
    preCheckoutQuery: {
      id: requiredWebhookString(preCheckoutQuery.id, "pre_checkout_query.id"),
      fromId: requiredWebhookInteger(from.id, "pre_checkout_query.from.id"),
      currency: requiredWebhookString(
        preCheckoutQuery.currency,
        "pre_checkout_query.currency",
      ),
      totalAmount: requiredWebhookInteger(
        preCheckoutQuery.total_amount,
        "pre_checkout_query.total_amount",
      ),
      invoicePayload: requiredWebhookString(
        preCheckoutQuery.invoice_payload,
        "pre_checkout_query.invoice_payload",
      ),
    },
  };
}

export function parseTelegramSuccessfulPaymentUpdate(
  update: unknown,
): TelegramSuccessfulPaymentUpdate {
  if (!isRecord(update)) {
    throw new TelegramStarsWebhookError(
      400,
      "TELEGRAM_UPDATE_INVALID",
      "Telegram update 格式无效。",
    );
  }

  const updateId = requiredWebhookInteger(update.update_id, "update.update_id");
  const message = update.message;

  if (!isRecord(message)) {
    throw new TelegramStarsWebhookError(
      400,
      "SUCCESSFUL_PAYMENT_MESSAGE_MISSING",
      "Telegram update 缺少 message。",
    );
  }

  const from = message.from;

  if (!isRecord(from)) {
    throw new TelegramStarsWebhookError(
      400,
      "SUCCESSFUL_PAYMENT_FROM_MISSING",
      "Telegram successful_payment 缺少 from。",
    );
  }

  const successfulPayment = message.successful_payment;

  if (!isRecord(successfulPayment)) {
    throw new TelegramStarsWebhookError(
      400,
      "SUCCESSFUL_PAYMENT_MISSING",
      "Telegram update 缺少 successful_payment。",
    );
  }

  return {
    updateId,
    successfulPayment: {
      fromId: requiredWebhookInteger(from.id, "message.from.id"),
      currency: requiredWebhookString(
        successfulPayment.currency,
        "successful_payment.currency",
      ),
      totalAmount: requiredWebhookInteger(
        successfulPayment.total_amount,
        "successful_payment.total_amount",
      ),
      invoicePayload: requiredWebhookString(
        successfulPayment.invoice_payload,
        "successful_payment.invoice_payload",
      ),
      telegramPaymentChargeId: requiredWebhookString(
        successfulPayment.telegram_payment_charge_id,
        "successful_payment.telegram_payment_charge_id",
      ),
      providerPaymentChargeId: optionalString(
        successfulPayment.provider_payment_charge_id,
      ),
    },
  };
}

export function buildAnswerPreCheckoutQueryRequest(input: {
  preCheckoutQueryId: string;
  ok: boolean;
  errorMessage?: string | null | undefined;
}): TelegramAnswerPreCheckoutQueryRequest {
  const preCheckoutQueryId = input.preCheckoutQueryId.trim();

  if (!preCheckoutQueryId) {
    throw new TelegramStarsWebhookError(
      500,
      "PRE_CHECKOUT_QUERY_ID_INVALID",
      "Telegram pre_checkout_query id 无效。",
      { expose: false },
    );
  }

  if (input.ok) {
    return {
      pre_checkout_query_id: preCheckoutQueryId,
      ok: true,
    };
  }

  return {
    pre_checkout_query_id: preCheckoutQueryId,
    ok: false,
    error_message: normalizeTelegramText(
      input.errorMessage,
      "支付校验失败，请重新下单。",
      MAX_PRE_CHECKOUT_ERROR_MESSAGE_CHARS,
    ),
  };
}

export function parseAnswerPreCheckoutQueryResponse(payload: unknown): boolean {
  if (!isRecord(payload)) {
    throw new TelegramStarsWebhookError(
      502,
      "TELEGRAM_PRE_CHECKOUT_RESPONSE_INVALID",
      "Telegram pre_checkout 响应格式无效。",
      { expose: true },
    );
  }

  if (payload.ok !== true) {
    throw new TelegramStarsWebhookError(
      502,
      "TELEGRAM_PRE_CHECKOUT_ANSWER_FAILED",
      getTelegramApiErrorDescription(payload),
      {
        expose: true,
        details: {
          errorCode:
            typeof payload.error_code === "number"
              ? payload.error_code
              : undefined,
        },
      },
    );
  }

  if (payload.result !== true) {
    throw new TelegramStarsWebhookError(
      502,
      "TELEGRAM_PRE_CHECKOUT_RESPONSE_INVALID",
      "Telegram pre_checkout 响应缺少确认结果。",
      { expose: true },
    );
  }

  return true;
}

export async function processTelegramPreCheckoutUpdate(
  input: ProcessTelegramPreCheckoutInput,
): Promise<ProcessTelegramPreCheckoutResult> {
  const parsed = parseTelegramPreCheckoutUpdate(input.update);
  const preCheckoutQuery = parsed.preCheckoutQuery;
  const markResult = await markTelegramPreCheckoutChecked({
    updateId: parsed.updateId,
    preCheckoutQuery,
    rawUpdate: input.update,
    requestId: input.requestId,
    requestHeadersHash: input.requestHeadersHash ?? null,
    webhookSecretVerified: input.webhookSecretVerified ?? true,
    client: input.client,
  });

  try {
    await answerPreCheckoutQuery({
      preCheckoutQueryId: preCheckoutQuery.id,
      ok: markResult.allowed,
      errorMessage: markResult.errorMessage,
      fetchImpl: input.fetchImpl,
      env: input.env,
    });
  } catch (error) {
    await markWebhookEventAnswerFailed({
      eventId: markResult.eventId,
      requestId: input.requestId,
      error,
      client: input.client,
    });

    throw error;
  }

  return {
    ...markResult,
    eventType: "pre_checkout_query",
    answered: true,
    telegramAnswerOk: true,
  };
}

export async function processTelegramSuccessfulPaymentUpdate(
  input: ProcessTelegramSuccessfulPaymentInput,
): Promise<ProcessTelegramSuccessfulPaymentResult> {
  const parsed = parseTelegramSuccessfulPaymentUpdate(input.update);
  const recordResult = await recordTelegramSuccessfulPayment({
    updateId: parsed.updateId,
    successfulPayment: parsed.successfulPayment,
    rawUpdate: input.update,
    requestId: input.requestId,
    requestHeadersHash: input.requestHeadersHash ?? null,
    webhookSecretVerified: input.webhookSecretVerified ?? true,
    client: input.client,
  });
  const shouldFulfill = shouldFulfillRecordedPayment(recordResult);

  if (!shouldFulfill) {
    return {
      ...recordResult,
      eventType: "successful_payment",
      fulfillmentAttempted: false,
      fulfillment: null,
    };
  }

  const fulfillmentEnabled = await isPaymentWebhookFulfillmentEnabled({
    client: input.client,
    env: input.env,
  });

  if (!fulfillmentEnabled) {
    return {
      ...recordResult,
      eventType: "successful_payment",
      fulfillmentAttempted: false,
      fulfillment: null,
    };
  }

  let fulfillment: PaymentFulfillmentResult;

  try {
    fulfillment = await fulfillTelegramSuccessfulPayment({
      recordResult,
      successfulPayment: parsed.successfulPayment,
      rawUpdate: input.update,
      requestId: input.requestId,
      client: input.client,
    });
  } catch (error) {
    await markWebhookEventFulfillmentFailed({
      eventId: recordResult.eventId,
      requestId: input.requestId,
      error,
      client: input.client,
    });

    throw error;
  }

  return {
    ...recordResult,
    paymentOrderStatus:
      fulfillment.paymentOrderStatus ?? recordResult.paymentOrderStatus,
    processStatus: fulfillment.fulfilled ? "processed" : "failed",
    eventType: "successful_payment",
    fulfillmentAttempted: true,
    fulfillment,
  };
}

export async function createTelegramStarsInvoice(
  input: CreateTelegramStarsInvoiceInput,
): Promise<TelegramStarsInvoiceResult> {
  const starOrder = await fetchStarOrder(input.starOrderId, {
    client: input.client,
    requestId: input.requestId,
  });

  assertStarOrderMatchesInput(starOrder, input);

  const existingInvoice = await fetchExistingInvoice(input.invoicePayload, {
    client: input.client,
    requestId: input.requestId,
    starOrderId: input.starOrderId,
  });
  const openMode = input.openMode ?? DEFAULT_OPEN_MODE;

  if (existingInvoice && existingInvoice.star_order_id !== input.starOrderId) {
    throw new TelegramStarsInvoiceError(
      409,
      "TELEGRAM_INVOICE_PAYLOAD_CONFLICT",
      "Invoice payload 已绑定到其他支付订单。",
      {
        details: {
          starOrderId: input.starOrderId,
          payload: input.invoicePayload,
        },
      },
    );
  }

  if (existingInvoice?.invoice_link && existingInvoice.status !== "failed") {
    await markOrderInvoiceCreated({
      starOrderId: input.starOrderId,
      drawOrderId: input.drawOrderId,
      invoicePayload: input.invoicePayload,
      client: input.client,
      requestId: input.requestId,
    });

    return {
      starOrderId: input.starOrderId,
      payload: existingInvoice.payload,
      invoiceLink: existingInvoice.invoice_link,
      openMode: normalizeOpenMode(existingInvoice.open_mode),
      botApiMethod: "createInvoiceLink",
      expiresAt: existingInvoice.expires_at ?? starOrder.expires_at,
      invoiceStatus: existingInvoice.status,
      paymentOrderStatus: normalizeInvoicePaymentOrderStatus(starOrder.status),
      reused: true,
    };
  }

  const config = readTelegramStarsInvoiceConfig(input.env);
  const request = buildTelegramStarsInvoiceRequest({
    title: starOrder.title,
    description: starOrder.description,
    payload: input.invoicePayload,
    xtrAmount: input.xtrAmount,
    providerToken: config.providerToken,
  });
  const sanitizedRequest = sanitizeInvoiceRequest(request);
  let rawResponse: Record<string, unknown>;
  let invoiceLink: string;

  try {
    rawResponse = await postCreateInvoiceLink({
      botToken: config.botToken,
      request,
      fetchImpl: input.fetchImpl,
    });
    invoiceLink = parseCreateInvoiceLinkResponse(rawResponse);
  } catch (error) {
    await recordInvoiceFailure({
      starOrderId: input.starOrderId,
      drawOrderId: input.drawOrderId,
      payload: input.invoicePayload,
      openMode,
      expiresAt: starOrder.expires_at,
      rawRequest: sanitizedRequest,
      rawResponse: getInvoiceFailureResponse(error),
      errorMessage: getPublicErrorMessage(error),
      client: input.client,
      requestId: input.requestId,
    });

    if (error instanceof TelegramStarsInvoiceError) {
      throw error;
    }

    throw new TelegramStarsInvoiceError(
      502,
      "TELEGRAM_INVOICE_CREATE_FAILED",
      "Telegram Stars invoice 创建失败，请稍后重试。",
      {
        expose: true,
        details: {
          starOrderId: input.starOrderId,
          requestId: input.requestId,
        },
        cause: error,
      },
    );
  }

  const invoice = await recordInvoiceSuccess({
    starOrderId: input.starOrderId,
    payload: input.invoicePayload,
    invoiceLink,
    openMode,
    expiresAt: starOrder.expires_at,
    rawRequest: sanitizedRequest,
    rawResponse,
    client: input.client,
    requestId: input.requestId,
  });

  await markOrderInvoiceCreated({
    starOrderId: input.starOrderId,
    drawOrderId: input.drawOrderId,
    invoicePayload: input.invoicePayload,
    client: input.client,
    requestId: input.requestId,
  });

  return {
    starOrderId: input.starOrderId,
    payload: invoice.payload,
    invoiceLink: invoice.invoice_link,
    openMode: normalizeOpenMode(invoice.open_mode),
    botApiMethod: "createInvoiceLink",
    expiresAt: invoice.expires_at ?? starOrder.expires_at,
    invoiceStatus: invoice.status,
    paymentOrderStatus: normalizeInvoicePaymentOrderStatus(starOrder.status),
    reused: false,
  };
}

export function buildTelegramStarsInvoiceRequest(input: {
  title: string | null | undefined;
  description: string | null | undefined;
  payload: string;
  xtrAmount: number;
  providerToken?: string | undefined;
}): TelegramCreateInvoiceLinkRequest {
  const amount = normalizeXtrAmount(input.xtrAmount);
  const payload = normalizeInvoicePayload(input.payload);
  const title = normalizeTelegramText(
    input.title,
    "Open Blind Box",
    MAX_TELEGRAM_TITLE_CHARS,
  );
  const description = normalizeTelegramText(
    input.description,
    "Telegram Stars blind box order",
    MAX_TELEGRAM_DESCRIPTION_CHARS,
  );

  return {
    title,
    description,
    payload,
    provider_token: input.providerToken ?? "",
    currency: "XTR",
    prices: [
      {
        label: title,
        amount,
      },
    ],
  };
}

export function parseCreateInvoiceLinkResponse(payload: unknown): string {
  if (!isRecord(payload)) {
    throw new TelegramStarsInvoiceError(
      502,
      "TELEGRAM_INVOICE_RESPONSE_INVALID",
      "Telegram invoice 响应格式无效。",
      { expose: true },
    );
  }

  if (payload.ok !== true) {
    throw new TelegramStarsInvoiceError(
      502,
      "TELEGRAM_INVOICE_CREATE_FAILED",
      getTelegramApiErrorDescription(payload),
      {
        expose: true,
        details: {
          errorCode:
            typeof payload.error_code === "number"
              ? payload.error_code
              : undefined,
        },
      },
    );
  }

  if (typeof payload.result !== "string" || payload.result.trim() === "") {
    throw new TelegramStarsInvoiceError(
      502,
      "TELEGRAM_INVOICE_RESPONSE_INVALID",
      "Telegram invoice 响应缺少 invoice link。",
      { expose: true },
    );
  }

  return payload.result.trim();
}

async function fetchStarOrder(
  starOrderId: string,
  options: {
    client?: SupabaseAdminClient | undefined;
    requestId?: string | undefined;
  } = {},
): Promise<StarOrderRow> {
  let result: Record<string, unknown> | null;

  try {
    result = await callRpcRaw<Record<string, unknown> | null>(
      "payment_get_star_order_for_invoice",
      {
        p_star_order_id: starOrderId,
      },
      createPaymentRpcOptions(options, {
        rpcPurpose: "fetch_star_order_for_invoice",
        starOrderId,
      }),
    );
  } catch (error) {
    throw new TelegramStarsInvoiceError(
      500,
      "STAR_ORDER_READ_FAILED",
      "读取 Stars 支付订单失败。",
      {
        expose: false,
        cause: error,
      },
    );
  }

  if (!result) {
    throw new TelegramStarsInvoiceError(
      404,
      "STAR_ORDER_NOT_FOUND",
      "Stars 支付订单不存在。",
      {
        details: {
          starOrderId,
        },
      },
    );
  }

  return normalizeStarOrderRow(result);
}

async function fetchExistingInvoice(
  payload: string,
  options: {
    client?: SupabaseAdminClient | undefined;
    requestId?: string | undefined;
    starOrderId?: string | undefined;
  } = {},
): Promise<StarInvoiceRow | null> {
  let result: Record<string, unknown> | null;

  try {
    result = await callRpcRaw<Record<string, unknown> | null>(
      "payment_get_star_invoice_by_payload",
      {
        p_payload: payload,
      },
      createPaymentRpcOptions(options, {
        rpcPurpose: "fetch_existing_invoice",
        starOrderId: options.starOrderId,
      }),
    );
  } catch (error) {
    throw new TelegramStarsInvoiceError(
      500,
      "STAR_INVOICE_READ_FAILED",
      "读取 Stars invoice 失败。",
      {
        expose: false,
        cause: error,
      },
    );
  }

  return result ? normalizeStarInvoiceRow(result) : null;
}

async function recordInvoiceSuccess(input: {
  starOrderId: string;
  payload: string;
  invoiceLink: string;
  openMode: TelegramInvoiceOpenMode;
  expiresAt: string | null;
  rawRequest: Record<string, unknown>;
  rawResponse: Record<string, unknown>;
  client?: SupabaseAdminClient | undefined;
  requestId?: string | undefined;
}): Promise<StarInvoiceRow> {
  let result: Record<string, unknown>;

  try {
    result = await callRpcRaw<Record<string, unknown>>(
      "payment_upsert_star_invoice_success",
      {
        p_star_order_id: input.starOrderId,
        p_payload: input.payload,
        p_invoice_link: input.invoiceLink,
        p_open_mode: input.openMode,
        p_expires_at: input.expiresAt,
        p_raw_request: input.rawRequest,
        p_raw_response: input.rawResponse,
      },
      createPaymentRpcOptions(input, {
        rpcPurpose: "record_invoice_success",
        starOrderId: input.starOrderId,
      }),
    );
  } catch (error) {
    throw new TelegramStarsInvoiceError(
      500,
      "STAR_INVOICE_WRITE_FAILED",
      "保存 Stars invoice 失败。",
      {
        expose: false,
        cause: error,
      },
    );
  }

  return normalizeStarInvoiceRow(result);
}

async function recordInvoiceFailure(input: {
  starOrderId: string;
  drawOrderId: string;
  payload: string;
  openMode: TelegramInvoiceOpenMode;
  expiresAt: string | null;
  rawRequest: Record<string, unknown>;
  rawResponse: Record<string, unknown>;
  errorMessage: string;
  client?: SupabaseAdminClient | undefined;
  requestId?: string | undefined;
}): Promise<void> {
  try {
    await callRpcRaw<Record<string, unknown>>(
      "payment_record_star_invoice_failure",
      {
        p_star_order_id: input.starOrderId,
        p_draw_order_id: input.drawOrderId,
        p_payload: input.payload,
        p_open_mode: input.openMode,
        p_expires_at: input.expiresAt,
        p_raw_request: input.rawRequest,
        p_raw_response: input.rawResponse,
        p_error_message: truncateErrorMessage(input.errorMessage),
      },
      createPaymentRpcOptions(input, {
        rpcPurpose: "record_invoice_failure",
        starOrderId: input.starOrderId,
        drawOrderId: input.drawOrderId,
      }),
    );
  } catch (error) {
    throw new TelegramStarsInvoiceError(
      500,
      "STAR_INVOICE_FAILURE_RECORD_FAILED",
      "保存 Stars invoice 失败状态失败。",
      {
        expose: false,
        cause: error,
      },
    );
  }
}

async function markOrderInvoiceCreated(input: {
  starOrderId: string;
  drawOrderId: string;
  invoicePayload: string;
  client?: SupabaseAdminClient | undefined;
  requestId?: string | undefined;
}): Promise<void> {
  try {
    await callRpcRaw<Record<string, unknown>>(
      "payment_mark_order_invoice_created",
      {
        p_star_order_id: input.starOrderId,
        p_draw_order_id: input.drawOrderId,
        p_invoice_payload: input.invoicePayload,
      },
      createPaymentRpcOptions(input, {
        rpcPurpose: "mark_order_invoice_created",
        starOrderId: input.starOrderId,
        drawOrderId: input.drawOrderId,
      }),
    );
  } catch (error) {
    throw new TelegramStarsInvoiceError(
      500,
      "STAR_ORDER_STATUS_UPDATE_FAILED",
      "更新 Stars 支付订单状态失败。",
      {
        expose: false,
        cause: error,
      },
    );
  }
}

function createPaymentRpcOptions(
  input: {
    client?: SupabaseAdminClient | undefined;
    requestId?: string | undefined;
  },
  context: Record<string, unknown> = {},
) {
  return {
    schema: "api" as never,
    ...(input.client ? { client: input.client } : {}),
    context: {
      ...(input.requestId ? { requestId: input.requestId } : {}),
      ...context,
    },
  };
}

async function markTelegramPreCheckoutChecked(input: {
  updateId: number;
  preCheckoutQuery: TelegramPreCheckoutQuery;
  rawUpdate: unknown;
  requestId: string;
  requestHeadersHash: string | null;
  webhookSecretVerified: boolean;
  client?: SupabaseAdminClient | undefined;
}): Promise<PaymentMarkPrecheckoutResult> {
  const rpcOptions = {
    schema: "api" as never,
    context: {
      requestId: input.requestId,
      updateId: input.updateId,
      preCheckoutQueryId: input.preCheckoutQuery.id,
    },
    ...(input.client ? { client: input.client } : {}),
  };
  const rawResult = await callRpcRaw<Record<string, unknown>>(
    "payment_mark_precheckout_checked",
    {
      p_update_id: input.updateId,
      p_pre_checkout_query_id: input.preCheckoutQuery.id,
      p_invoice_payload: input.preCheckoutQuery.invoicePayload,
      p_currency: input.preCheckoutQuery.currency,
      p_total_amount: input.preCheckoutQuery.totalAmount,
      p_telegram_user_id: input.preCheckoutQuery.fromId,
      p_raw_update: isJsonCompatibleRecord(input.rawUpdate)
        ? input.rawUpdate
        : {},
      p_request_headers_hash: input.requestHeadersHash,
      p_request_id: input.requestId,
      p_webhook_secret_verified: input.webhookSecretVerified,
    },
    rpcOptions,
  );

  return normalizePaymentMarkPrecheckoutResult(rawResult);
}

async function recordTelegramSuccessfulPayment(input: {
  updateId: number;
  successfulPayment: TelegramSuccessfulPayment;
  rawUpdate: unknown;
  requestId: string;
  requestHeadersHash: string | null;
  webhookSecretVerified: boolean;
  client?: SupabaseAdminClient | undefined;
}): Promise<PaymentRecordSuccessfulPaymentResult> {
  const rpcOptions = {
    schema: "api" as never,
    context: {
      requestId: input.requestId,
      updateId: input.updateId,
      telegramPaymentChargeId: input.successfulPayment.telegramPaymentChargeId,
    },
    ...(input.client ? { client: input.client } : {}),
  };
  const rawResult = await callRpcRaw<Record<string, unknown>>(
    "payment_record_successful_payment",
    {
      p_update_id: input.updateId,
      p_invoice_payload: input.successfulPayment.invoicePayload,
      p_currency: input.successfulPayment.currency,
      p_total_amount: input.successfulPayment.totalAmount,
      p_telegram_payment_charge_id:
        input.successfulPayment.telegramPaymentChargeId,
      p_provider_payment_charge_id:
        input.successfulPayment.providerPaymentChargeId,
      p_telegram_user_id: input.successfulPayment.fromId,
      p_raw_update: isJsonCompatibleRecord(input.rawUpdate)
        ? input.rawUpdate
        : {},
      p_request_headers_hash: input.requestHeadersHash,
      p_request_id: input.requestId,
      p_webhook_secret_verified: input.webhookSecretVerified,
    },
    rpcOptions,
  );

  return normalizePaymentRecordSuccessfulPaymentResult(rawResult);
}

function shouldFulfillRecordedPayment(
  recordResult: PaymentRecordSuccessfulPaymentResult,
): boolean {
  return (
    recordResult.reasonCode === null &&
    recordResult.starOrderId !== null &&
    recordResult.telegramPaymentChargeId !== null &&
    (recordResult.paymentRecorded ||
      recordResult.duplicateUpdate ||
      recordResult.duplicateCharge)
  );
}

async function fulfillTelegramSuccessfulPayment(input: {
  recordResult: PaymentRecordSuccessfulPaymentResult;
  successfulPayment: TelegramSuccessfulPayment;
  rawUpdate: unknown;
  requestId: string;
  client?: SupabaseAdminClient | undefined;
}): Promise<PaymentFulfillmentResult> {
  if (!input.recordResult.starOrderId) {
    throw new TelegramStarsWebhookError(
      500,
      "FULFILLMENT_STAR_ORDER_ID_MISSING",
      "支付发货缺少 Stars 订单 ID。",
      { expose: false },
    );
  }

  const rpcOptions = {
    schema: "api" as never,
    context: {
      requestId: input.requestId,
      starOrderId: input.recordResult.starOrderId,
      telegramPaymentChargeId: input.successfulPayment.telegramPaymentChargeId,
    },
    ...(input.client ? { client: input.client } : {}),
  };
  const rawResult = await callRpcRaw<Record<string, unknown>>(
    "gacha_process_paid_order",
    {
      p_star_order_id: input.recordResult.starOrderId,
      p_telegram_payment_charge_id:
        input.successfulPayment.telegramPaymentChargeId,
      p_provider_payment_charge_id:
        input.successfulPayment.providerPaymentChargeId,
      p_raw_update: isJsonCompatibleRecord(input.rawUpdate)
        ? input.rawUpdate
        : {},
    },
    rpcOptions,
  );

  return normalizePaymentFulfillmentResult(rawResult);
}

async function answerPreCheckoutQuery(input: {
  preCheckoutQueryId: string;
  ok: boolean;
  errorMessage?: string | null | undefined;
  fetchImpl?: FetchImpl | undefined;
  env?: NodeJS.ProcessEnv | undefined;
}): Promise<boolean> {
  const config = readTelegramWebhookConfig(input.env);
  const request = buildAnswerPreCheckoutQueryRequest({
    preCheckoutQueryId: input.preCheckoutQueryId,
    ok: input.ok,
    errorMessage: input.errorMessage,
  });
  const payload = await postAnswerPreCheckoutQuery({
    botToken: config.botToken,
    request,
    fetchImpl: input.fetchImpl,
  });

  return parseAnswerPreCheckoutQueryResponse(payload);
}

async function markWebhookEventAnswerFailed(input: {
  eventId: string | null;
  requestId: string;
  error: unknown;
  client?: SupabaseAdminClient | undefined;
}): Promise<void> {
  if (!input.eventId) {
    return;
  }

  const errorMessage = truncateErrorMessage(
    getWebhookPublicErrorMessage(input.error),
  );

  try {
    await callRpcRaw<Record<string, unknown> | null>(
      "payment_mark_webhook_event_failed",
      {
        p_event_id: input.eventId,
        p_error_message: errorMessage,
        p_processed_at: new Date().toISOString(),
      },
      createPaymentRpcOptions(input, {
        rpcPurpose: "mark_pre_checkout_event_failed",
        eventId: input.eventId,
      }),
    );
  } catch (error) {
    console.error(
      `[${input.requestId}] TELEGRAM_PRE_CHECKOUT_EVENT_MARK_FAILED: ${getPublicErrorMessage(error)}`,
      {
        eventId: input.eventId,
      },
    );
  }
}

async function markWebhookEventFulfillmentFailed(input: {
  eventId: string | null;
  requestId: string;
  error: unknown;
  client?: SupabaseAdminClient | undefined;
}): Promise<void> {
  if (!input.eventId) {
    return;
  }

  const errorMessage = truncateErrorMessage(
    getWebhookFulfillmentErrorMessage(input.error),
  );

  try {
    await callRpcRaw<Record<string, unknown> | null>(
      "payment_mark_webhook_event_failed",
      {
        p_event_id: input.eventId,
        p_error_message: errorMessage,
        p_processed_at: new Date().toISOString(),
      },
      createPaymentRpcOptions(input, {
        rpcPurpose: "mark_fulfillment_event_failed",
        eventId: input.eventId,
      }),
    );
  } catch (error) {
    console.error(
      `[${input.requestId}] TELEGRAM_FULFILLMENT_EVENT_MARK_FAILED: ${getPublicErrorMessage(error)}`,
      {
        eventId: input.eventId,
      },
    );
  }
}

async function postCreateInvoiceLink(input: {
  botToken: string;
  request: TelegramCreateInvoiceLinkRequest;
  fetchImpl?: FetchImpl | undefined;
}): Promise<Record<string, unknown>> {
  const fetchImpl = input.fetchImpl ?? globalThis.fetch;

  if (typeof fetchImpl !== "function") {
    throw new TelegramStarsInvoiceError(
      500,
      "TELEGRAM_FETCH_UNAVAILABLE",
      "当前运行环境不支持 fetch。",
      { expose: false },
    );
  }

  let response: Response;

  try {
    response = await fetchImpl(
      `${TELEGRAM_BOT_API_BASE_URL}/bot${input.botToken}/${CREATE_INVOICE_LINK_METHOD}`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(input.request),
      },
    );
  } catch (error) {
    throw new TelegramStarsInvoiceError(
      502,
      "TELEGRAM_INVOICE_NETWORK_FAILED",
      "连接 Telegram Bot API 失败。",
      {
        expose: true,
        cause: error,
      },
    );
  }

  const payload = await readTelegramResponseJson(response);

  if (!response.ok) {
    throw new TelegramStarsInvoiceError(
      502,
      "TELEGRAM_INVOICE_CREATE_FAILED",
      getTelegramApiErrorDescription(payload),
      {
        expose: true,
        details: {
          httpStatus: response.status,
        },
      },
    );
  }

  return payload;
}

async function postAnswerPreCheckoutQuery(input: {
  botToken: string;
  request: TelegramAnswerPreCheckoutQueryRequest;
  fetchImpl?: FetchImpl | undefined;
}): Promise<Record<string, unknown>> {
  const fetchImpl = input.fetchImpl ?? globalThis.fetch;

  if (typeof fetchImpl !== "function") {
    throw new TelegramStarsWebhookError(
      500,
      "TELEGRAM_FETCH_UNAVAILABLE",
      "当前运行环境不支持 fetch。",
      { expose: false },
    );
  }

  let response: Response;

  try {
    response = await fetchImpl(
      `${TELEGRAM_BOT_API_BASE_URL}/bot${input.botToken}/${ANSWER_PRE_CHECKOUT_QUERY_METHOD}`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(input.request),
      },
    );
  } catch (error) {
    throw new TelegramStarsWebhookError(
      502,
      "TELEGRAM_PRE_CHECKOUT_NETWORK_FAILED",
      "连接 Telegram Bot API 失败。",
      {
        expose: true,
        cause: error,
      },
    );
  }

  const payload = await readTelegramWebhookResponseJson(response);

  if (!response.ok) {
    throw new TelegramStarsWebhookError(
      502,
      "TELEGRAM_PRE_CHECKOUT_ANSWER_FAILED",
      getTelegramApiErrorDescription(payload),
      {
        expose: true,
        details: {
          httpStatus: response.status,
        },
      },
    );
  }

  return payload;
}

async function readTelegramResponseJson(
  response: Response,
): Promise<Record<string, unknown>> {
  try {
    const payload = (await response.json()) as unknown;

    return isRecord(payload) ? payload : { ok: false, result: payload };
  } catch (error) {
    throw new TelegramStarsInvoiceError(
      502,
      "TELEGRAM_INVOICE_RESPONSE_INVALID",
      "Telegram invoice 响应不是合法 JSON。",
      {
        expose: true,
        cause: error,
      },
    );
  }
}

async function readTelegramWebhookResponseJson(
  response: Response,
): Promise<Record<string, unknown>> {
  try {
    const payload = (await response.json()) as unknown;

    return isRecord(payload) ? payload : { ok: false, result: payload };
  } catch (error) {
    throw new TelegramStarsWebhookError(
      502,
      "TELEGRAM_PRE_CHECKOUT_RESPONSE_INVALID",
      "Telegram pre_checkout 响应不是合法 JSON。",
      {
        expose: true,
        cause: error,
      },
    );
  }
}

function assertStarOrderMatchesInput(
  row: StarOrderRow,
  input: CreateTelegramStarsInvoiceInput,
): void {
  if (row.user_id !== input.userId) {
    throw new TelegramStarsInvoiceError(
      403,
      "STAR_ORDER_USER_MISMATCH",
      "Stars 支付订单不属于当前用户。",
    );
  }

  if (row.business_type !== "gacha_open") {
    throw new TelegramStarsInvoiceError(
      409,
      "STAR_ORDER_BUSINESS_TYPE_INVALID",
      "Stars 支付订单业务类型无效。",
    );
  }

  if (row.business_id !== input.drawOrderId) {
    throw new TelegramStarsInvoiceError(
      409,
      "STAR_ORDER_BUSINESS_ID_MISMATCH",
      "Stars 支付订单与开盒订单不匹配。",
    );
  }

  if (row.telegram_invoice_payload !== input.invoicePayload) {
    throw new TelegramStarsInvoiceError(
      409,
      "STAR_ORDER_PAYLOAD_MISMATCH",
      "Stars 支付订单 payload 不匹配。",
    );
  }

  if (
    normalizeXtrAmount(row.xtr_amount) !== normalizeXtrAmount(input.xtrAmount)
  ) {
    throw new TelegramStarsInvoiceError(
      409,
      "STAR_ORDER_AMOUNT_MISMATCH",
      "Stars 支付订单金额不匹配。",
    );
  }

  if (!INVOICE_CREATABLE_STAR_ORDER_STATUSES.has(row.status)) {
    throw new TelegramStarsInvoiceError(
      409,
      "STAR_ORDER_STATUS_NOT_PAYABLE",
      "Stars 支付订单当前状态不可创建 invoice。",
    );
  }
}

function normalizeInvoicePaymentOrderStatus(status: string): string {
  return status === "precheckout_checked" || status === "precheckout_ok"
    ? "precheckout_checked"
    : "created";
}

function readTelegramStarsInvoiceConfig(env = process.env): {
  botToken: string;
  providerToken: string;
} {
  const botToken = normalizeEnvText(env.TELEGRAM_BOT_TOKEN);
  const currency = normalizeEnvText(env.TELEGRAM_STARS_CURRENCY) ?? "XTR";

  if (!botToken) {
    throw new TelegramStarsInvoiceError(
      503,
      "TELEGRAM_INVOICE_CONFIG_INVALID",
      "支付服务暂不可用。",
      {
        expose: false,
        details: {
          missing: ["TELEGRAM_BOT_TOKEN"],
        },
      },
    );
  }

  if (currency !== "XTR") {
    throw new TelegramStarsInvoiceError(
      503,
      "TELEGRAM_INVOICE_CONFIG_INVALID",
      "支付服务暂不可用。",
      {
        expose: false,
        details: {
          field: "TELEGRAM_STARS_CURRENCY",
        },
      },
    );
  }

  return {
    botToken,
    providerToken: normalizeEnvText(env.TELEGRAM_STARS_PROVIDER_TOKEN) ?? "",
  };
}

function readTelegramWebhookConfig(env = process.env): {
  botToken: string;
} {
  const botToken = normalizeEnvText(env.TELEGRAM_BOT_TOKEN);

  if (!botToken) {
    throw new TelegramStarsWebhookError(
      503,
      "TELEGRAM_WEBHOOK_CONFIG_INVALID",
      "支付服务暂不可用。",
      {
        expose: false,
        details: {
          missing: ["TELEGRAM_BOT_TOKEN"],
        },
      },
    );
  }

  return {
    botToken,
  };
}

function normalizePaymentMarkPrecheckoutResult(
  value: Record<string, unknown>,
): PaymentMarkPrecheckoutResult {
  const eventId = requiredWebhookString(
    value.event_id,
    "payment_mark_precheckout_checked.event_id",
  );
  const allowed = requiredBoolean(
    value.allowed,
    "payment_mark_precheckout_checked.allowed",
  );

  return {
    allowed,
    idempotent: booleanOrFalse(value.idempotent),
    eventId,
    starOrderId: optionalString(value.star_order_id),
    drawOrderId: optionalString(value.draw_order_id),
    invoicePayload: optionalString(value.invoice_payload),
    reasonCode: optionalString(value.reason_code),
    errorMessage: optionalString(value.error_message),
    paymentOrderStatus: optionalString(value.payment_order_status),
  };
}

function normalizePaymentRecordSuccessfulPaymentResult(
  value: Record<string, unknown>,
): PaymentRecordSuccessfulPaymentResult {
  const eventId = requiredWebhookString(
    value.event_id,
    "payment_record_successful_payment.event_id",
  );
  const paymentRecorded = requiredBoolean(
    value.payment_recorded,
    "payment_record_successful_payment.payment_recorded",
  );

  return {
    paymentRecorded,
    idempotent: booleanOrFalse(value.idempotent),
    duplicateUpdate: booleanOrFalse(value.duplicate_update),
    duplicateCharge: booleanOrFalse(value.duplicate_charge),
    eventId,
    starOrderId: optionalString(value.star_order_id),
    starPaymentId: optionalString(value.star_payment_id),
    drawOrderId: optionalString(value.draw_order_id),
    invoicePayload: optionalString(value.invoice_payload),
    telegramPaymentChargeId: optionalString(value.telegram_payment_charge_id),
    reasonCode: optionalString(value.reason_code),
    errorMessage: optionalString(value.error_message),
    paymentOrderStatus: optionalString(value.payment_order_status),
    processStatus: optionalString(value.process_status),
    paidAt: optionalString(value.paid_at),
  };
}

function normalizeTelegramWebhookReceivedResult(
  value: Record<string, unknown>,
): TelegramWebhookReceivedResult {
  const processStatus = requiredWebhookProcessStatus(
    value.process_status,
    "payment_record_telegram_webhook_received.process_status",
  );

  return {
    eventId: requiredWebhookString(
      value.event_id,
      "payment_record_telegram_webhook_received.event_id",
    ),
    updateId: optionalNumber(value.update_id),
    eventType: requiredWebhookString(
      value.event_type,
      "payment_record_telegram_webhook_received.event_type",
    ),
    processStatus,
    telegramUserId: optionalNumber(value.telegram_user_id),
    invoicePayload: optionalString(value.invoice_payload),
    webhookSecretVerified: booleanOrFalse(value.webhook_secret_verified),
    duplicateUpdate: booleanOrFalse(value.duplicate_update),
    eventTypeConflict: booleanOrFalse(value.event_type_conflict),
    retryCount: optionalNumber(value.retry_count) ?? 0,
    reasonCode: optionalString(value.reason_code),
    errorMessage: optionalString(value.error_message),
  };
}

function normalizePaymentFulfillmentResult(
  value: Record<string, unknown>,
): PaymentFulfillmentResult {
  const fulfilled = requiredBoolean(
    value.fulfilled,
    "gacha_process_paid_order.fulfilled",
  );

  return {
    fulfilled,
    idempotent: booleanOrFalse(value.idempotent),
    status: optionalString(value.status),
    starOrderId: optionalString(value.star_order_id),
    drawOrderId: optionalString(value.draw_order_id),
    drawCount: optionalNumber(value.draw_count),
    quantity: optionalNumber(value.quantity),
    resultCount: optionalNumber(value.result_count),
    reasonCode: optionalString(value.reason_code),
    errorMessage: optionalString(value.error_message),
    paymentOrderStatus: optionalString(value.payment_order_status),
    retryable: value.retryable !== false,
  };
}

function normalizeStarOrderRow(value: Record<string, unknown>): StarOrderRow {
  return {
    id: requiredString(value.id, "star_orders.id"),
    user_id: requiredString(value.user_id, "star_orders.user_id"),
    business_type: requiredString(
      value.business_type,
      "star_orders.business_type",
    ),
    business_id: optionalString(value.business_id),
    status: requiredString(value.status, "star_orders.status"),
    xtr_amount: requiredNumber(value.xtr_amount, "star_orders.xtr_amount"),
    telegram_invoice_payload: requiredString(
      value.telegram_invoice_payload,
      "star_orders.telegram_invoice_payload",
    ),
    title: requiredString(value.title, "star_orders.title"),
    description: optionalString(value.description),
    expires_at: optionalString(value.expires_at),
  };
}

function normalizeStarInvoiceRow(
  value: Record<string, unknown>,
): StarInvoiceRow {
  return {
    star_order_id: requiredString(
      value.star_order_id,
      "star_invoices.star_order_id",
    ),
    invoice_link: optionalString(value.invoice_link),
    payload: requiredString(value.payload, "star_invoices.payload"),
    status: requiredString(value.status, "star_invoices.status"),
    open_mode: requiredString(value.open_mode, "star_invoices.open_mode"),
    bot_api_method: optionalString(value.bot_api_method),
    expires_at: optionalString(value.expires_at),
  };
}

function normalizeXtrAmount(value: unknown): number {
  const amount =
    typeof value === "number"
      ? value
      : typeof value === "string" && value.trim() !== ""
        ? Number(value)
        : Number.NaN;

  if (!Number.isInteger(amount) || amount <= 0) {
    throw new TelegramStarsInvoiceError(
      500,
      "TELEGRAM_INVOICE_AMOUNT_INVALID",
      "Stars invoice 金额无效。",
      { expose: false },
    );
  }

  return amount;
}

function normalizeInvoicePayload(value: string): string {
  const payload = value.trim();

  if (
    !payload ||
    Buffer.byteLength(payload, "utf8") > MAX_TELEGRAM_PAYLOAD_BYTES
  ) {
    throw new TelegramStarsInvoiceError(
      500,
      "TELEGRAM_INVOICE_PAYLOAD_INVALID",
      "Stars invoice payload 无效。",
      { expose: false },
    );
  }

  return payload;
}

function normalizeTelegramText(
  value: string | null | undefined,
  fallback: string,
  maxChars: number,
): string {
  const normalized = value?.trim() || fallback;
  const chars = Array.from(normalized);

  return chars.slice(0, maxChars).join("");
}

function normalizeOpenMode(value: string): TelegramInvoiceOpenMode {
  if (
    value === "telegram_link" ||
    value === "web_app_open_invoice" ||
    value === "bot_api" ||
    value === "unknown"
  ) {
    return value;
  }

  return "unknown";
}

function sanitizeInvoiceRequest(
  request: TelegramCreateInvoiceLinkRequest,
): Record<string, unknown> {
  return {
    title: request.title,
    description: request.description,
    payload: request.payload,
    provider_token_configured: request.provider_token.trim().length > 0,
    currency: request.currency,
    prices: request.prices,
  };
}

function getInvoiceFailureResponse(error: unknown): Record<string, unknown> {
  if (error instanceof TelegramStarsInvoiceError) {
    return {
      ok: false,
      code: error.code,
      message: error.message,
      details: error.details ?? null,
    };
  }

  return {
    ok: false,
    message: getPublicErrorMessage(error),
  };
}

function getTelegramApiErrorDescription(
  payload: TelegramBotApiPayload,
): string {
  if (typeof payload.description === "string" && payload.description.trim()) {
    return payload.description.trim();
  }

  return "Telegram Stars invoice 创建失败，请稍后重试。";
}

function getPublicErrorMessage(error: unknown): string {
  if (error instanceof Error && error.message.trim()) {
    return error.message.trim();
  }

  return "Telegram Stars invoice 创建失败。";
}

function getWebhookPublicErrorMessage(error: unknown): string {
  if (error instanceof Error && error.message.trim()) {
    return error.message.trim();
  }

  return "Telegram pre_checkout 确认失败。";
}

function getWebhookFulfillmentErrorMessage(error: unknown): string {
  if (error instanceof Error && error.message.trim()) {
    return error.message.trim();
  }

  return "支付成功后发货失败。";
}

function truncateErrorMessage(value: string): string {
  return Array.from(value.trim()).slice(0, 500).join("");
}

function requiredWebhookString(value: unknown, field: string): string {
  const normalized = optionalString(value);

  if (!normalized) {
    throw new TelegramStarsWebhookError(
      400,
      "TELEGRAM_WEBHOOK_FIELD_INVALID",
      `${field} 缺失。`,
    );
  }

  return normalized;
}

function requiredWebhookInteger(value: unknown, field: string): number {
  const parsed =
    typeof value === "number"
      ? value
      : typeof value === "string" && value.trim() !== ""
        ? Number(value)
        : Number.NaN;

  if (!Number.isInteger(parsed)) {
    throw new TelegramStarsWebhookError(
      400,
      "TELEGRAM_WEBHOOK_FIELD_INVALID",
      `${field} 无效。`,
    );
  }

  return parsed;
}

function requiredString(value: unknown, field: string): string {
  const normalized = optionalString(value);

  if (!normalized) {
    throw new TelegramStarsInvoiceError(
      500,
      "STAR_INVOICE_ROW_INVALID",
      `${field} 缺失。`,
      { expose: false },
    );
  }

  return normalized;
}

function requiredBoolean(value: unknown, field: string): boolean {
  if (typeof value !== "boolean") {
    throw new TelegramStarsWebhookError(
      500,
      "TELEGRAM_PRE_CHECKOUT_RPC_RESULT_INVALID",
      `${field} 无效。`,
      { expose: false },
    );
  }

  return value;
}

function booleanOrFalse(value: unknown): boolean {
  return value === true;
}

function requiredWebhookProcessStatus(
  value: unknown,
  field: string,
): TelegramWebhookProcessStatus {
  const normalized = optionalString(value);

  if (
    normalized === "received" ||
    normalized === "processing" ||
    normalized === "processed" ||
    normalized === "ignored" ||
    normalized === "failed"
  ) {
    return normalized;
  }

  throw new TelegramStarsWebhookError(
    500,
    "TELEGRAM_WEBHOOK_RPC_RESULT_INVALID",
    `${field} 无效。`,
    { expose: false },
  );
}

function optionalString(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }

  const normalized = value.trim();

  return normalized.length > 0 ? normalized : null;
}

function optionalNumber(value: unknown): number | null {
  const parsed =
    typeof value === "number"
      ? value
      : typeof value === "string" && value.trim() !== ""
        ? Number(value)
        : Number.NaN;

  return Number.isFinite(parsed) ? parsed : null;
}

function optionalWebhookInteger(value: unknown): number | null {
  const parsed =
    typeof value === "number"
      ? value
      : typeof value === "string" && value.trim() !== ""
        ? Number(value)
        : Number.NaN;

  return Number.isInteger(parsed) ? parsed : null;
}

function requiredNumber(value: unknown, field: string): number {
  const amount =
    typeof value === "number"
      ? value
      : typeof value === "string" && value.trim() !== ""
        ? Number(value)
        : Number.NaN;

  if (!Number.isFinite(amount)) {
    throw new TelegramStarsInvoiceError(
      500,
      "STAR_INVOICE_ROW_INVALID",
      `${field} 无效。`,
      { expose: false },
    );
  }

  return amount;
}

function normalizeEnvText(value: string | undefined): string | null {
  if (typeof value !== "string") {
    return null;
  }

  const normalized = value.trim();

  return normalized.length > 0 ? normalized : null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isJsonCompatibleRecord(
  value: unknown,
): value is Record<string, unknown> {
  return isRecord(value);
}

function extractTelegramWebhookAuditFields(update: unknown): {
  updateId: number | null;
  telegramUserId: number | null;
  invoicePayload: string | null;
} {
  if (!isRecord(update)) {
    return {
      updateId: null,
      telegramUserId: null,
      invoicePayload: null,
    };
  }

  const preCheckoutQuery = isRecord(update.pre_checkout_query)
    ? update.pre_checkout_query
    : null;

  if (preCheckoutQuery) {
    const from = isRecord(preCheckoutQuery.from) ? preCheckoutQuery.from : null;

    return {
      updateId: optionalWebhookInteger(update.update_id),
      telegramUserId: from ? optionalWebhookInteger(from.id) : null,
      invoicePayload: optionalString(preCheckoutQuery.invoice_payload),
    };
  }

  const message = isRecord(update.message) ? update.message : null;
  const successfulPayment =
    message && isRecord(message.successful_payment)
      ? message.successful_payment
      : null;

  if (message) {
    const from = isRecord(message.from) ? message.from : null;

    return {
      updateId: optionalWebhookInteger(update.update_id),
      telegramUserId: from ? optionalWebhookInteger(from.id) : null,
      invoicePayload: successfulPayment
        ? optionalString(successfulPayment.invoice_payload)
        : null,
    };
  }

  const callbackQuery = isRecord(update.callback_query)
    ? update.callback_query
    : null;
  const callbackFrom =
    callbackQuery && isRecord(callbackQuery.from) ? callbackQuery.from : null;

  return {
    updateId: optionalWebhookInteger(update.update_id),
    telegramUserId: callbackFrom
      ? optionalWebhookInteger(callbackFrom.id)
      : null,
    invoicePayload: null,
  };
}

function normalizeWebhookDateTime(
  value: string | Date | null | undefined,
): string | null {
  if (value === null || value === undefined) {
    return null;
  }

  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? null : value.toISOString();
  }

  return optionalString(value);
}

function toWebhookJsonPayload(value: unknown): unknown {
  return value ?? {};
}
