import type { ErrorCode } from "../../common/errors.ts";
import { mintRoutes } from "./routes.ts";

export const mintErrorCodes = [
  ...new Set(mintRoutes.flatMap((route) => route.errors)),
] as ErrorCode[];
