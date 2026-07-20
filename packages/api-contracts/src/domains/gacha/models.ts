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

export const gachaPoolSchema = z
  .object({
    tier: boxTierSchema,
    display_name: z.string(),
    catalog_version: z.literal("v1"),
    pity: z
      .object({
        limit: z.number().int().positive(),
        target_rarity: raritySchema,
      })
      .strict(),
    rarities: z
      .array(
        z
          .object({
            rarity: raritySchema,
            rarity_probability_basis_points: z
              .number()
              .int()
              .positive()
              .max(10_000),
            rarity_probability_percent: z.number().positive().max(100),
            catalog_total_weight: z.number().int().positive(),
            items: z
              .array(
                z
                  .object({
                    template_id: z.string(),
                    name: z.string(),
                    rarity: raritySchema,
                    stage: z.number().int().min(1).max(3),
                    image_path: z.string().startsWith("/assets/"),
                    catalog_weight: z.number().int().positive(),
                    single_probability_percent: z.number().positive().max(100),
                  })
                  .strict(),
              )
              .min(1),
          })
          .strict(),
      )
      .min(1)
      .max(5),
  })
  .strict();
