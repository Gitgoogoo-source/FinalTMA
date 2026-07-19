import type { ErrorCode } from "../../common/errors.ts";
import { jobRoutes } from "./routes.ts";

export const jobsErrorCodes = [
  ...new Set(jobRoutes.flatMap((route) => route.errors)),
] as ErrorCode[];
