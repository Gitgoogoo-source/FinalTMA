import { z } from "zod";

export const telegramInitDataSchema = z.object({
  initData: z.string().trim().min(1),
});
