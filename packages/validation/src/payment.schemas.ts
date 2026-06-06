import { z } from "zod";

import { commonUuidSchema } from "./common.schemas.js";

const PAYMENT_IDEMPOTENCY_KEY_RE = /^[A-Za-z0-9:_-]{16,128}$/;
const PAYMENT_BOX_SLUG_RE = /^[a-z0-9][a-z0-9_-]{0,79}$/;

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

export const KcoinTopupAmountSchema = z.coerce.number().int().min(1).max(10000);

export const KcoinTopupIntentSchema = z.enum(["MANUAL_TOPUP", "OPEN_BOX"]);

export const KcoinTopupStatusQuerySchema = z
  .object({
    orderId: commonUuidSchema,
  })
  .strict();

export const KcoinTopupCreateOrderRequestSchema = z
  .object({
    amount: KcoinTopupAmountSchema,
    intent: KcoinTopupIntentSchema.default("MANUAL_TOPUP"),
    boxSlug: z.string().trim().regex(PAYMENT_BOX_SLUG_RE).optional(),
    drawCount: z.coerce
      .number()
      .pipe(z.union([z.literal(1), z.literal(10)]))
      .optional(),
    idempotencyKey: z
      .string()
      .trim()
      .regex(
        PAYMENT_IDEMPOTENCY_KEY_RE,
        "Idempotency key must be 16-128 chars and use letters, numbers, colon, underscore or dash.",
      ),
  })
  .strict()
  .superRefine((value, ctx) => {
    if (value.intent !== "OPEN_BOX") {
      return;
    }

    if (!value.boxSlug) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "boxSlug is required for OPEN_BOX topup intent.",
        path: ["boxSlug"],
      });
    }

    if (!value.drawCount) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "drawCount is required for OPEN_BOX topup intent.",
        path: ["drawCount"],
      });
    }
  });

export type PaymentOrderStatus = z.infer<typeof paymentOrderStatusSchema>;
export type RawPaymentOrderStatus = z.infer<typeof rawPaymentOrderStatusSchema>;
export type PaymentWebhookProcessStatus = z.infer<
  typeof paymentWebhookProcessStatusSchema
>;
export type KcoinTopupAmount = z.infer<typeof KcoinTopupAmountSchema>;
export type KcoinTopupIntent = z.infer<typeof KcoinTopupIntentSchema>;
export type KcoinTopupCreateOrderRequest = z.infer<
  typeof KcoinTopupCreateOrderRequestSchema
>;
export type KcoinTopupStatusQuery = z.infer<typeof KcoinTopupStatusQuerySchema>;
