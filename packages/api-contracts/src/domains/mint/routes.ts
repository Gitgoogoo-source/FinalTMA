import { z } from "zod";

import { mintSchema } from "../../common/models.ts";
import { defineRoute } from "../../common/route.ts";
import {
  emptyObjectSchema,
  identifierSchema,
  timestampSchema,
  uuidSchema,
} from "../../common/schemas.ts";

export const nftMetadataSchema = z
  .object({
    name: z.string(),
    description: z.string(),
    image: z.string().url(),
    attributes: z.array(
      z
        .object({
          trait_type: z.string(),
          value: z.union([z.string(), z.number()]),
        })
        .strict(),
    ),
  })
  .strict();

export const mintRoutes = [
  defineRoute({
    id: "mint.list",
    method: "GET",
    path: "/api/mints",
    gateway: "app",
    auth: true,
    idempotent: false,
    input: emptyObjectSchema,
    output: z.object({ mints: z.array(mintSchema) }).strict(),
    errors: ["ACCOUNT_RESTRICTED", "INTERNAL_ERROR"],
  }),
  defineRoute({
    id: "mint.get",
    method: "GET",
    path: "/api/mints/:mint_id",
    gateway: "app",
    auth: true,
    idempotent: false,
    input: z.object({ mint_id: uuidSchema }).strict(),
    output: mintSchema,
    errors: ["MINT_NOT_FOUND", "ACCOUNT_RESTRICTED", "INTERNAL_ERROR"],
  }),
  defineRoute({
    id: "mint.reserve",
    method: "POST",
    path: "/api/mints/reservations",
    gateway: "app",
    auth: true,
    idempotent: true,
    refreshScopes: ["inventory", "mint"],
    input: z.object({ template_id: identifierSchema }).strict(),
    output: z
      .object({
        mint: mintSchema,
        receiver: z.string(),
        permit: z.string(),
        valid_until: timestampSchema,
      })
      .strict(),
    errors: [
      "WALLET_NOT_VERIFIED",
      "INSUFFICIENT_INVENTORY",
      "MINT_ALREADY_ACTIVE",
      "IDEMPOTENCY_KEY_REUSED",
      "INTERNAL_ERROR",
    ],
  }),
  defineRoute({
    id: "mint.submit",
    method: "POST",
    path: "/api/mints/:mint_id/submissions",
    gateway: "app",
    auth: true,
    idempotent: true,
    refreshScopes: ["inventory", "mint"],
    input: z
      .object({
        mint_id: uuidSchema,
        transaction_hash: z.string().min(1).max(256),
      })
      .strict(),
    output: mintSchema,
    errors: [
      "MINT_NOT_FOUND",
      "MINT_NOT_SUBMITTABLE",
      "TRANSACTION_ALREADY_USED",
      "IDEMPOTENCY_KEY_REUSED",
      "INTERNAL_ERROR",
    ],
  }),
  defineRoute({
    id: "mint.cancel",
    method: "POST",
    path: "/api/mints/:mint_id/cancel",
    gateway: "app",
    auth: true,
    idempotent: true,
    refreshScopes: ["inventory", "mint"],
    input: z.object({ mint_id: uuidSchema }).strict(),
    output: mintSchema,
    errors: [
      "MINT_NOT_FOUND",
      "MINT_NOT_CANCELLABLE",
      "IDEMPOTENCY_KEY_REUSED",
      "INTERNAL_ERROR",
    ],
  }),
  defineRoute({
    id: "mint.metadata",
    method: "GET",
    path: "/api/nft-metadata/:nft_id",
    gateway: "app",
    auth: false,
    idempotent: false,
    rawResponse: true,
    input: z.object({ nft_id: z.coerce.number().int().nonnegative() }).strict(),
    output: nftMetadataSchema,
    errors: ["NFT_METADATA_NOT_FOUND", "INTERNAL_ERROR"],
  }),
] as const;
