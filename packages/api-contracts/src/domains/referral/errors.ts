import type { ErrorCode } from "../../common/errors.ts";
import { referralRoutes } from "./routes.ts";

export const referralErrorCodes = [
  ...new Set(referralRoutes.flatMap((route) => route.errors)),
] as ErrorCode[];
