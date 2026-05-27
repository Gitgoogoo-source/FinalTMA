import { z } from "zod";

export const paymentOrderStatusSchema = z.enum([
  "created",
  "invoice_created",
  "precheckout_checked",
  "paid",
  "fulfilling",
  "fulfilled",
  "cancelled",
  "failed",
  "expired",
  "refunded",
  "disputed",
]);

export const rawPaymentOrderStatusSchema = z.union([
  paymentOrderStatusSchema,
  z.literal("precheckout_ok"),
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

export type PaymentOrderStatus = z.infer<typeof paymentOrderStatusSchema>;
export type RawPaymentOrderStatus = z.infer<typeof rawPaymentOrderStatusSchema>;
export type PaymentWebhookProcessStatus = z.infer<
  typeof paymentWebhookProcessStatusSchema
>;
