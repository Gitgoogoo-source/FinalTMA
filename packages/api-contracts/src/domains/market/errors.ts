import type { ErrorCode } from "../../common/errors.ts";
import { marketRoutes } from "./routes.ts";

export const marketErrorCodes = [
  ...new Set(marketRoutes.flatMap((route) => route.errors)),
] as ErrorCode[];
