import type { HandlerMap } from "../../http/handlers.ts";
import { deliverBattleOutbox } from "./ably.ts";

export const battleOutboxIntegrationHandlers = {
  "battle.outbox_integration": async (context) => {
    const delivery = await deliverBattleOutbox(
      context.request.signal,
      10,
      context.telemetry,
    );
    context.telemetry?.recordOutbox(delivery);
    return { data: delivery };
  },
} satisfies HandlerMap;
