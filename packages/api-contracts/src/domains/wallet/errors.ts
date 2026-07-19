import type { ErrorCode } from "../../common/errors.ts";
import { walletRoutes } from "./routes.ts";

export const walletErrorCodes = [
  ...new Set(walletRoutes.flatMap((route) => route.errors)),
] as ErrorCode[];
