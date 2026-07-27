import type { RouteId } from "@pokepets/api-contracts/integrations";

import type { RouteHandler } from "../../http/handlers.ts";
import { battleOutboxIntegrationHandlers } from "../../workflows/battle-outbox/routes.ts";
import { battleShareIntegrationHandlers } from "../../workflows/battle-share/routes.ts";
import { telegramWebhookHandlers } from "../../workflows/stars-payment/telegram-webhook.ts";

export const integrationHandlers = {
  ...telegramWebhookHandlers,
  ...battleShareIntegrationHandlers,
  ...battleOutboxIntegrationHandlers,
} satisfies Record<RouteId, RouteHandler>;
