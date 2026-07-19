import { z } from "zod";

import {
  nonNegativeIntegerSchema,
  utcDateSchema,
} from "../../common/schemas.ts";

export const vipStatusSchema = z
  .object({
    active: z.boolean(),
    starts_on: utcDateSchema.nullable(),
    ends_on: utcDateSchema.nullable(),
    renewals_used: nonNegativeIntegerSchema,
    can_purchase: z.boolean(),
    can_renew: z.boolean(),
    fgems_claimed_today: z.boolean(),
    free_box_claimed_today: z.boolean(),
  })
  .strict();
