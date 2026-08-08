import { z } from "zod";

import { errorCodes } from "./error-codes.ts";

export const uuidSchema = z.string().uuid();
export const identifierSchema = z.string().trim().min(1).max(128);
export const nonNegativeIntegerSchema = z.number().int().min(0);
export const nonNegativeBigintStringSchema = z.string().regex(/^(0|[1-9]\d*)$/);
export const positiveIntegerSchema = z.number().int().positive();
export const timestampSchema = z.string().datetime({ offset: true });
export const utcDateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
export const emptyObjectSchema = z.object({}).strict();
export const nullableTimestampSchema = timestampSchema.nullable();
export const petThumbnailUrlSchema = z
  .string()
  .url()
  .regex(
    /^https:\/\/[a-z0-9]+\.supabase\.co\/storage\/v1\/object\/public\/pet-runtime\/catalog\/v[12]\/thumb\/pet-[nat]-\d{3}-[123]\.[0-9a-f]{64}\.webp$/,
  );
export const petDetailUrlSchema = z
  .string()
  .url()
  .regex(
    /^https:\/\/[a-z0-9]+\.supabase\.co\/storage\/v1\/object\/public\/pet-runtime\/catalog\/v[12]\/detail\/pet-[nat]-\d{3}-[123]\.[0-9a-f]{64}\.webp$/,
  );

export const raritySchema = z.enum([
  "common",
  "rare",
  "epic",
  "legendary",
  "mythic",
]);
export const chainTypeSchema = z.enum(["normal", "advanced", "top"]);
export const boxTierSchema = z.enum(["normal", "rare", "legendary"]);
export const expeditionTierSchema = z.enum([
  "normal",
  "intermediate",
  "advanced",
]);
export const accountStatusSchema = z.enum(["normal", "banned"]);
export const operationStatusSchema = z.enum([
  "pending",
  "succeeded",
  "failed",
  "unknown",
]);

export const errorCodeSchema = z.enum(errorCodes);
