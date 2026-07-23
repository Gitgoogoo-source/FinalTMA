import { z } from "zod";

import {
  nonNegativeIntegerSchema,
  raritySchema,
  timestampSchema,
  uuidSchema,
} from "../../common/schemas.ts";

export const monsterElementSchema = z.enum([
  "water",
  "fire",
  "wood",
  "wind",
  "lightning",
]);

export const monsterRegionIdSchema = z.enum([
  "camp",
  "luminous_forest",
  "tidal_wetland",
  "windswept_highlands",
  "crystal_cavern",
  "molten_basin",
  "hidden_cave",
  "guardian_lair",
]);

export const monsterAbilitySchema = z.enum([
  "vine_bridge",
  "tidal_walk",
  "wind_glide",
  "lightning_charge",
  "heat_shield",
]);

export const monsterMechanicCodeSchema = z.enum([
  "none",
  "forest_regrowth",
  "wetland_tide_shield",
  "highland_gust_followup",
  "cavern_thunder_cycle",
  "basin_scorch",
  "guardian_element_cycle",
]);

export const monsterPositionSchema = z
  .object({
    x: nonNegativeIntegerSchema,
    y: nonNegativeIntegerSchema,
  })
  .strict();

export const monsterSkillSchema = z
  .object({
    slot: z.union([z.literal(1), z.literal(2), z.literal(3)]),
    code: z.string().min(1).max(64),
    name: z.string().min(1).max(64),
    element: monsterElementSchema,
    power_bp: z.number().int().min(0).max(30_000),
    effect_kind: z.enum([
      "none",
      "heal_self",
      "shield_self",
      "burn_enemy",
      "attack_up_self",
      "drain_self",
      "regen_self",
      "weaken_enemy",
      "charge_self",
    ]),
    effect_value_bp: z.number().int().min(0).max(30_000),
    duration_turns: z.number().int().min(0).max(10),
  })
  .strict();

export const monsterCombatProfileSchema = z
  .object({
    template_id: z.string(),
    name: z.string(),
    rarity: raritySchema,
    stage: z.union([z.literal(1), z.literal(2), z.literal(3)]),
    chain_id: z.string(),
    image_thumbnail_path: z.string().startsWith("/assets/catalog/v1/thumb/"),
    image_detail_path: z.string().startsWith("/assets/catalog/v1/detail/"),
    combat_power: z.number().int().positive(),
    element: monsterElementSchema,
    max_hp: z.number().int().positive(),
    attack: z.number().int().positive(),
    skills: z.tuple([
      monsterSkillSchema,
      monsterSkillSchema,
      monsterSkillSchema,
    ]),
  })
  .strict();

export const monsterInventoryItemSchema = monsterCombatProfileSchema
  .extend({
    available_quantity: z.number().int().positive(),
  })
  .strict();

export const monsterPartyMemberSchema = z
  .object({
    template_id: z.string(),
    current_hp: nonNegativeIntegerSchema,
    max_hp: z.number().int().positive(),
  })
  .strict()
  .refine((member) => member.current_hp <= member.max_hp, {
    message: "Current HP cannot exceed max HP",
    path: ["current_hp"],
  });

export const monsterProgressSchema = z
  .object({
    state_version: nonNegativeIntegerSchema,
    current_region: monsterRegionIdSchema,
    resume_position: monsterPositionSchema,
    region_entry_serial: nonNegativeIntegerSchema,
    party: z.array(monsterPartyMemberSchema).max(3),
    unlocked_regions: z.array(monsterRegionIdSchema),
    abilities: z.array(monsterAbilitySchema),
    revealed_cells: z.record(z.string(), z.array(z.string())),
    completed_node_ids: z.array(z.string()),
    defeated_elite_ids: z.array(z.string()),
    defeated_boss_ids: z.array(z.string()),
    guardian_completed_at: timestampSchema.nullable(),
    supply_count: nonNegativeIntegerSchema,
    regional_boost: z
      .object({
        region_id: monsterRegionIdSchema,
        attack_bp: z.literal(1000),
      })
      .strict()
      .nullable(),
    last_checkpoint: z.string().nullable(),
    current_refreshable_claim_ids: z.array(z.string()),
  })
  .strict();

export const monsterRegionSchema = z
  .object({
    id: monsterRegionIdSchema,
    name: z.string(),
    element: monsterElementSchema.nullable(),
    width_tiles: z.number().int().positive(),
    height_tiles: z.number().int().positive(),
    spawn: monsterPositionSchema,
    walkable_cell_ids: z.array(z.string()).min(1),
    environment: z
      .object({
        element: monsterElementSchema.nullable(),
        effect_code: z.string(),
      })
      .strict(),
    unlocked: z.boolean(),
  })
  .strict();

export const monsterWorldNodeSchema = z
  .object({
    id: z.string(),
    region_id: monsterRegionIdSchema,
    kind: z.enum([
      "chest",
      "gate",
      "shortcut",
      "supply",
      "gather",
      "exit",
      "rematch",
    ]),
    name: z.string(),
    position: monsterPositionSchema,
    required_ability: monsterAbilitySchema.nullable(),
    target_region: monsterRegionIdSchema.nullable(),
    encounter_id: z.string().nullable(),
    refreshable: z.boolean(),
    available: z.boolean(),
    completed: z.boolean(),
    claimed: z.boolean(),
  })
  .strict();

export const monsterEncounterSchema = z
  .object({
    id: z.string(),
    region_id: monsterRegionIdSchema,
    kind: z.enum(["normal", "elite", "boss", "guardian"]),
    template_id: z.string(),
    name: z.string(),
    image_thumbnail_path: z.string().startsWith("/assets/catalog/v1/thumb/"),
    mechanic_code: monsterMechanicCodeSchema,
    position: monsterPositionSchema,
    engage_radius: z.number().int().min(1).max(5),
    available: z.boolean(),
    claimed: z.boolean(),
  })
  .strict();

export const monsterBattleStatusesSchema = z
  .object({
    shield_hp: nonNegativeIntegerSchema,
    burn_turns: nonNegativeIntegerSchema,
    burn_damage: nonNegativeIntegerSchema,
    attack_up_bp: nonNegativeIntegerSchema,
    weakened_bp: nonNegativeIntegerSchema,
    regen_turns: nonNegativeIntegerSchema,
    regen_amount: nonNegativeIntegerSchema,
    charge_damage: nonNegativeIntegerSchema,
  })
  .strict();

export const monsterBattleCombatantSchema = z
  .object({
    template_id: z.string(),
    name: z.string(),
    image_thumbnail_path: z.string().startsWith("/assets/catalog/v1/thumb/"),
    image_detail_path: z.string().startsWith("/assets/catalog/v1/detail/"),
    element: monsterElementSchema,
    current_hp: nonNegativeIntegerSchema,
    max_hp: z.number().int().positive(),
    attack: z.number().int().positive(),
    down: z.boolean(),
    statuses: monsterBattleStatusesSchema,
    skills: z.tuple([
      monsterSkillSchema,
      monsterSkillSchema,
      monsterSkillSchema,
    ]),
  })
  .strict();

export const monsterBattleSchema = z
  .object({
    battle_id: uuidSchema,
    encounter_id: z.string(),
    kind: z.enum(["normal", "elite", "boss", "guardian"]),
    status: z.enum(["active", "won", "lost"]),
    state_version: nonNegativeIntegerSchema,
    turn: nonNegativeIntegerSchema,
    active_template_id: z.string().nullable(),
    party: z.array(monsterBattleCombatantSchema).min(1).max(3),
    enemy: monsterBattleCombatantSchema,
    environment: z
      .object({
        element: monsterElementSchema.nullable(),
        effect_code: z.string(),
      })
      .strict(),
    mechanic_code: monsterMechanicCodeSchema,
    mechanic_notice: z.string().nullable(),
  })
  .strict();

export const monsterWorldSchema = z
  .object({
    regions: z.array(monsterRegionSchema),
    nodes: z.array(monsterWorldNodeSchema),
    encounters: z.array(monsterEncounterSchema),
  })
  .strict();

export const monsterBootstrapSchema = z
  .object({
    rules_version: z.string(),
    map_checksum: z.string().regex(/^[0-9a-f]{64}$/),
    entry_state: z.enum([
      "ready",
      "no_available_collections",
      "team_reselection_required",
    ]),
    inventory: z.array(monsterInventoryItemSchema).max(210),
    combat_catalog: z.array(monsterCombatProfileSchema).length(210),
    progress: monsterProgressSchema,
    active_battle: monsterBattleSchema.nullable(),
    world: monsterWorldSchema,
  })
  .strict();

export const monsterCheckpointResultSchema = z
  .object({ progress: monsterProgressSchema })
  .strict();

export const monsterBattleResultSchema = z
  .object({
    battle: monsterBattleSchema,
    progress: monsterProgressSchema,
    terminal: z.enum(["ongoing", "won", "lost"]),
  })
  .strict();
