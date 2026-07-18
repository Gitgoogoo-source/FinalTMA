import { rpc } from "../../platform/db/index.ts";
import { operationResult, type OperationEnvelope } from "../operations/mapper.ts";
import { requireOperationId, requireSession, type HandlerMap } from "../types.ts";

export const taskHandlers = {
  "tasks.get": async (context) => ({ data: await rpc("tasks_get", { p_session_id: requireSession(context).session_id }) }),
  "tasks.check_in": async (context) => operationResult(await rpc<OperationEnvelope>("tasks_check_in", { p_session_id: requireSession(context).session_id, p_operation_id: requireOperationId(context) })),
  "tasks.claim": async (context) => operationResult(await rpc<OperationEnvelope>("tasks_claim", { p_session_id: requireSession(context).session_id, p_operation_id: requireOperationId(context), p_task_code: context.input.task_code })),
} satisfies HandlerMap;
