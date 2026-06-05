import { z } from "zod";

const VIP_IDEMPOTENCY_KEY_RE = /^[A-Za-z0-9:_-]{16,128}$/;

export const VipIdempotencyKeySchema = z
  .string()
  .trim()
  .regex(
    VIP_IDEMPOTENCY_KEY_RE,
    "Idempotency key must be 16-128 chars and use letters, numbers, colon, underscore or dash.",
  );

export const VipCreateOrderRequestSchema = z
  .object({
    planId: z.string().uuid(),
    idempotencyKey: VipIdempotencyKeySchema,
  })
  .strict();

export type VipCreateOrderRequest = z.infer<typeof VipCreateOrderRequestSchema>;

export const VipDailyClaimRequestSchema = z
  .object({
    idempotencyKey: VipIdempotencyKeySchema,
  })
  .strict();

export type VipDailyClaimRequest = z.infer<typeof VipDailyClaimRequestSchema>;
