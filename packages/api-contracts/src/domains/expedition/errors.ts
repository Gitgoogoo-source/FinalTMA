import type { ErrorCode } from "../../common/errors.ts";
import { expeditionRoutes } from "./routes.ts";

export const expeditionErrorCodes = [
  ...new Set(expeditionRoutes.flatMap((route) => route.errors)),
] as ErrorCode[];
