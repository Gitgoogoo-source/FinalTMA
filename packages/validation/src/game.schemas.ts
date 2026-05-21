import { z } from "zod";

export const gameBootstrapSchema = z.object({
  enabled: z.boolean(),
});
