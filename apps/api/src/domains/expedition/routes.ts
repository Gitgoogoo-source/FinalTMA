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

export const expeditionHandlers = {
  "expedition.list": async (context) => ({
    data: await rpc("expedition_list", {
      p_session_id: requireSession(context).session_id,
    }),
  }),
  "expedition.eligible_items": async (context) => ({
    data: await rpc("expedition_eligible_items", {
      p_session_id: requireSession(context).session_id,
      p_tier: context.input.tier,
    }),
  }),
  "expedition.create": async (context) =>
    operationResult(
      await rpc<OperationEnvelope>("expedition_create", {
        p_session_id: requireSession(context).session_id,
        p_operation_id: requireOperationId(context),
        p_tier: context.input.tier,
        p_items: context.input.items,
      }),
    ),
  "expedition.claim": async (context) =>
    operationResult(
      await rpc<OperationEnvelope>("expedition_claim", {
        p_session_id: requireSession(context).session_id,
        p_operation_id: requireOperationId(context),
        p_expedition_id: context.input.expedition_id,
      }),
    ),
} satisfies HandlerMap;
