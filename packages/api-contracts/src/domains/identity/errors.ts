import type { ErrorCode } from "../../common/errors.ts";
import { identityRoutes } from "./routes.ts";

export const identityErrorCodes = [
  ...new Set(identityRoutes.flatMap((route) => route.errors)),
] as ErrorCode[];
