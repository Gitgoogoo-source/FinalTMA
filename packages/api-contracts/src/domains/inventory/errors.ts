import type { ErrorCode } from "../../common/errors.ts";
import { inventoryRoutes } from "./routes.ts";

export const inventoryErrorCodes = [
  ...new Set(inventoryRoutes.flatMap((route) => route.errors)),
] as ErrorCode[];
