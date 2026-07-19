import { requireSession, type HandlerMap } from "../../http/handlers.ts";
import { getRecoveredOperation } from "./get-operation.ts";

export const operationRecoveryHandlers = {
  "operations.get": async (context) => ({
    data: await getRecoveredOperation(
      requireSession(context).session_id,
      context.input.operation_id,
    ),
  }),
} satisfies HandlerMap;
