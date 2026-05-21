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
export * as CommonValidation from "./common.schemas";
export * as AuthValidation from "./auth.schemas";
export * as MeValidation from "./me.schemas";
export * as BoxValidation from "./box.schemas";
export * as TelegramValidation from "./telegram.schemas";
export * as PaymentValidation from "./payment.schemas";
export * as InventoryValidation from "./inventory.schemas";
export * as GameValidation from "./game.schemas";

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
export * from "./common.schemas";
export * from "./auth.schemas";
export * from "./me.schemas";
export * from "./box.schemas";
export * from "./telegram.schemas";
export * from "./payment.schemas";
export * from "./inventory.schemas";
export * from "./game.schemas";
