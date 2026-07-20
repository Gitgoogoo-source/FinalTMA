import { z } from "zod";

import { assetsSchema } from "../../common/models.ts";
import {
  chainTypeSchema,
  nonNegativeIntegerSchema,
  raritySchema,
} from "../../common/schemas.ts";

export const evolutionTemplateSchema = z
  .object({
    template_id: z.string(),
    name: z.string(),
    rarity: raritySchema,
    stage: z.union([z.literal(1), z.literal(2), z.literal(3)]),
    image_thumbnail_path: z.string().startsWith("/assets/catalog/v1/thumb/"),
    image_detail_path: z.string().startsWith("/assets/catalog/v1/detail/"),
  })
  .strict();

export const evolutionPityPreviewSchema = z
  .object({
    failure_count: nonNegativeIntegerSchema,
    guarantee_attempt: z.number().int().positive(),
    failures_until_guaranteed: nonNegativeIntegerSchema,
    guaranteed_this_attempt: z.boolean(),
  })
  .strict();

export const evolutionPreviewSchema = z
  .object({
    source: evolutionTemplateSchema,
    target: evolutionTemplateSchema.nullable(),
    materials: z
      .object({
        required: z.literal(3),
        available: nonNegativeIntegerSchema,
        failure_consumed: z.literal(2),
        failure_retained: z.literal(1),
      })
      .strict(),
    success_rate_percent: z.number().int().min(1).max(100).nullable(),
    fgems: z
      .object({
        cost: z.number().int().positive().nullable(),
        available: nonNegativeIntegerSchema,
      })
      .strict(),
    pity: evolutionPityPreviewSchema.nullable(),
    eligibility: z
      .object({
        eligible: z.boolean(),
        reason: z
          .enum([
            "final_stage",
            "target_unavailable",
            "insufficient_materials",
            "insufficient_fgems",
          ])
          .nullable(),
      })
      .strict(),
  })
  .strict()
  .superRefine((preview, context) => {
    if (preview.eligibility.eligible !== (preview.eligibility.reason === null))
      context.addIssue({
        code: "custom",
        message: "Eligibility and reason must agree",
        path: ["eligibility"],
      });
    const missingRuleFields = [
      preview.success_rate_percent,
      preview.fgems.cost,
      preview.pity,
    ].filter((value) => value === null).length;
    if (
      (preview.target === null && missingRuleFields !== 3) ||
      (preview.target !== null && missingRuleFields !== 0)
    )
      context.addIssue({
        code: "custom",
        message: "Evolution rule fields must be complete together",
        path: ["target"],
      });
  });

export const evolutionResultSchema = z
  .object({
    success: z.boolean(),
    source: evolutionTemplateSchema,
    target: evolutionTemplateSchema,
    materials: z
      .object({
        required: z.literal(3),
        consumed: z.union([z.literal(2), z.literal(3)]),
        retained: z.union([z.literal(0), z.literal(1)]),
      })
      .strict(),
    success_rate_percent: z.number().int().min(1).max(100),
    fgems_spent: z.number().int().positive(),
    pity: z
      .object({
        previous_failure_count: nonNegativeIntegerSchema,
        current_failure_count: nonNegativeIntegerSchema,
        guarantee_attempt: z.number().int().positive(),
        failures_until_guaranteed: nonNegativeIntegerSchema,
        guaranteed_this_attempt: z.boolean(),
      })
      .strict(),
    target_awarded: z.union([z.literal(0), z.literal(1)]),
    new_album: z.boolean(),
    assets: assetsSchema,
  })
  .strict()
  .superRefine((result, context) => {
    const expected = result.success
      ? { consumed: 3, retained: 0, awarded: 1, failures: 0 }
      : {
          consumed: 2,
          retained: 1,
          awarded: 0,
          failures: result.pity.previous_failure_count + 1,
        };
    if (
      result.materials.consumed !== expected.consumed ||
      result.materials.retained !== expected.retained ||
      result.target_awarded !== expected.awarded ||
      result.pity.current_failure_count !== expected.failures
    )
      context.addIssue({
        code: "custom",
        message: "Evolution result settlement fields are inconsistent",
      });
  });

export const evolutionRejectedResultSchema = z
  .object({
    outcome: z.literal("rejected"),
    source_template_id: z.string(),
    target_template_id: z.string().nullable(),
    available_quantity: nonNegativeIntegerSchema.nullable(),
    fgems_available: nonNegativeIntegerSchema.nullable(),
    fgems_cost: z.number().int().positive().nullable(),
    error_code: z.enum([
      "EVOLUTION_NOT_AVAILABLE",
      "INSUFFICIENT_INVENTORY",
      "INSUFFICIENT_BALANCE",
      "INTERNAL_ERROR",
    ]),
  })
  .strict();

export const inventoryItemSchema = z
  .object({
    template_id: z.string(),
    name: z.string(),
    rarity: raritySchema,
    stage: z.union([z.literal(1), z.literal(2), z.literal(3)]),
    chain_id: z.string(),
    chain_type: chainTypeSchema,
    image_thumbnail_path: z.string().startsWith("/assets/catalog/v1/thumb/"),
    image_detail_path: z.string().startsWith("/assets/catalog/v1/detail/"),
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
