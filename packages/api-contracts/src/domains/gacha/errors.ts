import type { ErrorCode } from "../../common/errors.ts";
import { gachaRoutes } from "./routes.ts";

export const gachaErrorCodes = [
  ...new Set(gachaRoutes.flatMap((route) => route.errors)),
] as ErrorCode[];
