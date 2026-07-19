import type { ErrorCode } from "../../common/errors.ts";
import { catalogRoutes } from "./routes.ts";

export const catalogErrorCodes = [
  ...new Set(catalogRoutes.flatMap((route) => route.errors)),
] as ErrorCode[];
