import { z } from "zod";

export const meBootstrapResponseSchema = z.object({
  user: z.unknown(),
  assets: z.unknown(),
  catalog: z.unknown().optional(),
});
