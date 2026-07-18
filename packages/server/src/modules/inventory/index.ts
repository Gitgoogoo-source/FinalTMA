import { rpc } from "../../platform/db/index.ts";
import { operationResult, type OperationEnvelope } from "../operations/mapper.ts";
import { requireOperationId, requireSession, type HandlerMap } from "../types.ts";

export const inventoryHandlers = {
  "inventory.list": async (context) => ({ data: await rpc("inventory_list", { p_session_id: requireSession(context).session_id }) }),
  "inventory.detail": async (context) => ({ data: await rpc("inventory_detail", { p_session_id: requireSession(context).session_id, p_template_id: context.input.template_id }) }),
  "inventory.evolve": async (context) => operationResult(await rpc<OperationEnvelope>("inventory_evolve", { p_session_id: requireSession(context).session_id, p_operation_id: requireOperationId(context), p_template_id: context.input.template_id })),
  "inventory.decompose": async (context) => operationResult(await rpc<OperationEnvelope>("inventory_decompose", { p_session_id: requireSession(context).session_id, p_operation_id: requireOperationId(context), p_template_id: context.input.template_id, p_quantity: context.input.quantity })),
} satisfies HandlerMap;
