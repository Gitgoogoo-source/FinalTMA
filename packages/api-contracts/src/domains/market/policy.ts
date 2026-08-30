import { z } from "zod";

export const MARKET_PURCHASE_MAX_QUANTITY = 100;

export const marketPurchaseQuantitySchema = z
  .int()
  .min(1)
  .max(MARKET_PURCHASE_MAX_QUANTITY);
