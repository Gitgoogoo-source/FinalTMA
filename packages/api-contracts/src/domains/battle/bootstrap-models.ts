import { z } from "zod";

import {
  identifierSchema,
  timestampSchema,
  uuidSchema,
} from "../../common/schemas.ts";

export const battleRoomStatusSchema = z.enum([
  "preparing_share",
  "waiting",
  "lobby_waiting",
  "lobby_countdown",
  "active_turn",
  "finished",
  "draw",
  "cancelled",
  "expired",
  "voided",
]);

export const battleRoomModeSchema = z.enum(["friend_invite", "public_match"]);

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

export const battleParticipationSchema = z
  .object({
    room_id: uuidSchema,
    participant_id: uuidSchema,
    side: z.enum(["creator", "opponent"]),
    room_mode: battleRoomModeSchema,
    status: battleRoomStatusSchema,
    state_version: z.number().int().positive(),
    entry_fee: z.union([z.literal(20), z.literal(100), z.literal(500)]),
    expires_at: timestampSchema.nullable(),
    phase_deadline: timestampSchema.nullable(),
  })
  .strict();
