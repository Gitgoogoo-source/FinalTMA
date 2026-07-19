import { z } from "zod";

import { defineRoute } from "../../common/route.ts";
import { emptyObjectSchema } from "../../common/schemas.ts";

const telegramUserSchema = z.object({
  id: z.number().int().positive(),
  is_bot: z.boolean().optional(),
  first_name: z.string().optional(),
  username: z.string().optional(),
});
const successfulPaymentSchema = z.object({
  currency: z.literal("XTR"),
  total_amount: z.number().int().positive(),
  invoice_payload: z.string(),
  telegram_payment_charge_id: z.string(),
  provider_payment_charge_id: z.string().optional(),
});
const refundedPaymentSchema = z.object({
  currency: z.literal("XTR"),
  total_amount: z.number().int().positive(),
  invoice_payload: z.string(),
  telegram_payment_charge_id: z.string(),
  provider_payment_charge_id: z.string().optional(),
});
const telegramUpdateSchema = z.object({
  update_id: z.number().int().nonnegative(),
  pre_checkout_query: z
    .object({
      id: z.string(),
      from: telegramUserSchema,
      currency: z.literal("XTR"),
      total_amount: z.number().int().positive(),
      invoice_payload: z.string(),
    })
    .optional(),
  message: z
    .object({
      message_id: z.number().int(),
      from: telegramUserSchema.optional(),
      text: z.string().optional(),
      successful_payment: successfulPaymentSchema.optional(),
      refunded_payment: refundedPaymentSchema.optional(),
    })
    .optional(),
});

export const integrationRoutes = [
  defineRoute({
    id: "telegram.payment_support",
    method: "GET",
    path: "/api/telegram/payment-support",
    gateway: "app",
    auth: false,
    idempotent: false,
    input: emptyObjectSchema,
    output: z
      .object({ command: z.literal("/paysupport"), text: z.string().min(1) })
      .strict(),
    errors: ["INTERNAL_ERROR"],
  }),
  defineRoute({
    id: "telegram.webhook",
    method: "POST",
    path: "/api/telegram/webhook",
    gateway: "integrations",
    auth: false,
    idempotent: false,
    rawResponse: true,
    input: telegramUpdateSchema,
    output: z.object({ ok: z.literal(true) }).strict(),
    errors: [
      "WEBHOOK_UNAUTHORIZED",
      "TELEGRAM_UPDATE_INVALID",
      "PAYMENT_MISMATCH",
      "PAYMENT_NOT_DELIVERABLE",
      "INTERNAL_ERROR",
    ],
  }),
] as const;
