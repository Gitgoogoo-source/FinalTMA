import { rpc } from "../../platform/db/index.ts";
import { operationResult, type OperationEnvelope } from "../operations/mapper.ts";
import { requireOperationId, requireSession, type HandlerMap } from "../types.ts";

export const marketHandlers = {
  "market.bootstrap": async (context) => ({ data: await rpc("market_bootstrap", { p_session_id: requireSession(context).session_id }) }),
  "market.template": async (context) => ({ data: await rpc("market_template", { p_session_id: requireSession(context).session_id, p_template_id: context.input.template_id }) }),
  "market.my_listings": async (context) => ({ data: await rpc("market_my_listings", { p_session_id: requireSession(context).session_id }) }),
  "market.create_listing": async (context) => operationResult(await rpc<OperationEnvelope>("market_create_listing", { p_session_id: requireSession(context).session_id, p_operation_id: requireOperationId(context), p_template_id: context.input.template_id, p_quantity: context.input.quantity })),
  "market.cancel_listing": async (context) => operationResult(await rpc<OperationEnvelope>("market_cancel_listing", { p_session_id: requireSession(context).session_id, p_operation_id: requireOperationId(context), p_listing_id: context.input.listing_id })),
  "market.purchase": async (context) => operationResult(await rpc<OperationEnvelope>("market_purchase", { p_session_id: requireSession(context).session_id, p_operation_id: requireOperationId(context), p_template_id: context.input.template_id, p_quantity: context.input.quantity })),
} satisfies HandlerMap;
