import { rpc } from "../../platform/db/index.ts";
import { requireSession, type HandlerMap } from "../../http/handlers.ts";

export const inventoryHandlers = {
  "inventory.list": async (context) => ({
    data: await rpc("inventory_list", {
      p_session_id: requireSession(context).session_id,
    }),
  }),
  "inventory.detail": async (context) => ({
    data: await rpc("inventory_detail", {
      p_session_id: requireSession(context).session_id,
      p_template_id: context.input.template_id,
    }),
  }),
} satisfies HandlerMap;
