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

export const monsterTamerHandlers = {
  "monster_tamer.bootstrap": async (context) => ({
    data: await rpc("monster_tamer_bootstrap", {
      p_session_id: requireSession(context).session_id,
    }),
  }),
  "monster_tamer.checkpoint": async (context) =>
    operationResult(
      await rpc<OperationEnvelope>("monster_tamer_checkpoint", {
        p_session_id: requireSession(context).session_id,
        p_operation_id: requireOperationId(context),
        p_expected_progress_version: context.input.expected_progress_version,
        p_command: context.input.command,
        p_revealed_cell_ids: context.input.revealed_cell_ids,
        p_traversed_cell_ids: context.input.traversed_cell_ids,
      }),
    ),
  "monster_tamer.battle": async (context) =>
    operationResult(
      await rpc<OperationEnvelope>("monster_tamer_battle", {
        p_session_id: requireSession(context).session_id,
        p_operation_id: requireOperationId(context),
        p_command: context.input,
      }),
    ),
} satisfies HandlerMap;
