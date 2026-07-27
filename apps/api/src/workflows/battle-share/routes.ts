import type { HandlerMap } from "../../http/handlers.ts";
import { deliverPreparedBattleShares } from "./process.ts";

export const battleShareIntegrationHandlers = {
  "battle.share_integration": async (context) => ({
    data: await deliverPreparedBattleShares(context.request.signal),
  }),
} satisfies HandlerMap;
