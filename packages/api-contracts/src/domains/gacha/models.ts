import { z } from "zod";

import { nonNegativeIntegerSchema } from "../../common/schemas.ts";
import { boxTierSchema, raritySchema } from "../../common/schemas.ts";

export const boxSchema = z
  .object({
    tier: boxTierSchema,
    display_name: z.string(),
    image_path: z.string().startsWith("/assets/"),
    single_price: z.number().int().positive(),
    ten_price: z.number().int().positive(),
    pity_limit: z.number().int().positive(),
    pity_rarity: raritySchema,
    rarity_weights: z
      .object({
        common: nonNegativeIntegerSchema,
        rare: nonNegativeIntegerSchema,
        epic: nonNegativeIntegerSchema,
        legendary: nonNegativeIntegerSchema,
        mythic: nonNegativeIntegerSchema,
      })
      .strict(),
  })
  .strict();
