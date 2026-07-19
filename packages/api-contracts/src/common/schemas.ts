import { z } from "zod";

import { errorCodes } from "./errors.ts";

export const uuidSchema = z.string().uuid();
export const identifierSchema = z.string().trim().min(1).max(128);
export const nonNegativeIntegerSchema = z.number().int().min(0);
export const positiveIntegerSchema = z.number().int().positive();
export const timestampSchema = z.string().datetime({ offset: true });
export const utcDateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
export const emptyObjectSchema = z.object({}).strict();
export const nullableTimestampSchema = timestampSchema.nullable();

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
