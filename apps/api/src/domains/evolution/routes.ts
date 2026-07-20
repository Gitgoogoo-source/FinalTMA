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
  "inventory.evolution_preview": async (context) => ({
    data: await rpc("inventory_evolution_preview", {
      p_session_id: requireSession(context).session_id,
      p_template_id: context.input.template_id,
    }),
  }),
  "inventory.evolution_recovery": async (context) => ({
    data: await rpc("inventory_evolution_recoverable_results", {
      p_session_id: requireSession(context).session_id,
    }),
  }),
  "inventory.acknowledge_evolution_result": async (context) => ({
    data: await rpc("inventory_evolution_acknowledge_result", {
      p_session_id: requireSession(context).session_id,
      p_operation_id: context.input.operation_id,
    }),
  }),
  "inventory.evolve": async (context) =>
    operationResult(
      await rpc<OperationEnvelope>("inventory_evolve", {
        p_session_id: requireSession(context).session_id,
        p_operation_id: requireOperationId(context),
        p_template_id: context.input.template_id,
      }),
    ),
} satisfies HandlerMap;
