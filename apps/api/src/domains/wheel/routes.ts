import { rpc } from "../../platform/db/index.ts";
import {
  operationResult,
  type OperationEnvelope,
} from "../../http/operation-result.ts";
import {
  requireOperationId,
  requireSession,
  type HandlerMap,
} from "../../http/handlers.ts";

export const wheelHandlers = {
  "wheel.get": async (context) => ({
    data: await rpc("wheel_get", {
      p_session_id: requireSession(context).session_id,
    }),
  }),
  "wheel.recovery": async (context) => ({
    data: await rpc("wheel_recoverable_results", {
      p_session_id: requireSession(context).session_id,
    }),
  }),
  "wheel.acknowledge_result": async (context) => ({
    data: await rpc("wheel_acknowledge_result", {
      p_session_id: requireSession(context).session_id,
      p_operation_id: context.input.operation_id,
    }),
  }),
  "wheel.spin": async (context) =>
    operationResult(
      await rpc<OperationEnvelope>("wheel_spin", {
        p_session_id: requireSession(context).session_id,
        p_operation_id: requireOperationId(context),
        p_count: context.input.count,
      }),
    ),
} satisfies HandlerMap;
