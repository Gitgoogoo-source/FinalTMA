import { rpc } from "../../platform/db/index.ts";
import { requireSession, type HandlerMap } from "../types.ts";

export const operationHandlers = {
  "operations.get": async (context) => ({
    data: await rpc("operations_get", {
      p_session_id: requireSession(context).session_id,
      p_operation_id: context.input.operation_id,
    }),
  }),
} satisfies HandlerMap;
