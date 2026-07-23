import { z } from "zod";

import { defineRoute } from "../../common/route.ts";
import {
  emptyObjectSchema,
  identifierSchema,
  nonNegativeIntegerSchema,
  uuidSchema,
} from "../../common/schemas.ts";
import {
  monsterBattleResultSchema,
  monsterBootstrapSchema,
  monsterCheckpointResultSchema,
  monsterRegionIdSchema,
} from "./models.ts";

const revealedCellsSchema = z
  .array(identifierSchema)
  .max(256)
  .optional()
  .default([]);

const traversedCellsSchema = z
  .array(identifierSchema)
  .max(256)
  .optional()
  .default([]);

const checkpointInputSchema = z
  .object({
    expected_progress_version: nonNegativeIntegerSchema,
    command: z.discriminatedUnion("type", [
      z
        .object({
          type: z.literal("confirm_team"),
          template_ids: z
            .array(identifierSchema)
            .min(1)
            .max(3)
            .refine((ids) => new Set(ids).size === ids.length, {
              message: "Team template ids must be distinct",
            }),
        })
        .strict(),
      z
        .object({
          type: z.literal("enter_region"),
          region_id: monsterRegionIdSchema,
          source_node_id: identifierSchema.nullable(),
        })
        .strict(),
      z
        .object({
          type: z.literal("complete_world_node"),
          node_id: identifierSchema,
        })
        .strict(),
      z
        .object({
          type: z.literal("use_supply"),
          target_template_id: identifierSchema,
        })
        .strict(),
      z
        .object({
          type: z.literal("sync_revealed_cells"),
        })
        .strict(),
    ]),
    revealed_cell_ids: revealedCellsSchema,
    traversed_cell_ids: traversedCellsSchema,
  })
  .strict()
  .superRefine((input, context) => {
    const sync = input.command.type === "sync_revealed_cells";
    if (
      sync &&
      input.revealed_cell_ids.length + input.traversed_cell_ids.length === 0
    ) {
      context.addIssue({
        code: "custom",
        message: "sync_revealed_cells requires revealed or traversed cell ids",
        path: ["command"],
      });
    }
    if (
      !sync &&
      (input.revealed_cell_ids.length > 0 ||
        input.traversed_cell_ids.length > 0)
    )
      context.addIssue({
        code: "custom",
        message: "Only sync_revealed_cells accepts world traversal data",
        path: ["command"],
      });
  });

const battleInputSchema = z.discriminatedUnion("command", [
  z
    .object({
      command: z.literal("start"),
      encounter_id: identifierSchema,
      source_node_id: identifierSchema.nullable(),
      expected_progress_version: nonNegativeIntegerSchema,
    })
    .strict(),
  z
    .object({
      command: z.literal("use_skill"),
      battle_id: uuidSchema,
      expected_battle_version: nonNegativeIntegerSchema,
      actor_template_id: identifierSchema,
      skill_slot: z.union([z.literal(1), z.literal(2), z.literal(3)]),
    })
    .strict(),
  z
    .object({
      command: z.literal("acknowledge"),
      battle_id: uuidSchema,
      expected_battle_version: nonNegativeIntegerSchema,
    })
    .strict(),
]);

const monsterErrors = [
  "SESSION_REQUIRED",
  "SESSION_EXPIRED",
  "SESSION_REPLACED",
  "ACCOUNT_RESTRICTED",
  "ENTRY_HANDOFF_PENDING",
  "REQUEST_INVALID",
  "INTERNAL_ERROR",
  "MONSTER_TAMER_STATE_CONFLICT",
  "MONSTER_TAMER_NO_AVAILABLE_COLLECTIONS",
  "MONSTER_TAMER_TEAM_INVALID",
  "MONSTER_TAMER_REGION_LOCKED",
  "MONSTER_TAMER_NODE_UNAVAILABLE",
  "MONSTER_TAMER_ENCOUNTER_UNAVAILABLE",
  "MONSTER_TAMER_BATTLE_ALREADY_ACTIVE",
  "MONSTER_TAMER_BATTLE_NOT_FOUND",
  "MONSTER_TAMER_BATTLE_STATE_CONFLICT",
] as const;

export const monsterTamerRoutes = [
  defineRoute({
    id: "monster_tamer.bootstrap",
    method: "GET",
    path: "/api/monster-tamer/bootstrap",
    gateway: "app",
    auth: true,
    idempotent: false,
    input: emptyObjectSchema,
    output: monsterBootstrapSchema,
    errors: monsterErrors,
  }),
  defineRoute({
    id: "monster_tamer.checkpoint",
    method: "POST",
    path: "/api/monster-tamer/checkpoint",
    gateway: "app",
    auth: true,
    idempotent: true,
    refreshScopes: ["none"],
    input: checkpointInputSchema,
    output: monsterCheckpointResultSchema,
    errors: [...monsterErrors, "IDEMPOTENCY_KEY_REUSED"],
  }),
  defineRoute({
    id: "monster_tamer.battle",
    method: "POST",
    path: "/api/monster-tamer/battle",
    gateway: "app",
    auth: true,
    idempotent: true,
    refreshScopes: ["none"],
    input: battleInputSchema,
    output: monsterBattleResultSchema,
    errors: [...monsterErrors, "IDEMPOTENCY_KEY_REUSED"],
  }),
] as const;
