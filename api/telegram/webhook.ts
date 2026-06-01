import { createHash, timingSafeEqual } from "node:crypto";

import {
  hasTelegramPreCheckoutQuery,
  hasTelegramSuccessfulPayment,
  inferTelegramUpdateEventType,
  processTelegramPreCheckoutUpdate,
  processTelegramSuccessfulPaymentUpdate,
  recordTelegramWebhookReceived,
} from "../../packages/server/src/payments/telegramStars.js";
import {
  ApiError,
  getHeaderValue,
  withApiHandler,
} from "../_shared/handler.js";
import { reportPaymentWebhookError } from "../_shared/observability.js";
import { parseJsonBody } from "../_shared/parseBody.js";

export default withApiHandler(
  async (req, _res, ctx) => {
    const update = await parseJsonBody<unknown>(req, {
      maxBytes: 256 * 1024,
    });
    const eventType = inferTelegramUpdateEventType(update);
    const requestHeadersHash = hashWebhookHeaders(req.headers);
    const secretVerification = verifyTelegramWebhookSecret(req.headers);

    const receivedEvent = await recordTelegramWebhookReceived({
      update,
      eventType,
      requestId: ctx.requestId,
      requestHeadersHash,
      webhookSecretVerified: secretVerification.verified,
      processStatus: "received",
      statusContext: {
        handler: "api.telegram.webhook",
      },
      incrementRetryCount: true,
    });

    if (!secretVerification.verified) {
      const failedEvent = await recordTelegramWebhookReceived({
        update,
        eventType,
        requestId: ctx.requestId,
        requestHeadersHash,
        webhookSecretVerified: false,
        processStatus: "failed",
        errorMessage: secretVerification.error.message,
        statusContext: {
          handler: "api.telegram.webhook",
          error_reason: secretVerification.error.code,
        },
        nextRetryAt: null,
        incrementRetryCount: false,
      });

      await reportPaymentWebhookError(secretVerification.error, {
        requestId: ctx.requestId,
        sourceId: failedEvent.eventId,
      });

      throw new ApiError(
        secretVerification.error.statusCode,
        secretVerification.error.code,
        secretVerification.error.message,
        {
          expose: secretVerification.error.expose,
          details: {
            event_id: failedEvent.eventId,
          },
        },
      );
    }

    if (!hasTelegramPreCheckoutQuery(update)) {
      if (hasTelegramSuccessfulPayment(update)) {
        let result: Awaited<
          ReturnType<typeof processTelegramSuccessfulPaymentUpdate>
        >;

        try {
          result = await processTelegramSuccessfulPaymentUpdate({
            update,
            requestId: ctx.requestId,
            requestHeadersHash,
            webhookSecretVerified: true,
          });
        } catch (error) {
          const failedEvent = await markReceivedWebhookFailed({
            update,
            eventType,
            requestId: ctx.requestId,
            requestHeadersHash,
            error,
          });
          await reportPaymentWebhookError(error, {
            requestId: ctx.requestId,
            sourceId: failedEvent.eventId,
          });

          throw error;
        }

        return {
          handled: true,
          event_type: result.eventType,
          payment_recorded: result.paymentRecorded,
          idempotent: result.idempotent,
          duplicate_update: result.duplicateUpdate,
          duplicate_charge: result.duplicateCharge,
          event_id: result.eventId,
          star_order_id: result.starOrderId,
          star_payment_id: result.starPaymentId,
          draw_order_id: result.drawOrderId,
          reason_code: result.reasonCode,
          payment_order_status: result.paymentOrderStatus,
          process_status: result.processStatus,
          fulfillment_attempted: result.fulfillmentAttempted,
          fulfillment_status: result.fulfillment?.status ?? null,
          fulfillment_idempotent: result.fulfillment?.idempotent ?? false,
          fulfillment_reason_code: result.fulfillment?.reasonCode ?? null,
          fulfillment_retryable: result.fulfillment?.retryable ?? null,
        };
      }

      const ignoredEvent = await recordTelegramWebhookReceived({
        update,
        eventType,
        requestId: ctx.requestId,
        requestHeadersHash,
        webhookSecretVerified: true,
        processStatus: "ignored",
        statusContext: {
          handler: "api.telegram.webhook",
          reason_code: "UNSUPPORTED_TELEGRAM_UPDATE",
        },
        incrementRetryCount: false,
      });

      return {
        handled: false,
        event_type: eventType,
        event_id: ignoredEvent.eventId,
        received_event_id: receivedEvent.eventId,
        process_status: ignoredEvent.processStatus,
      };
    }

    let result: Awaited<ReturnType<typeof processTelegramPreCheckoutUpdate>>;

    try {
      result = await processTelegramPreCheckoutUpdate({
        update,
        requestId: ctx.requestId,
        requestHeadersHash,
        webhookSecretVerified: true,
      });
    } catch (error) {
      const failedEvent = await markReceivedWebhookFailed({
        update,
        eventType,
        requestId: ctx.requestId,
        requestHeadersHash,
        error,
      });
      await reportPaymentWebhookError(error, {
        requestId: ctx.requestId,
        sourceId: failedEvent.eventId,
      });

      throw error;
    }

    return {
      handled: true,
      event_type: result.eventType,
      allowed: result.allowed,
      answered: result.answered,
      idempotent: result.idempotent,
      event_id: result.eventId,
      star_order_id: result.starOrderId,
      draw_order_id: result.drawOrderId,
      reason_code: result.reasonCode,
      payment_order_status: result.paymentOrderStatus,
    };
  },
  {
    methods: ["POST"],
    rateLimit: {
      action: "telegram.webhook",
    },
  },
);

type HeaderRecord = Record<string, string | string[] | undefined>;

type TelegramWebhookSecretVerification =
  | {
      verified: true;
    }
  | {
      verified: false;
      error: ApiError;
    };

type MarkReceivedWebhookFailedInput = {
  update: unknown;
  eventType: string;
  requestId: string;
  requestHeadersHash: string;
  error: unknown;
};

async function markReceivedWebhookFailed(
  input: MarkReceivedWebhookFailedInput,
): Promise<{ eventId: string | undefined }> {
  const failedEvent = await recordTelegramWebhookReceived({
    update: input.update,
    eventType: input.eventType,
    requestId: input.requestId,
    requestHeadersHash: input.requestHeadersHash,
    webhookSecretVerified: true,
    processStatus: "failed",
    errorMessage: getErrorMessage(input.error),
    statusContext: {
      handler: "api.telegram.webhook",
      error_reason: getErrorCode(input.error),
    },
    nextRetryAt: null,
    incrementRetryCount: false,
  });

  return {
    eventId:
      typeof failedEvent.eventId === "string" ? failedEvent.eventId : undefined,
  };
}

function verifyTelegramWebhookSecret(
  headers: HeaderRecord,
): TelegramWebhookSecretVerification {
  const expectedSecret = readTelegramWebhookSecret();

  if (!expectedSecret) {
    return {
      verified: false,
      error: new ApiError(
        500,
        "TELEGRAM_WEBHOOK_CONFIG_INVALID",
        "Telegram webhook secret 未配置。",
        {
          expose: false,
        },
      ),
    };
  }

  const receivedSecret =
    getHeaderValue(headers["x-telegram-bot-api-secret-token"]) ??
    getHeaderValue(headers["x-telegram-webhook-secret"]);

  if (!receivedSecret || !safeEqual(receivedSecret, expectedSecret)) {
    return {
      verified: false,
      error: new ApiError(
        403,
        "TELEGRAM_WEBHOOK_SECRET_INVALID",
        "Telegram webhook secret 无效。",
      ),
    };
  }

  return {
    verified: true,
  };
}

function readTelegramWebhookSecret(): string | null {
  const secret =
    process.env.TELEGRAM_WEBHOOK_SECRET ??
    process.env.TELEGRAM_WEBHOOK_SECRET_TOKEN;
  const normalized = secret?.trim();

  if (!normalized) {
    return null;
  }

  return normalized;
}

function getErrorCode(error: unknown): string {
  if (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    typeof error.code === "string" &&
    error.code.trim()
  ) {
    return error.code.trim();
  }

  return "TELEGRAM_WEBHOOK_PROCESSING_FAILED";
}

function getErrorMessage(error: unknown): string {
  if (error instanceof Error && error.message.trim()) {
    return error.message.trim();
  }

  return "Telegram webhook 处理失败。";
}

function safeEqual(left: string, right: string): boolean {
  const leftHash = createHash("sha256").update(left).digest();
  const rightHash = createHash("sha256").update(right).digest();

  return timingSafeEqual(leftHash, rightHash);
}

function hashWebhookHeaders(headers: HeaderRecord): string {
  const material = JSON.stringify({
    content_type: getHeaderValue(headers["content-type"]) ?? null,
    user_agent: getHeaderValue(headers["user-agent"]) ?? null,
    telegram_secret_header_present:
      getHeaderValue(headers["x-telegram-bot-api-secret-token"]) !== undefined,
  });

  return createHash("sha256").update(material).digest("hex");
}
