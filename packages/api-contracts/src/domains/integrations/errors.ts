import type { ErrorCode } from "../../common/errors.ts";
import { integrationRoutes } from "./routes.ts";

export const integrationsErrorCodes = [
  ...new Set(integrationRoutes.flatMap((route) => route.errors)),
] as ErrorCode[];
