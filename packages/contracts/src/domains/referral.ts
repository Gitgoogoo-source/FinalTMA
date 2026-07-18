import { z } from "zod";

import { defineRoute } from "../common/route.ts";
import { emptyObjectSchema, identifierSchema } from "../common/schemas.ts";

const referralOutput = z.object({ referral_code: z.string(), link: z.string().url(), share_text: z.string(), bound_friends: z.number().int().min(0), valid_recharge_friends: z.number().int().min(0), reward_fgems_total: z.number().int().min(0), rewarded_today: z.number().int().min(0).max(20), rewarded_lifetime: z.number().int().min(0).max(300), milestone_5_status: z.enum(["pending", "granted"]), milestone_10_status: z.enum(["pending", "granted"]) }).strict();

export const referralRoutes = [
  defineRoute({ id: "referral.get", method: "GET", path: "/api/referrals", gateway: "app", auth: true, idempotent: false, input: emptyObjectSchema, output: referralOutput, errors: ["ACCOUNT_RESTRICTED", "INTERNAL_ERROR"] }),
  defineRoute({ id: "referral.bind", method: "POST", path: "/api/referrals/bind", gateway: "app", auth: true, idempotent: true, input: z.object({ code: identifierSchema }).strict(), output: z.object({ bound: z.literal(true), referral_code: z.string() }).strict(), errors: ["REFERRAL_INVALID", "REFERRAL_SELF_BIND", "REFERRAL_ALREADY_BOUND", "IDEMPOTENCY_KEY_REUSED", "INTERNAL_ERROR"] }),
  defineRoute({ id: "referral.share_event", method: "POST", path: "/api/referrals/share-events", gateway: "app", auth: true, idempotent: true, input: z.object({ event: z.enum(["copy_link", "telegram_invite"]) }).strict(), output: z.object({ recorded: z.literal(true), event: z.enum(["copy_link", "telegram_invite"]) }).strict(), errors: ["IDEMPOTENCY_KEY_REUSED", "INTERNAL_ERROR"] }),
] as const;
