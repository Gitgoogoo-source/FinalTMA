import { errorDefinition, isErrorCode } from "@pokepets/api-contracts/common";

import { ApiError } from "./errors.ts";
import type { HandlerResult } from "./handlers.ts";

export type OperationEnvelope = {
  operation_id: string;
  use_case: string;
  status: "pending" | "succeeded" | "failed" | "unknown";
  result: unknown;
  error_code: string | null;
  created_at: string;
  updated_at: string;
};

export function operationResult(operation: OperationEnvelope): HandlerResult {
  if (operation.status === "failed") {
    const code =
      operation.error_code && isErrorCode(operation.error_code)
        ? operation.error_code
        : "OPERATION_FAILED";
    const definition = errorDefinition(code);
    throw new ApiError(
      definition.status,
      code,
      definition.message,
      definition.retryable,
      undefined,
      operation.operation_id,
    );
  }
  if (operation.result === null || operation.result === undefined)
    throw new ApiError(
      500,
      "OPERATION_RESULT_INVALID",
      "操作结果无效",
      true,
      undefined,
      operation.operation_id,
    );
  return {
    data: operation.result,
    operationId: operation.operation_id,
    status:
      operation.status === "pending" || operation.status === "unknown"
        ? 202
        : 200,
  };
}
