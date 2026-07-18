import { ApiError } from "../../http/errors.ts";
import type { HandlerResult } from "../types.ts";

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
    throw new ApiError(
      409,
      operation.error_code ?? "OPERATION_FAILED",
      messageFor(operation.error_code),
      false,
      undefined,
      operation.operation_id,
    );
  }
  if (operation.result === null || operation.result === undefined) {
    throw new ApiError(500, "OPERATION_RESULT_INVALID", "操作结果无效", true, undefined, operation.operation_id);
  }
  return {
    data: operation.result,
    operationId: operation.operation_id,
    status: operation.status === "pending" || operation.status === "unknown" ? 202 : 200,
  };
}

function messageFor(code: string | null): string {
  const messages: Record<string, string> = {
    INSUFFICIENT_BALANCE: "余额不足",
    INSUFFICIENT_INVENTORY: "可用藏品不足",
    IDEMPOTENCY_KEY_REUSED: "幂等键已用于不同请求",
    PAYMENT_ALREADY_PENDING: "已有待处理支付订单",
    TOPUP_NOT_REQUIRED: "当前余额无需补差",
    ACCOUNT_RESTRICTED: "账号不可用",
  };
  return (code && messages[code]) || "操作未完成";
}
