import type { ErrorCode } from "../../common/errors.ts";
import { operationRoutes } from "./routes.ts";

export const operationsErrorCodes = [
  ...new Set(operationRoutes.flatMap((route) => route.errors)),
] as ErrorCode[];
