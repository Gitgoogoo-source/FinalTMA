import { z } from "zod";

import { defineRoute } from "../common/route.ts";
import { chainTypeSchema, emptyObjectSchema, identifierSchema } from "../common/schemas.ts";

const albumChainSchema = z.object({ chain_id: z.string(), chain_type: chainTypeSchema, theme: z.string(), unlocked: z.number().int().min(0).max(3), claimed: z.boolean() }).strict();

export const albumRoutes = [
  defineRoute({ id: "album.get", method: "GET", path: "/api/album", gateway: "app", auth: true, idempotent: false, input: emptyObjectSchema, output: z.object({ unlocked_count: z.number().int().min(0).max(210), total_count: z.literal(210), chains: z.array(albumChainSchema).length(70) }).strict(), errors: ["ACCOUNT_RESTRICTED", "INTERNAL_ERROR"] }),
  defineRoute({ id: "album.claim", method: "POST", path: "/api/album/:chain_id/claim", gateway: "app", auth: true, idempotent: true, input: z.object({ chain_id: identifierSchema }).strict(), output: z.object({ chain_id: z.string(), reward_fgems: z.number().int().positive(), claimed: z.literal(true) }).strict(), errors: ["ALBUM_CHAIN_INCOMPLETE", "ALBUM_REWARD_ALREADY_CLAIMED", "IDEMPOTENCY_KEY_REUSED", "INTERNAL_ERROR"] }),
] as const;
