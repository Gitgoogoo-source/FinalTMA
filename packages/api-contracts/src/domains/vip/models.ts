import { z } from "zod";

import {
  nonNegativeIntegerSchema,
  utcDateSchema,
} from "../../common/schemas.ts";

export const vipStatusSchema = z
  .object({
    active: z.boolean(),
    benefit_date: utcDateSchema,
    starts_on: utcDateSchema.nullable(),
    ends_on: utcDateSchema.nullable(),
    remaining_days: nonNegativeIntegerSchema,
    renewals_used: nonNegativeIntegerSchema,
    can_purchase: z.boolean(),
    can_renew: z.boolean(),
    fgems_claimed_today: z.boolean(),
    free_box_claimed_today: z.boolean(),
    free_box_used_today: z.boolean(),
  })
  .strict();
