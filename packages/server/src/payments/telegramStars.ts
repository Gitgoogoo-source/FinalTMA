import {
  getSupabaseAdminClient,
  type SupabaseAdminClient,
} from "../db/supabaseAdmin.js";

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

type FetchImpl = (input: string | URL, init?: RequestInit) => Promise<Response>;

type DbError = {
  message?: string | undefined;
  code?: string | undefined;
  details?: string | undefined;
};

type DbResponse<T> = {
  data: T | null;
  error: DbError | null;
};

type DbMutationResponse = {
  error: DbError | null;
};

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

type MaybeSingleQuery<T> = {
  maybeSingle(): PromiseLike<DbResponse<T>>;
};

type SingleQuery<T> = {
  single(): PromiseLike<DbResponse<T>>;
};

type SelectQuery<T> = {
  eq(column: string, value: string): MaybeSingleQuery<T>;
};

type UpdateQuery = {
  eq(column: string, value: string): PromiseLike<DbMutationResponse>;
};

type UpsertQuery<T> = {
  select(columns: string): SingleQuery<T>;
};

type TableClient = {
  select(columns: string): SelectQuery<Record<string, unknown>>;
  update(values: Record<string, unknown>): UpdateQuery;
  upsert(
    values: Record<string, unknown>,
    options?: { onConflict?: string | undefined },
  ): UpsertQuery<Record<string, unknown>>;
};

type SchemaClient = {
  schema(schema: string): {
    from(table: string): TableClient;
  };
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

const TELEGRAM_BOT_API_BASE_URL = "https://api.telegram.org";
const CREATE_INVOICE_LINK_METHOD = "createInvoiceLink";
const DEFAULT_OPEN_MODE: TelegramInvoiceOpenMode = "web_app_open_invoice";
const MAX_TELEGRAM_TITLE_CHARS = 32;
const MAX_TELEGRAM_DESCRIPTION_CHARS = 255;
const MAX_TELEGRAM_PAYLOAD_BYTES = 128;

export async function createTelegramStarsInvoice(
  input: CreateTelegramStarsInvoiceInput,
): Promise<TelegramStarsInvoiceResult> {
  const db = getSchemaClient(input.client);
  const starOrder = await fetchStarOrder(db, input.starOrderId);

  assertStarOrderMatchesInput(starOrder, input);

  const existingInvoice = await fetchExistingInvoice(db, input.invoicePayload);
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
    await markOrderInvoiceCreated(db, {
      starOrderId: input.starOrderId,
      drawOrderId: input.drawOrderId,
      invoicePayload: input.invoicePayload,
    });

    return {
      starOrderId: input.starOrderId,
      payload: existingInvoice.payload,
      invoiceLink: existingInvoice.invoice_link,
      openMode: normalizeOpenMode(existingInvoice.open_mode),
      botApiMethod: "createInvoiceLink",
      expiresAt: existingInvoice.expires_at ?? starOrder.expires_at,
      invoiceStatus: existingInvoice.status,
      paymentOrderStatus: "invoice_created",
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
    await recordInvoiceFailure(db, {
      starOrderId: input.starOrderId,
      drawOrderId: input.drawOrderId,
      payload: input.invoicePayload,
      openMode,
      expiresAt: starOrder.expires_at,
      rawRequest: sanitizedRequest,
      rawResponse: getInvoiceFailureResponse(error),
      errorMessage: getPublicErrorMessage(error),
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

  const invoice = await recordInvoiceSuccess(db, {
    starOrderId: input.starOrderId,
    payload: input.invoicePayload,
    invoiceLink,
    openMode,
    expiresAt: starOrder.expires_at,
    rawRequest: sanitizedRequest,
    rawResponse,
  });

  await markOrderInvoiceCreated(db, {
    starOrderId: input.starOrderId,
    drawOrderId: input.drawOrderId,
    invoicePayload: input.invoicePayload,
  });

  return {
    starOrderId: input.starOrderId,
    payload: invoice.payload,
    invoiceLink: invoice.invoice_link,
    openMode: normalizeOpenMode(invoice.open_mode),
    botApiMethod: "createInvoiceLink",
    expiresAt: invoice.expires_at ?? starOrder.expires_at,
    invoiceStatus: invoice.status,
    paymentOrderStatus: "invoice_created",
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

function getSchemaClient(
  client: SupabaseAdminClient | undefined,
): SchemaClient {
  return (client ?? getSupabaseAdminClient()) as unknown as SchemaClient;
}

async function fetchStarOrder(
  db: SchemaClient,
  starOrderId: string,
): Promise<StarOrderRow> {
  const response = await db
    .schema("payments")
    .from("star_orders")
    .select(
      [
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
      ].join(","),
    )
    .eq("id", starOrderId)
    .maybeSingle();

  if (response.error) {
    throw new TelegramStarsInvoiceError(
      500,
      "STAR_ORDER_READ_FAILED",
      "读取 Stars 支付订单失败。",
      {
        expose: false,
        cause: response.error,
      },
    );
  }

  if (!response.data) {
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

  return normalizeStarOrderRow(response.data);
}

async function fetchExistingInvoice(
  db: SchemaClient,
  payload: string,
): Promise<StarInvoiceRow | null> {
  const response = await db
    .schema("payments")
    .from("star_invoices")
    .select(
      [
        "star_order_id",
        "invoice_link",
        "payload",
        "status",
        "open_mode",
        "bot_api_method",
        "expires_at",
      ].join(","),
    )
    .eq("payload", payload)
    .maybeSingle();

  if (response.error) {
    throw new TelegramStarsInvoiceError(
      500,
      "STAR_INVOICE_READ_FAILED",
      "读取 Stars invoice 失败。",
      {
        expose: false,
        cause: response.error,
      },
    );
  }

  return response.data ? normalizeStarInvoiceRow(response.data) : null;
}

async function recordInvoiceSuccess(
  db: SchemaClient,
  input: {
    starOrderId: string;
    payload: string;
    invoiceLink: string;
    openMode: TelegramInvoiceOpenMode;
    expiresAt: string | null;
    rawRequest: Record<string, unknown>;
    rawResponse: Record<string, unknown>;
  },
): Promise<StarInvoiceRow> {
  const response = await db
    .schema("payments")
    .from("star_invoices")
    .upsert(
      {
        star_order_id: input.starOrderId,
        invoice_link: input.invoiceLink,
        payload: input.payload,
        status: "created",
        open_mode: input.openMode,
        bot_api_method: CREATE_INVOICE_LINK_METHOD,
        expires_at: input.expiresAt,
        raw_request: input.rawRequest,
        raw_response: input.rawResponse,
      },
      {
        onConflict: "payload",
      },
    )
    .select(
      [
        "star_order_id",
        "invoice_link",
        "payload",
        "status",
        "open_mode",
        "bot_api_method",
        "expires_at",
      ].join(","),
    )
    .single();

  if (response.error || !response.data) {
    throw new TelegramStarsInvoiceError(
      500,
      "STAR_INVOICE_WRITE_FAILED",
      "保存 Stars invoice 失败。",
      {
        expose: false,
        cause: response.error,
      },
    );
  }

  return normalizeStarInvoiceRow(response.data);
}

async function recordInvoiceFailure(
  db: SchemaClient,
  input: {
    starOrderId: string;
    drawOrderId: string;
    payload: string;
    openMode: TelegramInvoiceOpenMode;
    expiresAt: string | null;
    rawRequest: Record<string, unknown>;
    rawResponse: Record<string, unknown>;
    errorMessage: string;
  },
): Promise<void> {
  const [invoiceResult, starOrderResult, drawOrderResult] = await Promise.all([
    db
      .schema("payments")
      .from("star_invoices")
      .upsert(
        {
          star_order_id: input.starOrderId,
          invoice_link: null,
          payload: input.payload,
          status: "failed",
          open_mode: input.openMode,
          bot_api_method: CREATE_INVOICE_LINK_METHOD,
          expires_at: input.expiresAt,
          raw_request: input.rawRequest,
          raw_response: input.rawResponse,
        },
        {
          onConflict: "payload",
        },
      )
      .select(
        "star_order_id,payload,status,open_mode,bot_api_method,expires_at",
      )
      .single(),
    db
      .schema("payments")
      .from("star_orders")
      .update({
        status: "failed",
        error_message: truncateErrorMessage(input.errorMessage),
      })
      .eq("id", input.starOrderId),
    db
      .schema("gacha")
      .from("draw_orders")
      .update({
        status: "failed",
        payment_status: "failed",
        telegram_invoice_payload: input.payload,
        error_message: truncateErrorMessage(input.errorMessage),
      })
      .eq("id", input.drawOrderId),
  ]);

  const error =
    invoiceResult.error ?? starOrderResult.error ?? drawOrderResult.error;

  if (error) {
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

async function markOrderInvoiceCreated(
  db: SchemaClient,
  input: {
    starOrderId: string;
    drawOrderId: string;
    invoicePayload: string;
  },
): Promise<void> {
  const [starOrderResult, drawOrderResult] = await Promise.all([
    db
      .schema("payments")
      .from("star_orders")
      .update({
        status: "invoice_created",
        error_message: null,
      })
      .eq("id", input.starOrderId),
    db
      .schema("gacha")
      .from("draw_orders")
      .update({
        status: "invoice_created",
        payment_status: "pending",
        telegram_invoice_payload: input.invoicePayload,
        error_message: null,
      })
      .eq("id", input.drawOrderId),
  ]);

  const error = starOrderResult.error ?? drawOrderResult.error;

  if (error) {
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

function truncateErrorMessage(value: string): string {
  return Array.from(value.trim()).slice(0, 500).join("");
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

function optionalString(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }

  const normalized = value.trim();

  return normalized.length > 0 ? normalized : null;
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
