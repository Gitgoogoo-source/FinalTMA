import { rpc } from "../../platform/db/index.ts";
import {
  operationResult,
  type OperationEnvelope,
} from "../operations/mappers.ts";
import {
  requireOperationId,
  requireSession,
  type HandlerMap,
} from "../types.ts";

export const wheelHandlers = {
  "wheel.get": async (context) => ({
    data: await rpc("wheel_get", {
      p_session_id: requireSession(context).session_id,
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
