import { z } from "zod";

import { defineRoute } from "../common/route.ts";
import { emptyObjectSchema, timestampSchema } from "../common/schemas.ts";

const tonAccountSchema = z
  .object({
    address: z.string().min(1).max(128),
    chain: z.string().min(1).max(32),
    public_key: z.string().min(1).max(256).optional(),
    wallet_state_init: z.string().min(1).max(32_768).optional(),
  })
  .strict();
const tonProofSchema = z
  .object({
    timestamp: z.number().int().positive(),
    domain: z.object({ length_bytes: z.number().int().positive(), value: z.string().min(1).max(255) }).strict(),
    payload: z.string().min(1).max(256),
    signature: z.string().min(1).max(512),
  })
  .strict();
const walletStatusSchema = z
  .object({
    connected: z.boolean(),
    address: z.string().nullable(),
    network: z.string().nullable(),
    wallet_app_name: z.string().nullable(),
    verified_at: timestampSchema.nullable(),
  })
  .strict();

export const walletRoutes = [
  defineRoute({ id: "wallet.get", method: "GET", path: "/api/wallet", gateway: "app", auth: true, idempotent: false, input: emptyObjectSchema, output: walletStatusSchema, errors: ["ACCOUNT_RESTRICTED", "INTERNAL_ERROR"] }),
  defineRoute({ id: "wallet.challenge", method: "POST", path: "/api/wallet/challenges", gateway: "app", auth: true, idempotent: false, input: emptyObjectSchema, output: z.object({ payload: z.string(), expires_at: timestampSchema }).strict(), errors: ["ACCOUNT_RESTRICTED", "INTERNAL_ERROR"] }),
  defineRoute({ id: "wallet.verify", method: "POST", path: "/api/wallet/proofs", gateway: "app", auth: true, idempotent: true, input: z.object({ account: tonAccountSchema, proof: tonProofSchema, wallet_app_name: z.string().max(128).nullable() }).strict(), output: walletStatusSchema.extend({ connected: z.literal(true), address: z.string(), network: z.string(), verified_at: timestampSchema }).strict(), errors: ["WALLET_CHALLENGE_INVALID", "WALLET_PROOF_INVALID", "WALLET_ADDRESS_IN_USE", "IDEMPOTENCY_KEY_REUSED", "INTERNAL_ERROR"] }),
  defineRoute({ id: "wallet.disconnect", method: "POST", path: "/api/wallet/disconnect", gateway: "app", auth: true, idempotent: true, input: emptyObjectSchema, output: z.object({ disconnected: z.literal(true) }).strict(), errors: ["WALLET_NOT_CONNECTED", "IDEMPOTENCY_KEY_REUSED", "INTERNAL_ERROR"] }),
] as const;
