import { createHash, timingSafeEqual } from "node:crypto";

import {
  hasTelegramPreCheckoutQuery,
  inferTelegramUpdateEventType,
  processTelegramPreCheckoutUpdate,
} from "../../packages/server/src/payments/telegramStars.js";
import {
  ApiError,
  getHeaderValue,
  withApiHandler,
} from "../_shared/handler.js";
import { parseJsonBody } from "../_shared/parseBody.js";

export default withApiHandler(
  async (req, _res, ctx) => {
    assertTelegramWebhookSecret(req.headers);

    const update = await parseJsonBody<unknown>(req, {
      maxBytes: 256 * 1024,
    });
    const eventType = inferTelegramUpdateEventType(update);

    if (!hasTelegramPreCheckoutQuery(update)) {
      return {
        handled: false,
        event_type: eventType,
      };
    }

    const result = await processTelegramPreCheckoutUpdate({
      update,
      requestId: ctx.requestId,
      requestHeadersHash: hashWebhookHeaders(req.headers),
      webhookSecretVerified: true,
    });

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

function assertTelegramWebhookSecret(headers: HeaderRecord): void {
  const expectedSecret = readTelegramWebhookSecret();
  const receivedSecret =
    getHeaderValue(headers["x-telegram-bot-api-secret-token"]) ??
    getHeaderValue(headers["x-telegram-webhook-secret"]);

  if (!receivedSecret || !safeEqual(receivedSecret, expectedSecret)) {
    throw new ApiError(
      403,
      "TELEGRAM_WEBHOOK_SECRET_INVALID",
      "Telegram webhook secret 无效。",
    );
  }
}

function readTelegramWebhookSecret(): string {
  const secret =
    process.env.TELEGRAM_WEBHOOK_SECRET ??
    process.env.TELEGRAM_WEBHOOK_SECRET_TOKEN;
  const normalized = secret?.trim();

  if (!normalized) {
    throw new ApiError(
      500,
      "TELEGRAM_WEBHOOK_CONFIG_INVALID",
      "Telegram webhook secret 未配置。",
      {
        expose: false,
      },
    );
  }

  return normalized;
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
