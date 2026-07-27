import {
  errorDefinition,
  isErrorCode,
  operationSummarySchema,
} from "@pokepets/api-contracts/common";

import { ApiError } from "./errors.ts";
import type { HandlerResult } from "./handlers.ts";

export type OperationEnvelope = {
  operation_id: string;
  use_case: string;
  status: "pending" | "succeeded" | "failed" | "unknown";
  result: unknown;
  error_code: string | null;
  acknowledged_at: string | null;
  created_at: string;
  updated_at: string;
};

export function operationResult(
  operation: OperationEnvelope,
  expected?: { operationId: string; useCase: string },
): HandlerResult {
  const parsed = operationSummarySchema.safeParse(operation);
  if (!parsed.success)
    throw new ApiError(500, "OPERATION_RESULT_INVALID", "操作结果无效", true);
  const envelope = parsed.data;
  if (
    expected &&
    (envelope.operation_id !== expected.operationId ||
      envelope.use_case !== expected.useCase)
  )
    throw new ApiError(500, "OPERATION_RESULT_INVALID", "操作结果无效", true);
  if (envelope.status === "failed") {
    const code =
      envelope.error_code && isErrorCode(envelope.error_code)
        ? envelope.error_code
        : "OPERATION_FAILED";
    const definition = errorDefinition(code);
    throw new ApiError(
      definition.status,
      code,
      definition.message,
      definition.retryable,
      undefined,
      envelope.operation_id,
    );
  }
  if (envelope.result === null || envelope.result === undefined)
    throw new ApiError(
      500,
      "OPERATION_RESULT_INVALID",
      "操作结果无效",
      true,
      undefined,
      envelope.operation_id,
    );
  return {
    data: envelope.result,
    operationId: envelope.operation_id,
    status:
      envelope.status === "pending" || envelope.status === "unknown"
        ? 202
        : 200,
  };
}
