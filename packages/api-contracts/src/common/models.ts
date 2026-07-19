import { z } from "zod";

import { errorCodes } from "./errors.ts";
import {
  accountStatusSchema,
  nonNegativeIntegerSchema,
  operationStatusSchema,
  timestampSchema,
  uuidSchema,
} from "./schemas.ts";

export const balanceSchema = z
  .object({
    currency: z.enum(["KCOIN", "FGEMS"]),
    available: nonNegativeIntegerSchema,
    locked: nonNegativeIntegerSchema,
  })
  .strict();

export const assetsSchema = z
  .object({ kcoin: balanceSchema, fgems: balanceSchema })
  .strict();

export const userSchema = z
  .object({
    id: uuidSchema,
    telegram_id: z.string().regex(/^\d+$/),
    username: z.string().nullable(),
    first_name: z.string(),
    last_name: z.string().nullable(),
    photo_url: z.string().url().nullable(),
    status: accountStatusSchema,
    referral_code: z.string(),
  })
  .strict();

export const operationSummarySchema = z
  .object({
    operation_id: uuidSchema,
    use_case: z.string(),
    status: operationStatusSchema,
    result: z.json().nullable(),
    error_code: z.enum(errorCodes).nullable(),
    created_at: timestampSchema,
    updated_at: timestampSchema,
  })
  .strict();
