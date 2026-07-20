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

export const gachaHandlers = {
  "gacha.bootstrap": async (context) => ({
    data: await rpc("gacha_bootstrap", {
      p_session_id: requireSession(context).session_id,
    }),
  }),
  "gacha.recovery": async (context) => ({
    data: await rpc("gacha_recoverable_results", {
      p_session_id: requireSession(context).session_id,
    }),
  }),
  "gacha.acknowledge_result": async (context) => ({
    data: await rpc("gacha_acknowledge_result", {
      p_session_id: requireSession(context).session_id,
      p_operation_id: context.input.operation_id,
    }),
  }),
  "gacha.pool": async (context) => ({
    data: await rpc("gacha_pool", {
      p_session_id: requireSession(context).session_id,
      p_tier: context.input.tier,
    }),
  }),
  "gacha.open": async (context) =>
    operationResult(
      await rpc<OperationEnvelope>("gacha_open", {
        p_session_id: requireSession(context).session_id,
        p_operation_id: requireOperationId(context),
        p_tier: context.input.tier,
        p_draw_count: context.input.draw_count,
      }),
    ),
} satisfies HandlerMap;
