import { recordRiskEventSafely } from "./riskEvents.js";

type MintRetryRiskInput = {
  userId: string;
  mintQueueId: string;
  itemInstanceId?: string | null;
  walletId?: string | null;
  requestId: string;
  action: string;
  status: "manual_review";
  attemptCount: number;
  maxAttempts: number;
  errorCode: string;
  errorMessage: string;
  retryable: boolean;
  txHash?: string | null;
  provider?: string | null;
  possibleSubmission?: boolean | null;
  forceNoSubmit?: boolean | null;
};

export async function recordMintRetryExceededRisk(
  input: MintRetryRiskInput,
): Promise<void> {
  await recordRiskEventSafely({
    userId: input.userId,
    eventType: "mint_retry_exceeded",
    sourceType: "mint_queue",
    sourceId: input.mintQueueId,
    detail: {
      request_id: input.requestId,
      action: input.action,
      status: input.status,
      mint_queue_id: input.mintQueueId,
      item_instance_id: input.itemInstanceId ?? null,
      wallet_id: input.walletId ?? null,
      attempt_count: input.attemptCount,
      max_attempts: input.maxAttempts,
      error_code: input.errorCode,
      error_message: input.errorMessage,
      retryable: input.retryable,
      tx_hash: input.txHash ?? null,
      provider: input.provider ?? null,
      possible_submission: input.possibleSubmission ?? null,
      force_no_submit: input.forceNoSubmit ?? null,
    },
    idempotencyKey: [
      "risk",
      "mint_retry_exceeded",
      input.mintQueueId,
      input.action,
      String(input.attemptCount),
      input.errorCode,
    ].join(":"),
    context: {
      requestId: input.requestId,
      userId: input.userId,
      mintQueueId: input.mintQueueId,
    },
  });
}
