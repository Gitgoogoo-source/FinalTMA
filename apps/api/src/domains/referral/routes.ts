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

export const referralHandlers = {
  "referral.get": async (context) => ({
    data: await rpc("referral_get", {
      p_session_id: requireSession(context).session_id,
    }),
  }),
  "referral.bind": async (context) =>
    operationResult(
      await rpc<OperationEnvelope>("referral_bind", {
        p_session_id: requireSession(context).session_id,
        p_operation_id: requireOperationId(context),
        p_code: context.input.code,
      }),
    ),
  "referral.share_event": async (context) =>
    operationResult(
      await rpc<OperationEnvelope>("referral_share_event", {
        p_session_id: requireSession(context).session_id,
        p_operation_id: requireOperationId(context),
        p_event: context.input.event,
      }),
    ),
} satisfies HandlerMap;
