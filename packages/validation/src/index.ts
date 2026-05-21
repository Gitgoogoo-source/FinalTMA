/**
 * @tma-game/validation
 *
 * Shared validation layer for:
 * - Telegram Mini App authentication
 * - User asset bootstrap
 * - Blind-box / gacha
 * - Telegram Stars payments
 * - First-phase bootstrap, auth, gacha and inventory APIs
 *
 * Rule:
 * Validation schemas only validate request / response shape.
 * They do not execute trusted business logic.
 * Final business decisions must happen in Vercel API + Supabase RPC.
 */

export { z } from "zod";

/**
 * Namespace exports.
 *
 * Usage:
 * import { BoxValidation } from "@tma-game/validation";
 * BoxValidation.createOpenOrderSchema.parse(input);
 */
export * as CommonValidation from "./common.schemas.js";
export * as AuthValidation from "./auth.schemas.js";
export * as MeValidation from "./me.schemas.js";
export * as BoxValidation from "./box.schemas.js";
export * as TelegramValidation from "./telegram.schemas.js";
export * as PaymentValidation from "./payment.schemas.js";
export * as InventoryValidation from "./inventory.schemas.js";
export * as GameValidation from "./game.schemas.js";

/**
 * Direct exports.
 *
 * Usage:
 * import { createOpenOrderSchema } from "@tma-game/validation";
 * createOpenOrderSchema.parse(input);
 *
 * Naming convention:
 * Every schema exported from submodules should use a module prefix to avoid conflicts.
 * Example:
 * - authTelegramLoginSchema
 * - boxCreateOpenOrderSchema
 * - marketBuyListingSchema
 * - inventoryUpgradeItemSchema
 */
export * from "./common.schemas.js";
export * from "./auth.schemas.js";
export * from "./me.schemas.js";
export * from "./box.schemas.js";
export * from "./telegram.schemas.js";
export * from "./payment.schemas.js";
export * from "./inventory.schemas.js";
export * from "./game.schemas.js";
