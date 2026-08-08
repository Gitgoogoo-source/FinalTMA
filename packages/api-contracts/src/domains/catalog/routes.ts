import { z } from "zod";

import { defineRoute } from "../../common/route.ts";
import { emptyObjectSchema } from "../../common/schemas.ts";
import { boxSchema } from "../gacha/models.ts";
import { catalogChainSchema, catalogTemplateSchema } from "./models.ts";

const productChecksumSchema = z.string().regex(/^[0-9a-f]{64}$/);
const releaseKeySchema = z.string().regex(/^[a-z0-9][a-z0-9._-]{2,127}$/);

export const catalogPointerSchema = z
  .object({
    version: z.literal("v1"),
    product_checksum: productChecksumSchema,
    asset_revision: z.number().int().positive(),
    release_key: releaseKeySchema,
  })
  .strict();

export const catalogReleaseSchema = z
  .object({
    version: z.literal("v1"),
    product_checksum: productChecksumSchema,
    release_key: releaseKeySchema,
    chains: z.array(catalogChainSchema).length(70),
    templates: z.array(catalogTemplateSchema).length(210),
    boxes: z.array(boxSchema).length(3),
    topup_products: z.array(z.number().int().positive()).length(5),
  })
  .strict();

export const catalogSnapshotSchema = catalogReleaseSchema.extend({
  asset_revision: z.number().int().positive(),
});

export const catalogRoutes = [
  defineRoute({
    id: "catalog.current",
    method: "GET",
    path: "/api/catalog",
    gateway: "app",
    auth: false,
    idempotent: false,
    input: emptyObjectSchema,
    output: catalogPointerSchema,
    errors: ["CATALOG_UNAVAILABLE", "INTERNAL_ERROR"],
  }),
  defineRoute({
    id: "catalog.release",
    method: "GET",
    path: "/api/catalog/releases/v1/:product_checksum/:release_key",
    gateway: "app",
    auth: false,
    idempotent: false,
    rawResponse: true,
    cachePolicy: "public-immutable",
    input: z
      .object({
        product_checksum: productChecksumSchema,
        release_key: releaseKeySchema,
      })
      .strict(),
    output: catalogReleaseSchema,
    errors: ["CATALOG_UNAVAILABLE", "INTERNAL_ERROR"],
  }),
] as const;
