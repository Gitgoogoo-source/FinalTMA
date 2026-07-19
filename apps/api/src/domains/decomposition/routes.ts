import {
  requireOperationId,
  requireSession,
  type HandlerMap,
} from "../../http/handlers.ts";
import {
  operationResult,
  type OperationEnvelope,
} from "../../http/operation-result.ts";
import { rpc } from "../../platform/db/index.ts";

export const decompositionHandlers = {
  "inventory.decompose": async (context) =>
    operationResult(
      await rpc<OperationEnvelope>("inventory_decompose", {
        p_session_id: requireSession(context).session_id,
        p_operation_id: requireOperationId(context),
        p_template_id: context.input.template_id,
        p_quantity: context.input.quantity,
      }),
    ),
} satisfies HandlerMap;
