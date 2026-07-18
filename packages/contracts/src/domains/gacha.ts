import { z } from "zod";

import { assetsSchema, boxSchema } from "../common/models.ts";
import { defineRoute } from "../common/route.ts";
import { boxTierSchema, emptyObjectSchema, raritySchema } from "../common/schemas.ts";

const pitySchema = z
  .object({ tier: boxTierSchema, progress: z.number().int().min(0), limit: z.number().int().positive(), target_rarity: raritySchema })
  .strict();
const resultItemSchema = z
  .object({
    order: z.number().int().positive(),
    template_id: z.string(),
    name: z.string(),
    rarity: raritySchema,
    image_path: z.string(),
    new_album: z.boolean(),
  })
  .strict();

export const gachaRoutes = [
  defineRoute({
    id: "gacha.bootstrap",
    method: "GET",
    path: "/api/gacha/bootstrap",
    gateway: "app",
    auth: true,
    idempotent: false,
    input: emptyObjectSchema,
    output: z
      .object({
        boxes: z.array(boxSchema).length(3),
        pity: z.array(pitySchema).length(3),
        entitlements: z.object({ free_normal_box: z.number().int().min(0), free_rare_box: z.number().int().min(0) }).strict(),
      })
      .strict(),
    errors: ["SESSION_REQUIRED", "ACCOUNT_RESTRICTED", "INTERNAL_ERROR"],
  }),
  defineRoute({
    id: "gacha.open",
    method: "POST",
    path: "/api/gacha/open",
    gateway: "app",
    auth: true,
    idempotent: true,
    input: z.object({ tier: boxTierSchema, draw_count: z.union([z.literal(1), z.literal(10)]) }).strict(),
    output: z
      .object({
        tier: boxTierSchema,
        draw_count: z.union([z.literal(1), z.literal(10)]),
        paid_kcoin: z.number().int().min(0),
        entitlement_used: z.enum(["free_normal_box", "free_rare_box"]).nullable(),
        results: z.array(resultItemSchema).min(1).max(10),
        pity: pitySchema,
        assets: assetsSchema,
      })
      .strict(),
    errors: ["INSUFFICIENT_BALANCE", "FREE_ENTITLEMENT_UNAVAILABLE", "IDEMPOTENCY_KEY_REUSED", "ACCOUNT_RESTRICTED", "INTERNAL_ERROR"],
  }),
] as const;
