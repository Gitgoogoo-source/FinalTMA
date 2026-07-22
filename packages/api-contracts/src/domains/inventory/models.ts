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
    attempt_count: z.number().int().positive(),
    success_count: nonNegativeIntegerSchema,
    failure_count: nonNegativeIntegerSchema,
    source: evolutionTemplateSchema,
    target: evolutionTemplateSchema,
    materials: z
      .object({
        selected: z.number().int().positive().multipleOf(3),
        consumed: z.number().int().positive(),
        retained: nonNegativeIntegerSchema,
      })
      .strict(),
    success_rate_percent: z.number().int().min(1).max(100),
    fgems_cost_per_attempt: z.number().int().positive(),
    fgems_spent: z.number().int().positive(),
    pity: z
      .object({
        previous_failure_count: nonNegativeIntegerSchema,
        current_failure_count: nonNegativeIntegerSchema,
        guarantee_attempt: z.number().int().positive(),
        failures_until_guaranteed: nonNegativeIntegerSchema,
        guaranteed_attempts: nonNegativeIntegerSchema,
      })
      .strict(),
    target_awarded: nonNegativeIntegerSchema,
    new_album: z.boolean(),
    assets: assetsSchema,
  })
  .strict()
  .superRefine((result, context) => {
    if (
      result.attempt_count !== result.success_count + result.failure_count ||
      result.materials.selected !== result.attempt_count * 3 ||
      result.materials.consumed !==
        result.success_count * 3 + result.failure_count * 2 ||
      result.materials.retained !== result.failure_count ||
      result.target_awarded !== result.success_count ||
      result.fgems_spent !==
        result.fgems_cost_per_attempt * result.attempt_count ||
      result.pity.guaranteed_attempts > result.success_count ||
      (result.success_count === 0 && result.new_album)
    )
      context.addIssue({
        code: "custom",
        message: "Batch evolution settlement fields are inconsistent",
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
    decompose_fgems: z.number().int().positive(),
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
