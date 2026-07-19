import { getRecoveredOperation } from "../../workflows/operation-recovery/get-operation.ts";
import { requireSession, type HandlerMap } from "../types.ts";

export const operationHandlers = {
  "operations.get": async (context) => ({
    data: await getRecoveredOperation(
      requireSession(context).session_id,
      context.input.operation_id,
    ),
  }),
} satisfies HandlerMap;
