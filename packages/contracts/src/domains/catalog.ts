import { z } from "zod";

import { boxSchema, catalogChainSchema, catalogTemplateSchema } from "../common/models.ts";
import { defineRoute } from "../common/route.ts";
import { emptyObjectSchema } from "../common/schemas.ts";

export const catalogOutputSchema = z
  .object({
    version: z.literal("v1"),
    product_checksum: z.string().length(64),
    chains: z.array(catalogChainSchema).length(70),
    templates: z.array(catalogTemplateSchema).length(210),
    boxes: z.array(boxSchema).length(3),
    topup_products: z.array(z.number().int().positive()).length(5),
  })
  .strict();

export const catalogRoutes = [
  defineRoute({
    id: "catalog.get",
    method: "GET",
    path: "/api/catalog",
    gateway: "app",
    auth: false,
    idempotent: false,
    input: emptyObjectSchema,
    output: catalogOutputSchema,
    errors: ["CATALOG_UNAVAILABLE", "INTERNAL_ERROR"],
  }),
] as const;
