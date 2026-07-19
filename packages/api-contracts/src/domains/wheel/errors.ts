import type { ErrorCode } from "../../common/errors.ts";
import { wheelRoutes } from "./routes.ts";

export const wheelErrorCodes = [
  ...new Set(wheelRoutes.flatMap((route) => route.errors)),
] as ErrorCode[];
