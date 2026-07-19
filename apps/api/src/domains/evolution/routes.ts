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

export const evolutionHandlers = {
  "inventory.evolve": async (context) =>
    operationResult(
      await rpc<OperationEnvelope>("inventory_evolve", {
        p_session_id: requireSession(context).session_id,
        p_operation_id: requireOperationId(context),
        p_template_id: context.input.template_id,
      }),
    ),
} satisfies HandlerMap;
