import { rpc } from "../../platform/db/index.ts";
import { operationResult, type OperationEnvelope } from "../operations/mapper.ts";
import { createOrder } from "../topup/index.ts";
import { requireOperationId, requireSession, type HandlerMap } from "../types.ts";

export const vipHandlers = {
  "vip.get": async (context) => ({ data: await rpc("vip_get", { p_session_id: requireSession(context).session_id }) }),
  "vip.create_order": async (context) => createOrder(context, "vip_create_order"),
  "vip.claim_fgems": async (context) => operationResult(await rpc<OperationEnvelope>("vip_claim", { p_session_id: requireSession(context).session_id, p_operation_id: requireOperationId(context), p_benefit: "fgems" })),
  "vip.claim_free_box": async (context) => operationResult(await rpc<OperationEnvelope>("vip_claim", { p_session_id: requireSession(context).session_id, p_operation_id: requireOperationId(context), p_benefit: "free_rare_box" })),
} satisfies HandlerMap;
