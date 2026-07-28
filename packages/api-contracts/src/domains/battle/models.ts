import { z } from "zod";

import {
  identifierSchema,
  nonNegativeIntegerSchema,
  raritySchema,
  timestampSchema,
  uuidSchema,
} from "../../common/schemas.ts";

export const battleElementSchema = z.enum([
  "fire",
  "grass",
  "earth",
  "lightning",
  "water",
]);

export const battleEffectKeySchema = z
  .string()
  .regex(/^(fire|grass|earth|lightning|water)-(0[1-9]|10)$/);

export const battlePageStateSchema = z.enum([
  "home",
  "team_select",
  "preparing_share",
  "waiting",
  "lobby",
  "accept",
  "battle",
  "forced_switch",
  "result",
]);

export const battleRoomStatusSchema = z.enum([
  "preparing_share",
  "waiting",
  "lobby_waiting",
  "lobby_countdown",
  "active_select",
  "reveal",
  "forced_switch",
  "finished",
  "draw",
  "cancelled",
  "expired",
  "voided",
]);

export const battleParticipantStatusSchema = z.enum([
  "preparing_share",
  "waiting",
  "lobby",
  "active",
  "finished",
  "draw",
  "cancelled",
  "expired",
  "voided",
]);

export const battleEntryTierSchema = z.discriminatedUnion("id", [
  z
    .object({
      id: z.literal("tier-20"),
      entry_fee: z.literal(20),
      pool: z.literal(40),
      winner_payout: z.literal(36),
      fee: z.literal(4),
    })
    .strict(),
  z
    .object({
      id: z.literal("tier-100"),
      entry_fee: z.literal(100),
      pool: z.literal(200),
      winner_payout: z.literal(180),
      fee: z.literal(20),
    })
    .strict(),
  z
    .object({
      id: z.literal("tier-500"),
      entry_fee: z.literal(500),
      pool: z.literal(1000),
      winner_payout: z.literal(900),
      fee: z.literal(100),
    })
    .strict(),
]);

export const battleRulesetSummarySchema = z
  .object({
    id: z.literal("battle-v1"),
    checksum: z.string().regex(/^[0-9a-f]{64}$/),
    heartbeat_interval_seconds: z.literal(5),
    presence_online_window_seconds: z.literal(10),
    offline_reconnect_seconds: z.literal(90),
    lobby_timeout_seconds: z.literal(300),
    lobby_countdown_seconds: z.literal(3),
    action_timeout_seconds: z.literal(15),
    forced_switch_timeout_seconds: z.literal(15),
    reveal_seconds: z.literal(3),
    max_normal_turns: z.literal(20),
  })
  .strict();

export const battleRaritySummaryItemSchema = z
  .object({
    rarity: raritySchema,
    count: z.number().int().min(1).max(3),
  })
  .strict();

const rarityOrder: Readonly<Record<z.output<typeof raritySchema>, number>> = {
  common: 0,
  rare: 1,
  epic: 2,
  legendary: 3,
  mythic: 4,
};

export const battleChallengeCardSchema = z
  .object({
    creator_display_name: z.string().trim().min(1).max(128),
    creator_avatar_url: z.string().url().nullable(),
    entry_fee: z.union([z.literal(20), z.literal(100), z.literal(500)]),
    rarity_summary: z
      .array(battleRaritySummaryItemSchema)
      .min(1)
      .max(3)
      .superRefine((items, context) => {
        if (
          items.reduce((total, item) => total + item.count, 0) !== 3 ||
          new Set(items.map((item) => item.rarity)).size !== items.length ||
          items.some(
            (item, index) =>
              index > 0 &&
              rarityOrder[item.rarity] <= rarityOrder[items[index - 1]!.rarity],
          )
        )
          context.addIssue({
            code: "custom",
            message: "Battle rarity summary must describe three ordered pets",
          });
      }),
    expires_at: timestampSchema,
    server_time: timestampSchema,
    creator_online: z.boolean(),
  })
  .strict();

const noInviteSchema = z
  .object({
    invite_status: z.enum(["none", "invalid"]),
    server_time: timestampSchema,
  })
  .strict();

const roomInviteSchema = battleChallengeCardSchema
  .extend({
    room_id: uuidSchema,
    invite_status: z.enum([
      "available",
      "self",
      "accepted",
      "cancelled",
      "expired",
      "voided",
    ]),
    remaining_seconds: nonNegativeIntegerSchema,
  })
  .strict();

export const battleInvitePreviewSchema = z.union([
  noInviteSchema,
  roomInviteSchema,
]);

export const battleTeamSelectionSchema = z
  .tuple([identifierSchema, identifierSchema, identifierSchema])
  .superRefine((templates, context) => {
    if (new Set(templates).size !== templates.length)
      context.addIssue({
        code: "custom",
        message: "Battle team templates must be distinct",
      });
  })
  .meta({ minItems: 3, maxItems: 3, uniqueItems: true });

export const battleSkillSchema = z
  .object({
    position: z.union([z.literal(1), z.literal(2), z.literal(3), z.literal(4)]),
    skill_id: identifierSchema,
    name: z.string().trim().min(1).max(64),
    power: z.number().int().positive(),
    accuracy_bps: z.number().int().min(1).max(10_000),
    priority: z.number().int().min(-1).max(1),
    effect_key: battleEffectKeySchema,
  })
  .strict();

export const battleTeamOptionSchema = z
  .object({
    template_id: identifierSchema,
    name: z.string().trim().min(1).max(128),
    image_thumbnail_path: z.string().startsWith("/assets/catalog/v1/thumb/"),
    image_detail_path: z.string().startsWith("/assets/catalog/v1/detail/"),
    rarity: raritySchema,
    stage: z.union([z.literal(1), z.literal(2), z.literal(3)]),
    available_quantity: z.number().int().positive(),
    element: battleElementSchema,
    max_hp: z.number().int().positive(),
    attack: z.number().int().positive(),
    defense: z.number().int().positive(),
    speed: z.number().int().positive(),
    skills: z.array(battleSkillSchema).length(4),
  })
  .strict();

export const battleSelfTeamMemberSchema = z
  .object({
    slot: z.union([z.literal(1), z.literal(2), z.literal(3)]),
    template_id: identifierSchema,
    name: z.string().trim().min(1).max(128),
    image_thumbnail_path: z.string().startsWith("/assets/catalog/v1/thumb/"),
    image_detail_path: z.string().startsWith("/assets/catalog/v1/detail/"),
    rarity: raritySchema,
    stage: z.union([z.literal(1), z.literal(2), z.literal(3)]),
    element: battleElementSchema,
    current_hp: nonNegativeIntegerSchema,
    max_hp: z.number().int().positive(),
    attack: z.number().int().positive(),
    defense: z.number().int().positive(),
    speed: z.number().int().positive(),
    alive: z.boolean(),
    active: z.boolean(),
    skills: z.array(battleSkillSchema).length(4),
  })
  .strict();

export const battleSelfTeamSchema = z
  .array(battleSelfTeamMemberSchema)
  .length(3);

export const battleOpponentTeamMemberSchema = z
  .object({
    slot: z.union([z.literal(1), z.literal(2), z.literal(3)]),
    name: z.string().trim().min(1).max(128),
    image_thumbnail_path: z.string().startsWith("/assets/catalog/v1/thumb/"),
    image_detail_path: z.string().startsWith("/assets/catalog/v1/detail/"),
    rarity: raritySchema,
    stage: z.union([z.literal(1), z.literal(2), z.literal(3)]),
    hp_percent: z.number().min(0).max(100),
    alive: z.boolean(),
    active: z.boolean(),
  })
  .strict();

export const battleOpponentTeamSchema = z.union([
  z.tuple([]),
  z.array(battleOpponentTeamMemberSchema).length(3),
]);

export const battleLobbyPresenceSchema = z
  .object({
    online: z.boolean(),
    reconnect_deadline: timestampSchema.nullable(),
  })
  .strict();

export const battleLobbySchema = z
  .object({
    phase: z.enum(["lobby_waiting", "lobby_countdown"]),
    expires_at: timestampSchema,
    start_deadline: timestampSchema.nullable(),
    presence: z
      .object({
        creator: battleLobbyPresenceSchema,
        opponent: battleLobbyPresenceSchema,
      })
      .strict(),
  })
  .strict();

const battlePublicSwitchTargetSchema = z
  .object({
    slot: z.union([z.literal(1), z.literal(2), z.literal(3)]),
    name: z.string().trim().min(1).max(128),
    image_thumbnail_path: z.string().startsWith("/assets/catalog/v1/thumb/"),
    image_detail_path: z.string().startsWith("/assets/catalog/v1/detail/"),
    rarity: raritySchema,
    stage: z.union([z.literal(1), z.literal(2), z.literal(3)]),
  })
  .strict();

const battleResolutionAttackActionSchema = z.discriminatedUnion("actor", [
  z
    .object({
      actor: z.literal("self"),
      kind: z.literal("attack"),
      skill_name: z.string().trim().min(1).max(64),
      effect_key: battleEffectKeySchema,
      hit: z.boolean(),
      effectiveness: z.enum(["super_effective", "not_effective", "normal"]),
      target_hp_percent_before: z.number().min(0).max(100),
      target_hp_percent_after: z.number().min(0).max(100),
      knockout: z.boolean(),
    })
    .strict(),
  z
    .object({
      actor: z.literal("opponent"),
      kind: z.literal("attack"),
      skill_name: z.string().trim().min(1).max(64),
      effect_key: battleEffectKeySchema,
      hit: z.boolean(),
      effectiveness: z.enum(["super_effective", "not_effective", "normal"]),
      target_current_hp_before: nonNegativeIntegerSchema,
      target_current_hp_after: nonNegativeIntegerSchema,
      knockout: z.boolean(),
    })
    .strict(),
]);

const battleResolutionActionSchema = z.discriminatedUnion("kind", [
  battleResolutionAttackActionSchema,
  z
    .object({
      actor: z.enum(["self", "opponent"]),
      kind: z.literal("switch"),
      switch_to: battlePublicSwitchTargetSchema,
    })
    .strict(),
  z
    .object({
      actor: z.enum(["self", "opponent"]),
      kind: z.literal("forced_switch"),
      switch_to: battlePublicSwitchTargetSchema,
    })
    .strict(),
]);

const battleSelfHpSchema = z
  .object({
    slot: z.union([z.literal(1), z.literal(2), z.literal(3)]),
    current_hp: nonNegativeIntegerSchema,
    max_hp: z.number().int().positive(),
    alive: z.boolean(),
  })
  .strict();

const battleOpponentHpSchema = z
  .object({
    slot: z.union([z.literal(1), z.literal(2), z.literal(3)]),
    hp_percent: z.number().min(0).max(100),
    alive: z.boolean(),
  })
  .strict();

export const battleResolutionEventSchema = z
  .object({
    event_id: uuidSchema,
    state_version: z.number().int().positive(),
    turn_no: z.number().int().min(1).max(20),
    actions: z.array(battleResolutionActionSchema).min(1).max(2),
    self_hp: z.array(battleSelfHpSchema).length(3),
    opponent_hp: z.array(battleOpponentHpSchema).length(3),
    reveal_ends_at: timestampSchema,
  })
  .strict();

export const battleParticipationSchema = z
  .object({
    room_id: uuidSchema,
    participant_id: uuidSchema,
    side: z.enum(["creator", "opponent"]),
    status: battleRoomStatusSchema,
    state_version: z.number().int().positive(),
    entry_fee: z.union([z.literal(20), z.literal(100), z.literal(500)]),
    expires_at: timestampSchema.nullable(),
    phase_deadline: timestampSchema.nullable(),
    reveal_ends_at: timestampSchema.nullable(),
  })
  .strict();

export const battleCurrentResultSchema = z
  .object({
    room_id: uuidSchema,
    result: z.enum(["win", "loss", "draw", "void"]),
    opponent_display_name: z.string().trim().min(1).max(128),
    entry_fee: z.union([z.literal(20), z.literal(100), z.literal(500)]),
    payout: nonNegativeIntegerSchema,
    net_change: z.number().int(),
    fee: nonNegativeIntegerSchema,
    reason: identifierSchema,
    finished_at: timestampSchema,
  })
  .strict();

export const battleRoomSnapshotSchema = z
  .object({
    room_id: uuidSchema,
    status: battleRoomStatusSchema,
    state_version: z.number().int().positive(),
    side: z.enum(["creator", "opponent"]),
    turn_no: z.number().int().min(0).max(20),
    phase_deadline: timestampSchema.nullable(),
    reveal_ends_at: timestampSchema.nullable(),
    prepare_deadline: timestampSchema.nullable(),
    prepared_message_id: z.string().trim().min(1).max(256).nullable(),
    presence_lifecycle: z
      .object({
        version: nonNegativeIntegerSchema,
        lease_id: uuidSchema.nullable(),
        last_command_seq: nonNegativeIntegerSchema,
        active: z.boolean(),
      })
      .strict(),
    viewer_action_state: z.enum(["not_applicable", "available", "locked"]),
    server_time: timestampSchema,
    lobby: battleLobbySchema.nullable(),
    self_team: battleSelfTeamSchema,
    opponent_team: battleOpponentTeamSchema,
    resolution_event: battleResolutionEventSchema.nullable(),
  })
  .strict();

export const battleActionInputSchema = z.discriminatedUnion("kind", [
  z
    .object({
      kind: z.literal("attack"),
      turn_no: z.number().int().min(1).max(20),
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
      kind: z.literal("switch"),
      turn_no: z.number().int().min(1).max(20),
      team_slot: z.union([z.literal(1), z.literal(2), z.literal(3)]),
    })
    .strict(),
]);

export const battleForcedSwitchInputSchema = z
  .object({
    turn_no: z.number().int().min(1).max(20),
    team_slot: z.union([z.literal(1), z.literal(2), z.literal(3)]),
  })
  .strict();

export const battleRealtimeInvalidationSchema = z
  .object({
    event_id: uuidSchema,
    room_id: uuidSchema,
    state_version: z.number().int().positive(),
    event_kind: identifierSchema,
  })
  .strict();

export type BattleRulesetSummary = z.output<typeof battleRulesetSummarySchema>;
export type BattleEntryTier = z.output<typeof battleEntryTierSchema>;
export type BattlePageState = z.output<typeof battlePageStateSchema>;
export type BattleRoomStatus = z.output<typeof battleRoomStatusSchema>;
export type BattleParticipantStatus = z.output<
  typeof battleParticipantStatusSchema
>;
export type BattleParticipation = z.output<typeof battleParticipationSchema>;
export type BattleCurrentResult = z.output<typeof battleCurrentResultSchema>;
export type BattleChallengeCardDto = z.output<typeof battleChallengeCardSchema>;
export type BattleInvitePreviewDto = z.output<typeof battleInvitePreviewSchema>;
export type BattleSelfTeamDto = z.output<typeof battleSelfTeamSchema>;
export type BattleOpponentTeamDto = z.output<typeof battleOpponentTeamSchema>;
export type BattleLobbyDto = z.output<typeof battleLobbySchema>;
export type BattleResolutionEventDto = z.output<
  typeof battleResolutionEventSchema
>;
export type BattleRoomSnapshotDto = z.output<typeof battleRoomSnapshotSchema>;
export type BattleTeamSelection = z.output<typeof battleTeamSelectionSchema>;
export type BattleActionInput = z.output<typeof battleActionInputSchema>;
export type BattleForcedSwitchInput = z.output<
  typeof battleForcedSwitchInputSchema
>;
export type BattleRealtimeInvalidation = z.output<
  typeof battleRealtimeInvalidationSchema
>;
