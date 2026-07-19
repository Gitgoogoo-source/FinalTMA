import {
  parseRecoveredOperation,
  type TypedOperationSummary,
} from "@pokepets/api-contracts/app";

import { rpc } from "../../platform/db/index.ts";

export async function getRecoveredOperation(
  sessionId: string,
  operationId: unknown,
): Promise<TypedOperationSummary> {
  const value = await rpc("operations_get", {
    p_session_id: sessionId,
    p_operation_id: operationId,
  });
  return parseRecoveredOperation(value);
}
