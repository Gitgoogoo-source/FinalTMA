import { z } from "zod";

export const commonUuidSchema = z.string().uuid();

export const commonPaginationQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).optional(),
  cursor: z.string().trim().min(1).max(512).optional(),
});
