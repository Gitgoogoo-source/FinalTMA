import type { HandlerMap } from "../../http/handlers.ts";
import { deliverBattleOutbox } from "./ably.ts";

export const battleOutboxIntegrationHandlers = {
  "battle.outbox_integration": async (context) => ({
    data: await deliverBattleOutbox(context.request.signal),
  }),
} satisfies HandlerMap;
