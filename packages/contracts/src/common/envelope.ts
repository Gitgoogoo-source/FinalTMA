import { z } from "zod";

import { errorCodeSchema, uuidSchema } from "./schemas.ts";

export const standardErrorSchema = z
  .object({
    error: z
      .object({
        code: errorCodeSchema,
        message: z.string().min(1),
        retryable: z.boolean(),
      })
      .strict(),
    request_id: uuidSchema,
    operation_id: uuidSchema.nullable(),
  })
  .strict();

export function successEnvelopeSchema<T extends z.ZodType>(data: T) {
  return z
    .object({
      data,
      request_id: uuidSchema,
      operation_id: uuidSchema.nullable(),
    })
    .strict();
}

export type StandardError = z.output<typeof standardErrorSchema>;
export type SuccessEnvelope<T> = {
  data: T;
  request_id: string;
  operation_id: string | null;
};
