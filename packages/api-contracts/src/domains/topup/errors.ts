import type { ErrorCode } from "../../common/errors.ts";
import { topupRoutes } from "./routes.ts";

export const topupErrorCodes = [
  ...new Set(topupRoutes.flatMap((route) => route.errors)),
] as ErrorCode[];
