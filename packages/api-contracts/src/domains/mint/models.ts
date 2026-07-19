import { z } from "zod";

import { timestampSchema, uuidSchema } from "../../common/schemas.ts";

export const mintSchema = z
  .object({
    id: uuidSchema,
    template_id: z.string(),
    status: z.enum([
      "reserved",
      "submitted",
      "unknown",
      "succeeded",
      "failed",
      "cancelled",
    ]),
    nft_number: z.number().int().nonnegative(),
    transaction_hash: z.string().nullable(),
    permit_expires_at: timestampSchema,
    submitted_at: timestampSchema.nullable(),
    completed_at: timestampSchema.nullable(),
  })
  .strict();
