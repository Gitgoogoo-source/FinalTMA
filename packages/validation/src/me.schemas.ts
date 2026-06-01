import { z } from "zod";

const meAssetAmountSchema = z.string().trim().regex(/^\d+$/);

const createMeAssetBalanceSchema = <Currency extends "KCOIN" | "FGEMS">(
  currencyCode: Currency,
) =>
  z
    .object({
      currencyCode: z.literal(currencyCode),
      available: meAssetAmountSchema,
      locked: meAssetAmountSchema,
    })
    .strict();

export const meAssetBalancesSchema = z
  .object({
    KCOIN: createMeAssetBalanceSchema("KCOIN"),
    FGEMS: createMeAssetBalanceSchema("FGEMS"),
  })
  .strict();

export const meAssetsResponseSchema = z
  .object({
    userId: z.string().uuid(),
    balances: meAssetBalancesSchema,
    assets: z
      .object({
        kcoin: createMeAssetBalanceSchema("KCOIN"),
        fgems: createMeAssetBalanceSchema("FGEMS"),
      })
      .strict(),
    updatedAt: z.string().nullable(),
  })
  .strict();

export const meBootstrapResponseSchema = z.object({
  user: z.unknown(),
  assets: z.unknown(),
  catalog: z.unknown().optional(),
});

export type MeAssetsResponse = z.infer<typeof meAssetsResponseSchema>;
