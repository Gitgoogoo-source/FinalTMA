import { z } from "zod";

export const identifierSchema = z.string().trim().min(1).max(128);
export const uuidSchema = z.string().uuid();
export const positiveIntegerSchema = z.number().int().positive();
export const emptyObjectSchema = z.object({}).strict();
export const recordSchema = z.record(z.string(), z.unknown());

export const operationStatusSchema = z.enum([
  "pending",
  "succeeded",
  "failed",
  "unknown",
]);

export const standardSuccessSchema = z.object({
  data: z.unknown(),
  request_id: uuidSchema,
  operation_id: uuidSchema.nullable(),
});

export const standardErrorSchema = z.object({
  error: z.object({
    code: z.string().regex(/^[A-Z][A-Z0-9_]+$/),
    message: z.string().min(1),
    retryable: z.boolean(),
  }),
  request_id: uuidSchema,
  operation_id: uuidSchema.nullable(),
});

export type StandardSuccess<T> = {
  data: T;
  request_id: string;
  operation_id: string | null;
};

export type StandardError = z.infer<typeof standardErrorSchema>;
