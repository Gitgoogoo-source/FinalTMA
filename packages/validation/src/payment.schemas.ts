import { z } from "zod";

import { commonUuidSchema } from "./common.schemas.js";

const PAYMENT_IDEMPOTENCY_KEY_RE = /^[A-Za-z0-9:_-]{16,128}$/;

export const paymentOrderStatusSchema = z.enum([
  "created",
  "precheckout_checked",
  "paid",
  "fulfilling",
  "fulfilled",
  "failed",
  "refunded",
  "disputed",
  "expired",
]);

export const rawPaymentOrderStatusSchema = z.union([
  paymentOrderStatusSchema,
  z.literal("invoice_created"),
  z.literal("precheckout_ok"),
  z.literal("cancelled"),
  z.literal("pending"),
  z.literal("pending_payment"),
]);

export const paymentWebhookProcessStatusSchema = z.enum([
  "received",
  "processing",
  "processed",
  "ignored",
  "failed",
]);

export const paymentStatusSchema = paymentOrderStatusSchema;

export const KcoinTopupAmountSchema = z.union([
  z.literal(1),
  z.literal(500),
  z.literal(1000),
  z.literal(5000),
  z.literal(10000),
]);

export const KcoinTopupStatusQuerySchema = z
  .object({
    orderId: commonUuidSchema,
  })
  .strict();

export const KcoinTopupCreateOrderRequestSchema = z
  .object({
    amount: z.coerce.number().pipe(KcoinTopupAmountSchema),
    idempotencyKey: z
      .string()
      .trim()
      .regex(
        PAYMENT_IDEMPOTENCY_KEY_RE,
        "Idempotency key must be 16-128 chars and use letters, numbers, colon, underscore or dash.",
      ),
  })
  .strict();

export type PaymentOrderStatus = z.infer<typeof paymentOrderStatusSchema>;
export type RawPaymentOrderStatus = z.infer<typeof rawPaymentOrderStatusSchema>;
export type PaymentWebhookProcessStatus = z.infer<
  typeof paymentWebhookProcessStatusSchema
>;
export type KcoinTopupAmount = z.infer<typeof KcoinTopupAmountSchema>;
export type KcoinTopupCreateOrderRequest = z.infer<
  typeof KcoinTopupCreateOrderRequestSchema
>;
export type KcoinTopupStatusQuery = z.infer<typeof KcoinTopupStatusQuerySchema>;
