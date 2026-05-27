import { describe, expect, it } from "vitest";

import {
  buildBackendStatusContext,
  buildPaymentWebhookStatusUpdate,
  inferPaymentOrderStatusFromDrawOrderStatus,
  isTerminalPaymentOrderStatus,
  normalizePaymentOrderStatus,
} from "../../packages/server/src/payments/paymentEvents";
import {
  buildMintWorkerStatusMetadata,
  isActiveMintQueueStatus,
  isTerminalMintQueueStatus,
  normalizeMintQueueStatus,
  normalizeOnchainTransactionStatus,
} from "../../packages/server/src/ton/mintQueue";
import {
  MintQueueStatusSchema,
  OnchainTransactionStatusSchema,
  paymentOrderStatusSchema,
  paymentWebhookProcessStatusSchema,
} from "../../packages/validation/src/index";

describe("Phase 5 backend status contracts", () => {
  it("normalizes payment statuses to the Phase 5 state machine", () => {
    expect(normalizePaymentOrderStatus("precheckout_ok")).toBe(
      "precheckout_checked",
    );
    expect(normalizePaymentOrderStatus("pending_payment")).toBe(
      "invoice_created",
    );
    expect(normalizePaymentOrderStatus("dev_paid")).toBe("fulfilled");
    expect(inferPaymentOrderStatusFromDrawOrderStatus("opening")).toBe(
      "fulfilling",
    );
    expect(inferPaymentOrderStatusFromDrawOrderStatus("completed")).toBe(
      "fulfilled",
    );
    expect(isTerminalPaymentOrderStatus("disputed")).toBe(true);

    expect(paymentOrderStatusSchema.parse("fulfilling")).toBe("fulfilling");
    expect(paymentWebhookProcessStatusSchema.parse("failed")).toBe("failed");
  });

  it("builds webhook status updates with request, source and error context", () => {
    expect(
      buildPaymentWebhookStatusUpdate({
        requestId: "req_phase5_webhook",
        source: "telegram_webhook.successful_payment",
        processStatus: "failed",
        errorReason: "FULFILLMENT_RPC_FAILED",
        errorMessage: "RPC failed",
        processingDurationMs: 12.7,
        webhookSecretVerified: true,
      }),
    ).toMatchObject({
      process_status: "failed",
      error_message: "RPC failed",
      processing_duration_ms: 12,
      webhook_secret_verified: true,
      status_context: {
        request_id: "req_phase5_webhook",
        source: "telegram_webhook.successful_payment",
        error_reason: "FULFILLMENT_RPC_FAILED",
        error_message: "RPC failed",
      },
    });

    expect(
      buildBackendStatusContext({
        requestId: "req_phase5",
        source: "api.test",
      }),
    ).toEqual({
      request_id: "req_phase5",
      source: "api.test",
    });
  });

  it("normalizes Mint queue and chain transaction statuses", () => {
    expect(normalizeMintQueueStatus("PENDING")).toBe("queued");
    expect(normalizeMintQueueStatus("WAITING_CHAIN_CONFIRMATION")).toBe(
      "confirming",
    );
    expect(normalizeMintQueueStatus("manual_review")).toBe("manual_review");
    expect(isActiveMintQueueStatus("submitted")).toBe(true);
    expect(isTerminalMintQueueStatus("cancelled")).toBe(true);
    expect(normalizeOnchainTransactionStatus("SENT")).toBe("pending");

    expect(MintQueueStatusSchema.parse("retrying")).toBe("retrying");
    expect(OnchainTransactionStatusSchema.parse("confirmed")).toBe("confirmed");
  });

  it("builds Mint worker metadata for RPC calls", () => {
    expect(
      buildMintWorkerStatusMetadata({
        requestId: "req_phase5_mint_worker",
        source: "cron.retry_mint_queue",
        errorReason: "TON_API_TIMEOUT",
        errorMessage: "provider timeout",
        txHash: "tx-hash-001",
        externalApiProvider: "toncenter",
      }),
    ).toEqual({
      request_id: "req_phase5_mint_worker",
      source: "cron.retry_mint_queue",
      error_reason: "TON_API_TIMEOUT",
      error_message: "provider timeout",
      tx_hash: "tx-hash-001",
      external_api_provider: "toncenter",
    });
  });
});
