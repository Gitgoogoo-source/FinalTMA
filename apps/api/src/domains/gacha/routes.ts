import {
  hasUnavailableGachaPresentation,
  parseRouteOutput,
  type RouteOutput,
  withGachaPresentationValidationUrls,
} from "@evomypet/api-contracts/app";

import { rpc } from "../../platform/db/index.ts";
import { ApiError } from "../../http/errors.ts";
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
  "gacha.open": async (context) => {
    const operation = await rpc<OperationEnvelope>("gacha_open", {
      p_session_id: requireSession(context).session_id,
      p_operation_id: requireOperationId(context),
      p_tier: context.input.tier,
      p_draw_count: context.input.draw_count,
    });
    if (
      operation.status === "succeeded" &&
      hasUnavailableGachaPresentation(operation.result)
    ) {
      parseRouteOutput(
        "gacha.open",
        withGachaPresentationValidationUrls(operation.result),
      ) satisfies RouteOutput<"gacha.open">;
      throw new ApiError(
        503,
        "CATALOG_UNAVAILABLE",
        "图鉴数据暂时不可用",
        true,
        { presentation_status: "unavailable" },
        operation.operation_id,
      );
    }
    return operationResult(operation);
  },
} satisfies HandlerMap;
