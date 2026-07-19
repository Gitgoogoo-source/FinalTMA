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

export const albumHandlers = {
  "album.get": async (context) => ({
    data: await rpc("album_get", {
      p_session_id: requireSession(context).session_id,
    }),
  }),
  "album.claim": async (context) =>
    operationResult(
      await rpc<OperationEnvelope>("album_claim", {
        p_session_id: requireSession(context).session_id,
        p_operation_id: requireOperationId(context),
        p_chain_id: context.input.chain_id,
      }),
    ),
} satisfies HandlerMap;
