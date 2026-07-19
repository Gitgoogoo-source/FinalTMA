import type { ErrorCode } from "../../common/errors.ts";
import { vipRoutes } from "./routes.ts";

export const vipErrorCodes = [
  ...new Set(vipRoutes.flatMap((route) => route.errors)),
] as ErrorCode[];
