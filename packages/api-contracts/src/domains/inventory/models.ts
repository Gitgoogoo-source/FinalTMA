import { z } from "zod";

import {
  chainTypeSchema,
  nonNegativeIntegerSchema,
  raritySchema,
} from "../../common/schemas.ts";

export const inventoryItemSchema = z
  .object({
    template_id: z.string(),
    name: z.string(),
    rarity: raritySchema,
    stage: z.union([z.literal(1), z.literal(2), z.literal(3)]),
    chain_id: z.string(),
    chain_type: chainTypeSchema,
    image_path: z.string(),
    combat_power: z.number().int().positive(),
    expedition_fgems: z.number().int().positive(),
    total: nonNegativeIntegerSchema,
    available: nonNegativeIntegerSchema,
    listed: nonNegativeIntegerSchema,
    trading: nonNegativeIntegerSchema,
    expedition: nonNegativeIntegerSchema,
    minting: nonNegativeIntegerSchema,
  })
  .strict()
  .refine(
    (item) =>
      item.total ===
      item.available +
        item.listed +
        item.trading +
        item.minting +
        item.expedition,
    { message: "Inventory quantities must add up to total", path: ["total"] },
  );
