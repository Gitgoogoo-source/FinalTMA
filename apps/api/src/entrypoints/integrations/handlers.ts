import type { RouteId } from "@pokepets/api-contracts/integrations";

import type { RouteHandler } from "../../http/handlers.ts";
import { telegramWebhookHandlers } from "../../workflows/stars-payment/telegram-webhook.ts";

export const integrationHandlers = {
  ...telegramWebhookHandlers,
} satisfies Record<RouteId, RouteHandler>;
