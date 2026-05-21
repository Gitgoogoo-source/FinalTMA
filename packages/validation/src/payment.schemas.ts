import { z } from "zod";

export const paymentStatusSchema = z.enum([
  "created",
  "pending",
  "paid",
  "failed",
  "refunded",
  "expired",
]);
