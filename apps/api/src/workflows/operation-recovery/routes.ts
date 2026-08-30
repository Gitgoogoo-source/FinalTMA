import { parseRouteOutput } from "@evomypet/api-contracts/app";

import { requireSession, type HandlerMap } from "../../http/handlers.ts";
import { rpc } from "../../platform/db/index.ts";
import { getRecoveredOperation } from "./get-operation.ts";
import { assertEvolutionRecoveryCeiling } from "./invariants.ts";

export const operationRecoveryHandlers = {
  "operations.recoverable": async (context) => {
    const data = parseRouteOutput(
      "operations.recoverable",
      await rpc<unknown>("operations_recoverable", {
        p_session_id: requireSession(context).session_id,
        p_after_authority_cursor: context.input.after_authority_cursor,
      }),
    );
    assertEvolutionRecoveryCeiling(data.operations);
    return { data };
  },
  "operations.get": async (context) => ({
    data: await getRecoveredOperation(
      requireSession(context).session_id,
      context.input.operation_id,
    ),
  }),
} satisfies HandlerMap;
