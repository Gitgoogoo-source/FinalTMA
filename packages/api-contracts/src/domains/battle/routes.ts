import { z } from "zod";

import { defineRoute } from "../../common/route.ts";
import {
  emptyObjectSchema,
  nonNegativeIntegerSchema,
  timestampSchema,
  uuidSchema,
} from "../../common/schemas.ts";
import {
  battleEntryTierSchema,
  battleInvitePreviewSchema,
  battleParticipationSchema,
  battleRoomSnapshotSchema,
  battleRulesetSummarySchema,
  battleTeamOptionSchema,
  battleTeamSelectionSchema,
} from "./models.ts";

const battleBootstrapSchema = z
  .object({
    ruleset: battleRulesetSummarySchema,
    entry_tiers: z.array(battleEntryTierSchema).length(3),
    participation: battleParticipationSchema.nullable(),
    room: battleRoomSnapshotSchema.nullable(),
    server_time: timestampSchema,
  })
  .strict();

const battleCreateResultSchema = z.discriminatedUnion("status", [
  z
    .object({
      room_id: uuidSchema,
      status: z.literal("preparing_share"),
      create_operation_id: uuidSchema,
      prepare_deadline: timestampSchema,
    })
    .strict(),
  z
    .object({
      room_id: uuidSchema,
      status: z.literal("waiting"),
      prepared_message_id: z.string().trim().min(1).max(256),
      expires_at: timestampSchema,
    })
    .strict(),
]);

const battleTerminalRoomSchema = z
  .object({
    room_id: uuidSchema,
    status: z.enum(["cancelled", "expired", "voided"]),
    reason: z.string().trim().min(1).max(128),
  })
  .strict();

const ablyTokenSchema = z
  .object({
    token: z.string().min(1),
    keyName: z.string().min(1),
    issued: z.number().int().positive(),
    expires: z.number().int().positive(),
    capability: z.string().min(2),
    clientId: z.string().min(1),
  })
  .strict();

const battleActionRouteInputSchema = z.discriminatedUnion("kind", [
  z
    .object({
      room_id: uuidSchema,
      kind: z.literal("attack"),
      round_no: z.number().int().min(1).max(20),
      action_ordinal: z.union([z.literal(1), z.literal(2)]),
      skill_position: z.union([
        z.literal(1),
        z.literal(2),
        z.literal(3),
        z.literal(4),
      ]),
    })
    .strict(),
  z
    .object({
      room_id: uuidSchema,
      kind: z.literal("switch"),
      round_no: z.number().int().min(1).max(20),
      action_ordinal: z.union([z.literal(1), z.literal(2)]),
      team_slot: z.union([z.literal(1), z.literal(2), z.literal(3)]),
    })
    .strict(),
  z
    .object({
      room_id: uuidSchema,
      kind: z.literal("replace_attack"),
      round_no: z.number().int().min(1).max(20),
      action_ordinal: z.union([z.literal(1), z.literal(2)]),
      team_slot: z.union([z.literal(1), z.literal(2), z.literal(3)]),
      skill_position: z.union([
        z.literal(1),
        z.literal(2),
        z.literal(3),
        z.literal(4),
      ]),
    })
    .strict(),
]);

const battlePresenceCommandSchema = z
  .object({
    room_id: uuidSchema,
    presence_lease_id: uuidSchema,
    presence_lifecycle_version: z
      .number()
      .int()
      .min(1)
      .max(Number.MAX_SAFE_INTEGER),
    presence_command_seq: z.number().int().min(1).max(Number.MAX_SAFE_INTEGER),
  })
  .strict();

export const battleRoutes = [
  defineRoute({
    id: "battle.bootstrap",
    method: "GET",
    path: "/api/battle/bootstrap",
    gateway: "app",
    auth: true,
    idempotent: false,
    refreshScopes: ["battle"],
    input: emptyObjectSchema,
    output: battleBootstrapSchema,
    errors: ["BATTLE_RULESET_UNAVAILABLE"],
  }),
  defineRoute({
    id: "battle.team_options",
    method: "GET",
    path: "/api/battle/team-options",
    gateway: "app",
    auth: true,
    idempotent: false,
    refreshScopes: ["battle", "inventory"],
    input: emptyObjectSchema,
    output: z
      .object({ items: z.array(battleTeamOptionSchema).max(210) })
      .strict(),
    errors: ["BATTLE_RULESET_UNAVAILABLE", "RATE_LIMITED"],
  }),
  defineRoute({
    id: "battle.current_invite",
    method: "GET",
    path: "/api/battle/invites/current",
    gateway: "app",
    auth: true,
    idempotent: false,
    refreshScopes: ["battle"],
    input: emptyObjectSchema,
    output: battleInvitePreviewSchema,
    errors: ["RATE_LIMITED"],
  }),
  defineRoute({
    id: "battle.room",
    method: "GET",
    path: "/api/battle/rooms/:room_id",
    gateway: "app",
    auth: true,
    idempotent: false,
    refreshScopes: ["battle"],
    input: z
      .object({
        room_id: uuidSchema,
        after_action_sequence: nonNegativeIntegerSchema.optional(),
      })
      .strict(),
    output: battleRoomSnapshotSchema,
    errors: ["BATTLE_ROOM_NOT_FOUND", "BATTLE_NOT_PARTICIPANT"],
  }),
  defineRoute({
    id: "battle.create",
    method: "POST",
    path: "/api/battle/rooms",
    gateway: "app",
    auth: true,
    idempotent: true,
    refreshScopes: ["battle", "assets", "inventory"],
    input: z
      .object({
        tier: z.enum(["tier-20", "tier-100", "tier-500"]),
        template_ids: battleTeamSelectionSchema,
      })
      .strict(),
    output: battleCreateResultSchema,
    errors: [
      "BATTLE_RULESET_UNAVAILABLE",
      "BATTLE_TIER_INVALID",
      "BATTLE_TEAM_INVALID",
      "BATTLE_TEAM_TEMPLATE_DUPLICATE",
      "BATTLE_ALREADY_PARTICIPATING",
      "BATTLE_SHARE_PREPARING",
      "BATTLE_SHARE_FAILED",
      "INSUFFICIENT_BALANCE",
      "INSUFFICIENT_INVENTORY",
      "INVENTORY_RESERVED",
      "RATE_LIMITED",
      "IDEMPOTENCY_KEY_REUSED",
    ],
  }),
  defineRoute({
    id: "battle.cancel",
    method: "POST",
    path: "/api/battle/rooms/:room_id/cancel",
    gateway: "app",
    auth: true,
    idempotent: true,
    refreshScopes: ["battle", "assets", "inventory"],
    input: z.object({ room_id: uuidSchema }).strict(),
    output: battleTerminalRoomSchema,
    errors: [
      "BATTLE_ROOM_NOT_FOUND",
      "BATTLE_ROOM_EXPIRED",
      "BATTLE_ROOM_CANCELLED",
      "BATTLE_ROOM_ALREADY_ACCEPTED",
      "BATTLE_VOIDED",
      "IDEMPOTENCY_KEY_REUSED",
    ],
  }),
  defineRoute({
    id: "battle.accept",
    method: "POST",
    path: "/api/battle/invites/current/accept",
    gateway: "app",
    auth: true,
    idempotent: true,
    refreshScopes: ["battle", "assets", "inventory"],
    input: z.object({ template_ids: battleTeamSelectionSchema }).strict(),
    output: battleRoomSnapshotSchema,
    errors: [
      "BATTLE_INVITE_INVALID",
      "BATTLE_ROOM_EXPIRED",
      "BATTLE_ROOM_CANCELLED",
      "BATTLE_ROOM_ALREADY_ACCEPTED",
      "BATTLE_SELF_ACCEPT_FORBIDDEN",
      "BATTLE_ALREADY_PARTICIPATING",
      "BATTLE_TEAM_INVALID",
      "BATTLE_TEAM_TEMPLATE_DUPLICATE",
      "INSUFFICIENT_BALANCE",
      "INSUFFICIENT_INVENTORY",
      "INVENTORY_RESERVED",
      "BATTLE_VOIDED",
      "RATE_LIMITED",
      "IDEMPOTENCY_KEY_REUSED",
    ],
  }),
  defineRoute({
    id: "battle.action",
    method: "POST",
    path: "/api/battle/rooms/:room_id/actions",
    gateway: "app",
    auth: true,
    idempotent: true,
    refreshScopes: ["battle"],
    input: battleActionRouteInputSchema,
    output: battleRoomSnapshotSchema,
    errors: [
      "BATTLE_ROOM_NOT_FOUND",
      "BATTLE_NOT_PARTICIPANT",
      "BATTLE_ACTION_PHASE_INVALID",
      "BATTLE_NOT_YOUR_TURN",
      "BATTLE_ACTION_INVALID",
      "BATTLE_SWITCH_TARGET_INVALID",
      "BATTLE_STATE_CONFLICT",
      "BATTLE_VOIDED",
      "RATE_LIMITED",
      "IDEMPOTENCY_KEY_REUSED",
    ],
  }),
  defineRoute({
    id: "battle.heartbeat",
    method: "POST",
    path: "/api/battle/rooms/:room_id/heartbeat",
    gateway: "app",
    auth: true,
    idempotent: false,
    forbidIdempotencyKey: true,
    refreshScopes: ["battle", "assets", "inventory"],
    input: battlePresenceCommandSchema,
    output: battleRoomSnapshotSchema,
    errors: ["BATTLE_NOT_PARTICIPANT", "BATTLE_STATE_CONFLICT", "RATE_LIMITED"],
  }),
  defineRoute({
    id: "battle.offline",
    method: "POST",
    path: "/api/battle/rooms/:room_id/offline",
    gateway: "app",
    auth: true,
    idempotent: false,
    forbidIdempotencyKey: true,
    refreshScopes: ["battle", "assets", "inventory"],
    input: battlePresenceCommandSchema,
    output: battleRoomSnapshotSchema,
    errors: ["BATTLE_NOT_PARTICIPANT", "BATTLE_STATE_CONFLICT", "RATE_LIMITED"],
  }),
  defineRoute({
    id: "battle.realtime_token",
    method: "POST",
    path: "/api/battle/realtime-token",
    gateway: "app",
    auth: true,
    idempotent: false,
    refreshScopes: ["battle"],
    input: emptyObjectSchema,
    output: ablyTokenSchema,
    errors: ["RATE_LIMITED"],
  }),
] as const;
