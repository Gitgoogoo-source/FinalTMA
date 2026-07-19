import { z } from "zod";

import {
  expeditionTierSchema,
  timestampSchema,
  uuidSchema,
} from "../../common/schemas.ts";

export const expeditionInputItemSchema = z
  .object({
    template_id: z.string().min(1),
    quantity: z.number().int().positive(),
  })
  .strict();

export const expeditionSchema = z
  .object({
    id: uuidSchema,
    tier: expeditionTierSchema,
    status: z.enum(["running", "claimable", "claimed"]),
    reward_fgems: z.number().int().positive(),
    started_at: timestampSchema,
    completes_at: timestampSchema,
    claimed_at: timestampSchema.nullable(),
  })
  .strict();
