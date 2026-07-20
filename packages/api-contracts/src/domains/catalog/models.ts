import { z } from "zod";

import { chainTypeSchema, raritySchema } from "../../common/schemas.ts";

export const catalogChainSchema = z
  .object({
    id: z.string(),
    global_order: z.number().int().positive(),
    chain_type: chainTypeSchema,
    theme: z.string(),
    continuity: z.string(),
    catalog_version: z.literal("v1"),
  })
  .strict();

export const catalogTemplateSchema = z
  .object({
    id: z.string(),
    chain_id: z.string(),
    stage: z.union([z.literal(1), z.literal(2), z.literal(3)]),
    rarity: raritySchema,
    name: z.string(),
    sort_order: z.number().int().positive(),
    combat_power: z.number().int().positive(),
    market_price: z.number().int().positive(),
    decompose_fgems: z.number().int().positive(),
    expedition_fgems: z.number().int().positive(),
    image_thumbnail_path: z.string().startsWith("/assets/catalog/v1/thumb/"),
    image_detail_path: z.string().startsWith("/assets/catalog/v1/detail/"),
    draw_weight: z.number().int().positive(),
    catalog_version: z.literal("v1"),
  })
  .strict();
