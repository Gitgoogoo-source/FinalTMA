import { requireSession, type HandlerMap } from "../../http/handlers.ts";
import { rpc } from "../../platform/db/index.ts";
import { getRecoveredOperation } from "./get-operation.ts";

export const operationRecoveryHandlers = {
  "operations.recoverable": async (context) => ({
    data: await rpc("operations_recoverable", {
      p_session_id: requireSession(context).session_id,
    }),
  }),
  "operations.get": async (context) => ({
    data: await getRecoveredOperation(
      requireSession(context).session_id,
      context.input.operation_id,
    ),
  }),
} satisfies HandlerMap;
